import Twilio from 'twilio';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { smsMessages, users } from '@/lib/db/schema';
import { eq, and, isNotNull, desc } from 'drizzle-orm';

// Create Twilio client
function getTwilioClient() {
  return Twilio(config.twilio.accountSid, config.twilio.authToken);
}

// Send SMS to a user
export interface SendSmsOptions {
  userId: string;
  body: string;
  schedulingRequestId?: string;
  awaitingResponseType?:
    | 'booking_approval'
    | 'availability_guidance'
    | 'stale_slot_decision'
    | 'reschedule_approval'
    | 'cancel_approval'
    | 'meeting_title';
}

export async function sendSms(options: SendSmsOptions): Promise<string> {
  const { userId, body, schedulingRequestId, awaitingResponseType } = options;

  // Get user's phone number
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user || !user.phone) {
    throw new Error('User not found or has no phone number');
  }

  const client = getTwilioClient();

  // Send via Twilio
  const message = await client.messages.create({
    body,
    to: user.phone,
    from: config.twilio.phoneNumber,
  });

  // Store in database
  const [smsRecord] = await db
    .insert(smsMessages)
    .values({
      userId,
      schedulingRequestId,
      direction: 'outbound',
      body,
      awaitingResponseType,
      twilioMessageSid: message.sid,
      sentAt: new Date(),
    })
    .returning({ id: smsMessages.id });

  return smsRecord.id;
}

// Find user by phone number
export async function findUserByPhone(phone: string) {
  // Normalize phone number (remove spaces, dashes, etc.)
  const normalized = phone.replace(/\D/g, '');

  // Try with and without country code
  const user = await db.query.users.findFirst({
    where: (fields, { or, like }) =>
      or(
        like(fields.phone, `%${normalized}`),
        like(fields.phone, `%${normalized.slice(-10)}`) // Last 10 digits
      ),
  });

  return user;
}

// Get the most recent SMS awaiting response for a user
export async function getMostRecentAwaitingSms(userId: string) {
  const sms = await db.query.smsMessages.findFirst({
    where: and(
      eq(smsMessages.userId, userId),
      eq(smsMessages.direction, 'outbound'),
      isNotNull(smsMessages.awaitingResponseType)
    ),
    orderBy: desc(smsMessages.createdAt),
  });

  return sms;
}

// Store an inbound SMS
export async function storeInboundSms(
  userId: string,
  body: string,
  twilioSid: string,
  schedulingRequestId?: string
): Promise<string> {
  const [smsRecord] = await db
    .insert(smsMessages)
    .values({
      userId,
      schedulingRequestId,
      direction: 'inbound',
      body,
      twilioMessageSid: twilioSid,
      receivedAt: new Date(),
    })
    .returning({ id: smsMessages.id });

  return smsRecord.id;
}

// Clear awaiting response type after user responds
export async function clearAwaitingResponse(smsId: string): Promise<void> {
  await db
    .update(smsMessages)
    .set({ awaitingResponseType: null })
    .where(eq(smsMessages.id, smsId));
}

// Validate Twilio webhook signature
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  const client = getTwilioClient();
  return Twilio.validateRequest(
    config.twilio.authToken,
    signature,
    url,
    params
  );
}
