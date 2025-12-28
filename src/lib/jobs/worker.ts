import { getJobQueue, QUEUE_NAMES } from './queue';
import { handleSendEmail } from './handlers/send-email';
import { handleSmsReminder } from './handlers/sms-reminder';
import { handleExpireRequest } from './handlers/expire-request';
import { handleGmailWatchRenewal } from './handlers/gmail-watch';

// Start the job worker
export async function startWorker(): Promise<void> {
  const boss = await getJobQueue();

  console.log('Starting job worker...');

  // Register handlers
  await boss.work(QUEUE_NAMES.SEND_EMAIL, async (jobs) => {
    for (const job of jobs) {
      console.log(`Processing send-email job ${job.id}`);
      await handleSendEmail(job.data as { emailThreadId: string });
    }
  });

  await boss.work(QUEUE_NAMES.SMS_REMINDER, async (jobs) => {
    for (const job of jobs) {
      console.log(`Processing sms-reminder job ${job.id}`);
      await handleSmsReminder(job.data as { schedulingRequestId: string });
    }
  });

  await boss.work(QUEUE_NAMES.EXPIRE_REQUEST, async (jobs) => {
    for (const job of jobs) {
      console.log(`Processing expire-request job ${job.id}`);
      await handleExpireRequest(job.data as { schedulingRequestId: string });
    }
  });

  await boss.work(QUEUE_NAMES.GMAIL_WATCH_RENEWAL, async (jobs) => {
    for (const job of jobs) {
      console.log(`Processing gmail-watch-renewal job ${job.id}`);
      await handleGmailWatchRenewal(job.data as { userId: string });
    }
  });

  console.log('Job worker started');
}
