import Twilio from 'twilio';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { notifications, users } from '@/lib/db/schema';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { sendTelegramMessage } from '../telegram/client';

export type NotificationProvider = 'twilio' | 'telegram';

export type AwaitingResponseType =
  | 'booking_approval'
  | 'availability_guidance'
  | 'stale_slot_decision'
  | 'reschedule_approval'
  | 'cancel_approval'
  | 'meeting_title';

export interface SendNotificationOptions {
  userId: string;
  body: string;
  schedulingRequestId?: string;
  awaitingResponseType?: AwaitingResponseType;
}

// Get Twilio client
function getTwilioClient() {
  return Twilio(config.twilio.accountSid, config.twilio.authToken);
}

// Get the notification provider for a user
export async function getProviderForUser(userId: string): Promise<{
  provider: NotificationProvider;
  user: typeof users.$inferSelect;
}> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Default to SMS if no preference set
  const preference = user.notificationPreference || 'sms';

  // Check if user has required credentials for their preference
  if (preference === 'telegram') {
    if (!user.telegramChatId) {
      console.warn(`User ${userId} prefers Telegram but has no chat ID, falling back to SMS`);
      return { provider: 'twilio', user };
    }
    return { provider: 'telegram', user };
  }

  // SMS
  if (!user.phone) {
    throw new Error('User has no phone number configured');
  }
  return { provider: 'twilio', user };
}

// Send notification via the appropriate provider
export async function sendNotification(options: SendNotificationOptions): Promise<string> {
  const { userId, body, schedulingRequestId, awaitingResponseType } = options;

  const { provider, user } = await getProviderForUser(userId);

  let providerMessageId: string;

  if (provider === 'telegram') {
    // Send via Telegram
    providerMessageId = await sendTelegramMessage(user.telegramChatId!, body);
  } else {
    // Send via Twilio
    const client = getTwilioClient();
    const message = await client.messages.create({
      body,
      to: user.phone!,
      from: config.twilio.phoneNumber,
    });
    providerMessageId = message.sid;
  }

  // Store in database
  const [record] = await db
    .insert(notifications)
    .values({
      userId,
      schedulingRequestId,
      provider,
      direction: 'outbound',
      body,
      awaitingResponseType,
      providerMessageId,
      sentAt: new Date(),
    })
    .returning({ id: notifications.id });

  return record.id;
}

// Find user by notification identifier (phone number or telegram chat ID)
export async function findUserByNotificationId(
  id: string,
  provider: NotificationProvider
): Promise<typeof users.$inferSelect | null> {
  if (provider === 'telegram') {
    const user = await db.query.users.findFirst({
      where: eq(users.telegramChatId, id),
    });
    return user || null;
  }

  // SMS - normalize phone number
  const normalized = id.replace(/\D/g, '');

  const user = await db.query.users.findFirst({
    where: (fields, { or, like }) =>
      or(
        like(fields.phone, `%${normalized}`),
        like(fields.phone, `%${normalized.slice(-10)}`) // Last 10 digits
      ),
  });

  return user || null;
}

// Get the most recent notification awaiting response for a user
export async function getMostRecentAwaiting(userId: string) {
  const notification = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.userId, userId),
      eq(notifications.direction, 'outbound'),
      isNotNull(notifications.awaitingResponseType)
    ),
    orderBy: desc(notifications.createdAt),
  });

  return notification;
}

// Store an inbound notification
export async function storeInboundNotification(
  userId: string,
  body: string,
  provider: NotificationProvider,
  providerMessageId: string,
  schedulingRequestId?: string
): Promise<string> {
  const [record] = await db
    .insert(notifications)
    .values({
      userId,
      schedulingRequestId,
      provider,
      direction: 'inbound',
      body,
      providerMessageId,
      receivedAt: new Date(),
    })
    .returning({ id: notifications.id });

  return record.id;
}

// Clear awaiting response type after user responds
export async function clearAwaitingResponse(notificationId: string): Promise<void> {
  await db.update(notifications).set({ awaitingResponseType: null }).where(eq(notifications.id, notificationId));
}

// Get conversation history for a scheduling request
export async function getConversationHistory(
  schedulingRequestId: string
): Promise<Array<{ direction: 'inbound' | 'outbound'; body: string; createdAt: Date }>> {
  const messages = await db.query.notifications.findMany({
    where: eq(notifications.schedulingRequestId, schedulingRequestId),
    orderBy: notifications.createdAt,
  });

  return messages
    .filter((m) => m.body !== null && m.createdAt !== null)
    .map((m) => ({
      direction: m.direction,
      body: m.body!,
      createdAt: m.createdAt!,
    }));
}

// Validate Twilio webhook signature
export function validateTwilioSignature(signature: string, url: string, params: Record<string, string>): boolean {
  return Twilio.validateRequest(config.twilio.authToken, signature, url, params);
}

// Re-export for backward compatibility
export {
  sendNotification as sendSms,
  findUserByNotificationId as findUserByPhone,
  getMostRecentAwaiting as getMostRecentAwaitingSms,
  storeInboundNotification as storeInboundSms,
};
