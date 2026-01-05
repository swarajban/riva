import { db } from '@/lib/db';
import { emailThreads, schedulingRequests, assistants } from '@/lib/db/schema';
import { and, isNotNull, isNull, lte, eq, gt } from 'drizzle-orm';
import { sendEmailNow } from '@/lib/integrations/gmail/send';
import { setupGmailWatch } from '@/lib/integrations/gmail/client';
import { handleSmsReminder } from './handlers/sms-reminder';
import { handleExpireRequest } from './handlers/expire-request';
import { logger } from '@/lib/utils/logger';

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
    logger.info('Processing pending email', { emailId: email.id });

    try {
      // Atomically claim the email by setting sentAt to a placeholder
      // This prevents race conditions with concurrent poll cycles
      const claimed = await db
        .update(emailThreads)
        .set({ sentAt: new Date(0) }) // Placeholder timestamp (epoch)
        .where(
          and(
            eq(emailThreads.id, email.id),
            isNull(emailThreads.sentAt) // Only claim if not already claimed
          )
        )
        .returning({ id: emailThreads.id });

      if (claimed.length === 0) {
        logger.info('Email already claimed, skipping', { emailId: email.id });
        continue;
      }

      // Get the user from the scheduling request
      if (!email.schedulingRequestId) {
        logger.error('Email has no scheduling request, cannot send', undefined, { emailId: email.id });
        await db.update(emailThreads).set({ sentAt: null }).where(eq(emailThreads.id, email.id));
        continue;
      }

      const request = await db.query.schedulingRequests.findFirst({
        where: eq(schedulingRequests.id, email.schedulingRequestId),
      });

      if (!request) {
        logger.error('Scheduling request not found', undefined, { schedulingRequestId: email.schedulingRequestId });
        await db.update(emailThreads).set({ sentAt: null }).where(eq(emailThreads.id, email.id));
        continue;
      }

      // Safety check: don't send if newer inbound emails arrived after this was queued
      // This handles edge cases where the webhook cancellation might have missed something
      const newerInbound = await db.query.emailThreads.findFirst({
        where: and(
          eq(emailThreads.schedulingRequestId, email.schedulingRequestId),
          eq(emailThreads.direction, 'inbound'),
          gt(emailThreads.createdAt, email.createdAt!)
        ),
      });

      if (newerInbound) {
        logger.info('Email cancelled at send time - newer inbound email arrived after it was queued', {
          emailId: email.id,
          newerInboundId: newerInbound.id,
        });
        await db
          .update(emailThreads)
          .set({
            sentAt: null,
            scheduledSendAt: null,
            processingError: 'Cancelled: newer inbound email arrived before send',
          })
          .where(eq(emailThreads.id, email.id));
        continue;
      }

      await sendEmailNow(request.userId, email.id);
      logger.info('Email sent', { emailId: email.id });
    } catch (error) {
      logger.error('Failed to send email', error, { emailId: email.id });
      // Reset sentAt on failure so it can be retried
      await db.update(emailThreads).set({ sentAt: null }).where(eq(emailThreads.id, email.id));
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
    logger.info('Processing SMS reminder', { schedulingRequestId: request.id });

    try {
      await handleSmsReminder({ schedulingRequestId: request.id });
      logger.info('SMS reminder sent', { schedulingRequestId: request.id });
    } catch (error) {
      logger.error('Failed to send SMS reminder', error, { schedulingRequestId: request.id });
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
    logger.info('Processing expired request', { schedulingRequestId: request.id });

    try {
      await handleExpireRequest({ schedulingRequestId: request.id });
      logger.info('Request expired', { schedulingRequestId: request.id });
    } catch (error) {
      logger.error('Failed to expire request', error, { schedulingRequestId: request.id });
    }
  }
}

// Renew Gmail watch if expiring soon (within 1 day)
async function processGmailWatchRenewals(): Promise<void> {
  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const expiringAssistants = await db.query.assistants.findMany({
    where: and(isNotNull(assistants.gmailWatchExpiresAt), lte(assistants.gmailWatchExpiresAt, oneDayFromNow)),
  });

  for (const assistant of expiringAssistants) {
    logger.info('Renewing Gmail watch', { assistantEmail: assistant.email, assistantId: assistant.id });

    try {
      await setupGmailWatch(assistant.id);
      logger.info('Gmail watch renewed', { assistantEmail: assistant.email });
    } catch (error) {
      logger.error('Failed to renew Gmail watch', error, { assistantEmail: assistant.email });
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
    logger.error('Worker poll error', error);
  }
}

// Start the worker
export async function startWorker(): Promise<void> {
  logger.info('Starting polling worker', { pollIntervalMs: POLL_INTERVAL_MS });

  // Run immediately on start
  await pollOnce();

  // Then poll on interval
  setInterval(pollOnce, POLL_INTERVAL_MS);

  logger.info('Worker started');
}

// Run if executed directly
startWorker().catch((error) => logger.error('Worker failed to start', error));
