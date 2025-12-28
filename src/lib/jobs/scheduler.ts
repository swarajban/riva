import { scheduleJob, QUEUE_NAMES } from './queue';
import { config } from '@/lib/config';

// Schedule SMS reminder for a request (3 hours after initial SMS)
export async function scheduleSmsReminder(
  schedulingRequestId: string
): Promise<string | null> {
  const sendAt = new Date(Date.now() + config.timing.smsReminderMs);

  return scheduleJob(
    QUEUE_NAMES.SMS_REMINDER,
    { schedulingRequestId },
    {
      startAfter: sendAt,
      singletonKey: `sms-reminder-${schedulingRequestId}`,
    }
  );
}

// Schedule request expiration (2 days after creation)
export async function scheduleRequestExpiration(
  schedulingRequestId: string
): Promise<string | null> {
  const expiresAt = new Date(Date.now() + config.timing.requestExpirationMs);

  return scheduleJob(
    QUEUE_NAMES.EXPIRE_REQUEST,
    { schedulingRequestId },
    {
      startAfter: expiresAt,
      singletonKey: `expire-${schedulingRequestId}`,
    }
  );
}

// Schedule delayed email send
export async function scheduleEmailSend(
  emailThreadId: string,
  sendAt: Date
): Promise<string | null> {
  return scheduleJob(
    QUEUE_NAMES.SEND_EMAIL,
    { emailThreadId },
    {
      startAfter: sendAt,
    }
  );
}

// Schedule Gmail watch renewal
export async function scheduleGmailWatchRenewal(
  userId: string
): Promise<string | null> {
  const renewAt = new Date(Date.now() + config.timing.gmailWatchRenewalMs);

  return scheduleJob(
    QUEUE_NAMES.GMAIL_WATCH_RENEWAL,
    { userId },
    {
      startAfter: renewAt,
      singletonKey: `gmail-watch-${userId}`,
    }
  );
}
