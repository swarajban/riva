import Twilio from 'twilio';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { notifications, users } from '@/lib/db/schema';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { sendTelegramMessage } from '../telegram/client';
import { logger } from '@/lib/utils/logger';

export type NotificationProvider = 'twilio' | 'telegram' | 'dashboard';

export type AwaitingResponseType =
  | 'booking_approval'
  | 'availability_guidance'
  | 'stale_slot_decision'
  | 'reschedule_approval'
  | 'cancel_approval'
  | 'meeting_title'
  | 'email_approval';

export interface SendNotificationOptions {
  userId: string;
  body: string;
  schedulingRequestId?: string;
  awaitingResponseType?: AwaitingResponseType;
  pendingEmailId?: string;
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

  // Default to dashboard if no preference set
  const preference = user.notificationPreference || 'dashboard';

  // Dashboard - always available, no external credentials needed
  if (preference === 'dashboard') {
    return { provider: 'dashboard', user };
  }

  // Telegram - check if user has chat ID configured
  if (preference === 'telegram') {
    if (!user.telegramChatId) {
      logger.warn('User prefers Telegram but has no chat ID, falling back to dashboard', { userId });
      return { provider: 'dashboard', user };
    }
    return { provider: 'telegram', user };
  }

  // SMS - check if user has phone configured
  if (!user.phone) {
    logger.warn('User prefers SMS but has no phone, falling back to dashboard', { userId });
    return { provider: 'dashboard', user };
  }
  return { provider: 'twilio', user };
}

// Find the lowest available reference number for a user
async function getNextReferenceNumber(userId: string): Promise<number> {
  const existingPending = await getAllPendingConfirmations(userId);
  const usedNumbers = new Set(existingPending.map((p) => p.referenceNumber).filter(Boolean));

  // Find lowest available number starting from 1
  let refNumber = 1;
  while (usedNumbers.has(refNumber)) {
    refNumber++;
  }
  return refNumber;
}

// Send notification via the appropriate provider
export async function sendNotification(options: SendNotificationOptions): Promise<string> {
  const { userId, body, schedulingRequestId, awaitingResponseType, pendingEmailId } = options;

  const { provider, user } = await getProviderForUser(userId);

  // Check for existing pending confirmations if this is a confirmation request
  let messageBody = body;
  let referenceNumber: number | undefined;

  if (awaitingResponseType) {
    const existingPending = await getAllPendingConfirmations(userId);

    // Assign a stable reference number (reuses lowest available)
    referenceNumber = await getNextReferenceNumber(userId);

    if (existingPending.length > 0) {
      // Build summary of other pending confirmations using their stored reference numbers
      const pendingSummary = existingPending
        .map((p) => {
          const attendee =
            p.schedulingRequest?.attendees?.[0]?.name ||
            p.schedulingRequest?.attendees?.[0]?.email ||
            'Unknown';
          return `#${p.referenceNumber} ${attendee}`;
        })
        .join(', ');

      // Format message with reference number
      messageBody = `#${referenceNumber}: ${body}\n\n---\nPending: ${pendingSummary}\nReply # then Y/N (e.g., "${referenceNumber} Y")`;
    } else {
      // First/only confirmation - still assign ref number but don't show pending list
      messageBody = body;
    }
  }

  let providerMessageId: string | undefined;

  if (provider === 'dashboard') {
    // Dashboard-only: no external send, user will see in dashboard
    providerMessageId = undefined;
  } else if (provider === 'telegram') {
    // Send via Telegram
    providerMessageId = await sendTelegramMessage(user.telegramChatId!, messageBody);
  } else {
    // Send via Twilio
    const client = getTwilioClient();
    const message = await client.messages.create({
      body: messageBody,
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
      pendingEmailId,
      referenceNumber,
      sentAt: new Date(),
    })
    .returning({ id: notifications.id });

  logger.info('Sent outbound notification', {
    notificationId: record.id,
    userId,
    schedulingRequestId,
    provider,
    awaitingResponseType,
    referenceNumber,
    body,
  });

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

// Terminal statuses where confirmations are no longer relevant
const TERMINAL_STATUSES = ['confirmed', 'expired', 'cancelled', 'error'];

// Get all notifications awaiting response for a user (oldest first for reference numbering)
export async function getAllPendingConfirmations(userId: string) {
  const pending = await db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, userId),
      eq(notifications.direction, 'outbound'),
      isNotNull(notifications.awaitingResponseType)
    ),
    orderBy: notifications.createdAt, // oldest first = #1
    with: {
      schedulingRequest: true,
    },
  });

  // Filter out notifications where the scheduling request is in a terminal state
  return pending.filter((p) => {
    if (!p.schedulingRequest) return true; // Keep if no associated request (e.g., standalone notifications)
    return !TERMINAL_STATUSES.includes(p.schedulingRequest.status);
  });
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

  logger.info('Stored inbound notification', {
    notificationId: record.id,
    userId,
    schedulingRequestId,
    provider,
    body,
  });

  return record.id;
}

// Clear awaiting response type after user responds
export async function clearAwaitingResponse(notificationId: string): Promise<void> {
  await db.update(notifications).set({ awaitingResponseType: null }).where(eq(notifications.id, notificationId));
}

// Create a new notification for an edit, preserving the reference number
// This keeps full message history instead of updating in-place
export async function createEditedNotification(
  originalNotificationId: string,
  newBody: string,
  providerMessageId: string
): Promise<string> {
  // Get the original notification to copy relevant fields
  const original = await db.query.notifications.findFirst({
    where: eq(notifications.id, originalNotificationId),
  });

  if (!original) {
    throw new Error('Original notification not found');
  }

  // Clear the old notification's awaiting response (it's superseded)
  await db
    .update(notifications)
    .set({ awaitingResponseType: null })
    .where(eq(notifications.id, originalNotificationId));

  // Create new notification with same reference number
  const [record] = await db
    .insert(notifications)
    .values({
      userId: original.userId,
      schedulingRequestId: original.schedulingRequestId,
      provider: original.provider,
      direction: 'outbound',
      body: newBody,
      awaitingResponseType: original.awaitingResponseType,
      providerMessageId,
      pendingEmailId: original.pendingEmailId,
      referenceNumber: original.referenceNumber, // Preserve the reference number!
      sentAt: new Date(),
    })
    .returning({ id: notifications.id });

  return record.id;
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
