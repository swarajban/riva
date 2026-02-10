import { db } from '@/lib/db';
import { emailThreads, schedulingRequests, assistants, scheduledCalendarEvents, notifications } from '@/lib/db/schema';
import { and, isNotNull, isNull, lte, eq, gt } from 'drizzle-orm';
import { sendEmailNow } from '@/lib/integrations/gmail/send';
import { setupGmailWatch } from '@/lib/integrations/gmail/client';
import { createCalendarEventNow } from '@/lib/integrations/calendar/queue';
import { handleSmsReminder } from './handlers/sms-reminder';
import { handleExpireRequest } from './handlers/expire-request';
import { logger } from '@/lib/utils/logger';

const POLL_INTERVAL_MS = 10_000; // 10 seconds

// Graceful shutdown state
let isShuttingDown = false;
let isProcessing = false;
let pollInterval: NodeJS.Timeout | null = null;

function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return; // Already shutting down
    isShuttingDown = true;

    logger.info(`Received ${signal}, starting graceful shutdown...`);

    // Stop polling for new jobs
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    // Wait for current job to finish (max 25s to stay under Render's 30s default)
    const maxWait = 25_000;
    const startTime = Date.now();

    while (isProcessing && Date.now() - startTime < maxWait) {
      logger.info('Waiting for current job to complete...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (isProcessing) {
      logger.warn('Current job did not complete in time, exiting anyway');
    } else {
      logger.info('Graceful shutdown complete');
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

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
    logger.info('Processing pending email', {
      emailId: email.id,
      schedulingRequestId: email.schedulingRequestId ?? undefined,
      subject: email.subject,
      to: email.toEmails,
    });

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
        logger.info('Email already claimed, skipping', {
          emailId: email.id,
          schedulingRequestId: email.schedulingRequestId ?? undefined,
        });
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
          schedulingRequestId: email.schedulingRequestId ?? undefined,
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
      logger.info('Email sent', {
        emailId: email.id,
        schedulingRequestId: email.schedulingRequestId ?? undefined,
        subject: email.subject,
        to: email.toEmails,
      });
    } catch (error) {
      logger.error('Failed to send email', error, {
        emailId: email.id,
        schedulingRequestId: email.schedulingRequestId ?? undefined,
      });
      // Reset sentAt on failure so it can be retried
      await db.update(emailThreads).set({ sentAt: null }).where(eq(emailThreads.id, email.id));
    }
  }
}

// Process pending calendar events (scheduled_send_at <= now AND sent_at IS NULL)
async function processPendingCalendarEvents(): Promise<void> {
  const now = new Date();

  const pendingEvents = await db.query.scheduledCalendarEvents.findMany({
    where: and(
      isNotNull(scheduledCalendarEvents.scheduledSendAt),
      isNull(scheduledCalendarEvents.sentAt),
      lte(scheduledCalendarEvents.scheduledSendAt, now)
    ),
    with: {
      schedulingRequest: true,
    },
  });

  for (const event of pendingEvents) {
    logger.info('Processing pending calendar event', {
      eventId: event.id,
      schedulingRequestId: event.schedulingRequestId,
      title: (event.eventData as { title?: string })?.title,
    });

    try {
      // Atomically claim the event by setting sentAt to a placeholder
      const claimed = await db
        .update(scheduledCalendarEvents)
        .set({ sentAt: new Date(0) }) // Placeholder timestamp (epoch)
        .where(
          and(
            eq(scheduledCalendarEvents.id, event.id),
            isNull(scheduledCalendarEvents.sentAt)
          )
        )
        .returning({ id: scheduledCalendarEvents.id });

      if (claimed.length === 0) {
        logger.info('Calendar event already claimed, skipping', {
          eventId: event.id,
          schedulingRequestId: event.schedulingRequestId,
        });
        continue;
      }

      // Get the user ID from the scheduling request
      if (!event.schedulingRequest) {
        logger.error('Calendar event has no scheduling request', undefined, { eventId: event.id });
        await db.update(scheduledCalendarEvents).set({ sentAt: null }).where(eq(scheduledCalendarEvents.id, event.id));
        continue;
      }

      const userId = event.schedulingRequest.userId;

      // Send linked email first if it exists
      if (event.linkedEmailId) {
        try {
          await sendEmailNow(userId, event.linkedEmailId);
          logger.info('Linked email sent with calendar event', {
            eventId: event.id,
            emailId: event.linkedEmailId,
          });
        } catch (error) {
          logger.error('Failed to send linked email', error, {
            eventId: event.id,
            emailId: event.linkedEmailId,
          });
          // Continue - still try to create the calendar event
        }
      }

      // Create the calendar event
      await createCalendarEventNow(userId, event.id);

      // Clear awaiting response type for any notification associated with this calendar event
      await db
        .update(notifications)
        .set({ awaitingResponseType: null })
        .where(eq(notifications.pendingCalendarEventId, event.id));

      logger.info('Calendar event sent', {
        eventId: event.id,
        schedulingRequestId: event.schedulingRequestId,
        title: (event.eventData as { title?: string })?.title,
      });
    } catch (error) {
      logger.error('Failed to send calendar event', error, {
        eventId: event.id,
        schedulingRequestId: event.schedulingRequestId,
      });
      // Reset sentAt on failure so it can be retried
      await db
        .update(scheduledCalendarEvents)
        .set({
          sentAt: null,
          processingError: error instanceof Error ? error.message : 'Unknown error',
        })
        .where(eq(scheduledCalendarEvents.id, event.id));
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === 'invalid_grant') {
        // OAuth tokens revoked or invalid — stop trying to renew watch for this assistant
        logger.warn('Assistant has invalid OAuth grant, disabling Gmail watch', {
          assistantEmail: assistant.email,
          assistantId: assistant.id,
        });
        await db
          .update(assistants)
          .set({ gmailWatchExpiresAt: null, updatedAt: new Date() })
          .where(eq(assistants.id, assistant.id));
      } else {
        logger.error('Failed to renew Gmail watch', error, { assistantEmail: assistant.email });
      }
    }
  }
}

// Main polling loop
async function pollOnce(): Promise<void> {
  if (isShuttingDown) {
    logger.info('Shutdown in progress, skipping poll');
    return;
  }

  isProcessing = true;
  try {
    await processPendingEmails();
    await processPendingCalendarEvents();
    await processSmsReminders();
    await processExpiredRequests();
    await processGmailWatchRenewals();
  } catch (error) {
    logger.error('Worker poll error', error);
  } finally {
    isProcessing = false;
  }
}

// Start the worker
export async function startWorker(): Promise<void> {
  logger.info('Starting polling worker', { pollIntervalMs: POLL_INTERVAL_MS });

  // Set up graceful shutdown handlers
  setupGracefulShutdown();

  // Run immediately on start
  await pollOnce();

  // Then poll on interval (store reference for cleanup)
  pollInterval = setInterval(pollOnce, POLL_INTERVAL_MS);

  logger.info('Worker started');
}

// Run if executed directly
startWorker().catch((error) => logger.error('Worker failed to start', error));
