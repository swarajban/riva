import { db } from '@/lib/db';
import { schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { config } from '@/lib/config';

// Schedule SMS reminder for a request (sets reminder time on the request)
export async function scheduleSmsReminder(
  schedulingRequestId: string
): Promise<void> {
  const reminderAt = new Date(Date.now() + config.timing.smsReminderMs);

  await db
    .update(schedulingRequests)
    .set({ smsReminderAt: reminderAt })
    .where(eq(schedulingRequests.id, schedulingRequestId));
}

// Schedule request expiration (sets expiration time on the request)
export async function scheduleRequestExpiration(
  schedulingRequestId: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + config.timing.requestExpirationMs);

  await db
    .update(schedulingRequests)
    .set({ expiresAt })
    .where(eq(schedulingRequests.id, schedulingRequestId));
}

// Note: Email scheduling is handled by storing scheduledSendAt on emailThreads
// No separate scheduling function needed - the worker polls for pending emails

// Schedule Gmail watch renewal (stores next renewal time on assistant)
export async function scheduleGmailWatchRenewal(
  assistantId: string
): Promise<void> {
  // This is now a no-op - the worker will check gmailWatchExpiresAt on assistants
  // The expiration is set when setupGmailWatch is called
  console.log(`Gmail watch renewal will be handled by worker for assistant ${assistantId}`);
}
