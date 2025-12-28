import PgBoss from 'pg-boss';
import { config } from '@/lib/config';

let boss: PgBoss | null = null;

// Get or create pg-boss instance
export async function getJobQueue(): Promise<PgBoss> {
  if (boss) {
    return boss;
  }

  boss = new PgBoss({
    connectionString: config.databaseUrl,
    // Archive completed jobs for 7 days
    archiveCompletedAfterSeconds: 7 * 24 * 60 * 60,
    // Delete archived jobs after 14 days
    deleteAfterSeconds: 14 * 24 * 60 * 60,
  });

  boss.on('error', (error) => {
    console.error('pg-boss error:', error);
  });

  await boss.start();

  return boss;
}

// Schedule a job to run at a specific time
export async function scheduleJob(
  queueName: string,
  data: Record<string, unknown>,
  options: { startAfter?: Date; singletonKey?: string } = {}
): Promise<string | null> {
  const queue = await getJobQueue();

  const jobOptions: PgBoss.SendOptions = {};

  if (options.startAfter) {
    jobOptions.startAfter = options.startAfter;
  }

  if (options.singletonKey) {
    jobOptions.singletonKey = options.singletonKey;
  }

  return queue.send(queueName, data, jobOptions);
}

// Cancel a scheduled job
export async function cancelJob(queueName: string, jobId: string): Promise<void> {
  const queue = await getJobQueue();
  await queue.cancel(queueName, jobId);
}

// Job queue names
export const QUEUE_NAMES = {
  SEND_EMAIL: 'send-email',
  SMS_REMINDER: 'sms-reminder',
  EXPIRE_REQUEST: 'expire-request',
  GMAIL_WATCH_RENEWAL: 'gmail-watch-renewal',
} as const;
