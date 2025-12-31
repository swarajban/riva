import { db } from '@/lib/db';
import { emailThreads, schedulingRequests, assistants } from '@/lib/db/schema';
import { and, isNotNull, isNull, lte, eq } from 'drizzle-orm';
import { sendEmailNow } from '@/lib/integrations/gmail/send';
import { getAssistant } from '@/lib/auth/google-oauth';
import { setupGmailWatch } from '@/lib/integrations/gmail/client';
import { handleSmsReminder } from './handlers/sms-reminder';
import { handleExpireRequest } from './handlers/expire-request';

const POLL_INTERVAL_MS = 10_000; // 10 seconds

// Process pending emails (scheduled_send_at <= now AND sent_at IS NULL)
async function processPendingEmails(): Promise<void> {
  const now = new Date();

  const pendingEmails = await db.query.emailThreads.findMany({
    where: and(
      isNotNull(emailThreads.scheduledSendAt),
      isNull(emailThreads.sentAt),
      lte(emailThreads.scheduledSendAt, now)
    ),
  });

  for (const email of pendingEmails) {
    console.log(`Processing pending email: ${email.id}`);

    try {
      // Get assistant for sending
      const assistant = await getAssistant();
      await sendEmailNow(assistant.id, email.id);
      console.log(`Email sent: ${email.id}`);
    } catch (error) {
      console.error(`Failed to send email ${email.id}:`, error);
    }
  }
}

// Process SMS reminders (sms_reminder_at <= now AND sms_reminder_sent_at IS NULL)
async function processSmsReminders(): Promise<void> {
  const now = new Date();

  const pendingReminders = await db.query.schedulingRequests.findMany({
    where: and(
      isNotNull(schedulingRequests.smsReminderAt),
      isNull(schedulingRequests.smsReminderSentAt),
      lte(schedulingRequests.smsReminderAt, now),
      eq(schedulingRequests.status, 'awaiting_confirmation')
    ),
  });

  for (const request of pendingReminders) {
    console.log(`Processing SMS reminder for request: ${request.id}`);

    try {
      await handleSmsReminder({ schedulingRequestId: request.id });
      console.log(`SMS reminder sent for request: ${request.id}`);
    } catch (error) {
      console.error(`Failed to send SMS reminder for ${request.id}:`, error);
    }
  }
}

// Process expired requests (expires_at <= now AND status = 'awaiting_confirmation')
async function processExpiredRequests(): Promise<void> {
  const now = new Date();

  const expiredRequests = await db.query.schedulingRequests.findMany({
    where: and(
      isNotNull(schedulingRequests.expiresAt),
      lte(schedulingRequests.expiresAt, now),
      eq(schedulingRequests.status, 'awaiting_confirmation')
    ),
  });

  for (const request of expiredRequests) {
    console.log(`Processing expired request: ${request.id}`);

    try {
      await handleExpireRequest({ schedulingRequestId: request.id });
      console.log(`Request expired: ${request.id}`);
    } catch (error) {
      console.error(`Failed to expire request ${request.id}:`, error);
    }
  }
}

// Renew Gmail watch if expiring soon (within 1 day)
async function processGmailWatchRenewals(): Promise<void> {
  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const expiringAssistants = await db.query.assistants.findMany({
    where: and(
      isNotNull(assistants.gmailWatchExpiresAt),
      lte(assistants.gmailWatchExpiresAt, oneDayFromNow)
    ),
  });

  for (const assistant of expiringAssistants) {
    console.log(`Renewing Gmail watch for assistant: ${assistant.email}`);

    try {
      await setupGmailWatch(assistant.id);
      console.log(`Gmail watch renewed for: ${assistant.email}`);
    } catch (error) {
      console.error(`Failed to renew Gmail watch for ${assistant.email}:`, error);
    }
  }
}

// Main polling loop
async function pollOnce(): Promise<void> {
  try {
    await processPendingEmails();
    await processSmsReminders();
    await processExpiredRequests();
    await processGmailWatchRenewals();
  } catch (error) {
    console.error('Worker poll error:', error);
  }
}

// Start the worker
export async function startWorker(): Promise<void> {
  console.log('Starting polling worker...');
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);

  // Run immediately on start
  await pollOnce();

  // Then poll on interval
  setInterval(pollOnce, POLL_INTERVAL_MS);

  console.log('Worker started');
}
