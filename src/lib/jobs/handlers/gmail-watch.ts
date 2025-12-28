import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { setupGmailWatch } from '@/lib/integrations/gmail/client';
import { scheduleJob, QUEUE_NAMES } from '../queue';
import { config } from '@/lib/config';

interface GmailWatchRenewalJobData {
  userId: string;
}

export async function handleGmailWatchRenewal(data: GmailWatchRenewalJobData): Promise<void> {
  const { userId } = data;

  // Verify user exists
  const user = await db.query.users.findFirst({
    where: (fields, { eq }) => eq(fields.id, userId),
  });

  if (!user) {
    console.log(`User ${userId} not found, skipping watch renewal`);
    return;
  }

  try {
    // Renew the watch
    const watchResult = await setupGmailWatch(userId);

    console.log(`Gmail watch renewed for user ${userId}:`, {
      historyId: watchResult.historyId,
      expiration: watchResult.expiration,
    });

    // Schedule next renewal (6 days from now, watch expires at 7 days)
    const nextRenewal = new Date(Date.now() + config.timing.gmailWatchRenewalMs);

    await scheduleJob(
      QUEUE_NAMES.GMAIL_WATCH_RENEWAL,
      { userId },
      {
        startAfter: nextRenewal,
        singletonKey: `gmail-watch-${userId}`,
      }
    );

    console.log(`Next watch renewal scheduled for ${nextRenewal.toISOString()}`);
  } catch (error) {
    console.error(`Failed to renew Gmail watch for user ${userId}:`, error);
    throw error; // Re-throw to trigger pg-boss retry
  }
}
