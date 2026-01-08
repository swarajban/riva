import { google } from 'googleapis';
import { getAuthenticatedClient, getAssistantForUser } from '@/lib/auth/google-oauth';
import { config, getRandomEmailDelay } from '@/lib/config';
import { db } from '@/lib/db';
import { emailThreads, users, UserSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/utils/logger';

interface SendEmailOptions {
  userId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string; // Gmail thread ID for replies
  schedulingRequestId?: string;
  immediate?: boolean; // Skip delay (for post-confirmation emails)
}

// Generate a Message-ID
function generateMessageId(): string {
  return `<${randomUUID()}@riva.systems>`;
}

// Build MIME message
function buildMimeMessage(options: {
  fromEmail: string;
  fromName: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];

  // Headers
  lines.push(`From: ${options.fromName} <${options.fromEmail}>`);
  lines.push(`To: ${options.to.join(', ')}`);
  if (options.cc && options.cc.length > 0) {
    lines.push(`Cc: ${options.cc.join(', ')}`);
  }
  lines.push(`Subject: ${options.subject}`);
  lines.push(`Message-ID: ${options.messageId}`);
  if (options.inReplyTo) {
    lines.push(`In-Reply-To: ${options.inReplyTo}`);
  }
  if (options.references) {
    lines.push(`References: ${options.references}`);
  }
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('');
  lines.push(options.body);

  return lines.join('\r\n');
}

// Calculate when to send (respecting blackout hours in user's timezone)
function calculateSendTime(immediate: boolean, timezone: string): Date {
  if (immediate) {
    return new Date();
  }

  const now = new Date();
  const delay = getRandomEmailDelay();
  let sendTime = new Date(now.getTime() + delay);

  // Check if in blackout period (12am-5am in user's timezone)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hour = parseInt(formatter.format(sendTime), 10);

  if (hour >= config.timing.blackoutStartHour && hour < config.timing.blackoutEndHour) {
    // Push to 5am in user's timezone
    const localDate = new Date(sendTime.toLocaleString('en-US', { timeZone: timezone }));
    localDate.setHours(config.timing.blackoutEndHour, 0, 0, 0);

    // Convert back to UTC
    const localOffset = sendTime.getTimezoneOffset();
    sendTime = new Date(localDate.getTime() - localOffset * 60 * 1000);

    // Add random delay on top
    sendTime = new Date(sendTime.getTime() + getRandomEmailDelay());
  }

  return sendTime;
}

// Queue an email for confirmation (won't be sent until approved)
export async function queueEmailForConfirmation(options: Omit<SendEmailOptions, 'immediate'>): Promise<string> {
  // Get the assistant for this user to determine the from email
  const assistant = await getAssistantForUser(options.userId);

  const messageId = generateMessageId();

  // Build references header
  let references = options.references || '';
  if (options.inReplyTo && !references.includes(options.inReplyTo)) {
    references = references ? `${references} ${options.inReplyTo}` : options.inReplyTo;
  }

  // Insert email record with null scheduledSendAt (won't be picked up by worker)
  const [emailThread] = await db
    .insert(emailThreads)
    .values({
      schedulingRequestId: options.schedulingRequestId,
      gmailThreadId: options.threadId,
      messageIdHeader: messageId,
      inReplyTo: options.inReplyTo,
      referencesHeader: references || null,
      subject: options.subject,
      fromEmail: assistant.email,
      fromName: assistant.name || 'Riva',
      toEmails: options.to,
      ccEmails: options.cc || [],
      bodyText: options.body,
      direction: 'outbound',
      scheduledSendAt: null, // Won't be picked up by worker until approved
    })
    .returning({ id: emailThreads.id });

  logger.info('Email queued for confirmation', {
    emailId: emailThread.id,
    schedulingRequestId: options.schedulingRequestId,
    subject: options.subject,
    to: options.to,
  });

  return emailThread.id;
}

// Queue an email for sending
export async function queueEmail(options: SendEmailOptions): Promise<string> {
  // Get the assistant for this user to determine the from email
  const assistant = await getAssistantForUser(options.userId);

  // Fetch user's timezone for blackout hours
  const user = await db.query.users.findFirst({
    where: eq(users.id, options.userId),
  });
  const timezone = (user?.settings as UserSettings)?.timezone || 'America/Los_Angeles';

  const messageId = generateMessageId();
  const sendTime = calculateSendTime(options.immediate || false, timezone);

  // Build references header
  let references = options.references || '';
  if (options.inReplyTo && !references.includes(options.inReplyTo)) {
    references = references ? `${references} ${options.inReplyTo}` : options.inReplyTo;
  }

  // Insert email record
  const [emailThread] = await db
    .insert(emailThreads)
    .values({
      schedulingRequestId: options.schedulingRequestId,
      gmailThreadId: options.threadId,
      messageIdHeader: messageId,
      inReplyTo: options.inReplyTo,
      referencesHeader: references || null,
      subject: options.subject,
      fromEmail: assistant.email,
      fromName: assistant.name || 'Riva',
      toEmails: options.to,
      ccEmails: options.cc || [],
      bodyText: options.body,
      direction: 'outbound',
      scheduledSendAt: sendTime,
    })
    .returning({ id: emailThreads.id });

  logger.info('Email queued', {
    emailId: emailThread.id,
    schedulingRequestId: options.schedulingRequestId,
    subject: options.subject,
    to: options.to,
    scheduledSendAt: sendTime.toISOString(),
    immediate: options.immediate || false,
  });

  // If immediate, send now; otherwise leave for worker to pick up
  if (options.immediate) {
    // Claim the email first (set sentAt to epoch) to prevent worker from picking it up
    // if the process dies after Gmail sends but before DB update completes
    await db
      .update(emailThreads)
      .set({ sentAt: new Date(0) })
      .where(eq(emailThreads.id, emailThread.id));

    try {
      await sendEmailNow(options.userId, emailThread.id);
    } catch (error) {
      // Delete the record so it doesn't get picked up by worker
      await db.delete(emailThreads).where(eq(emailThreads.id, emailThread.id));
      throw error;
    }
  }
  // Non-immediate emails will be picked up by the worker when scheduledSendAt passes

  return emailThread.id;
}

// Actually send an email (called by job handler or immediately)
export async function sendEmailNow(userId: string, emailThreadId: string): Promise<void> {
  const emailRecord = await db.query.emailThreads.findFirst({
    where: (fields, { eq }) => eq(fields.id, emailThreadId),
  });

  if (!emailRecord) {
    throw new Error(`Email thread not found: ${emailThreadId}`);
  }

  // Check if already sent (epoch timestamp = claimed but not sent yet)
  const epochTime = new Date(0).getTime();
  if (emailRecord.sentAt && emailRecord.sentAt.getTime() !== epochTime) {
    logger.info('Email already sent, skipping', { emailId: emailThreadId });
    return;
  }

  // Use the user's assistant's credentials
  const assistant = await getAssistantForUser(userId);
  const oauth2Client = await getAuthenticatedClient(assistant.id);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const mimeMessage = buildMimeMessage({
    fromEmail: emailRecord.fromEmail || assistant.email,
    fromName: emailRecord.fromName || assistant.name || 'Riva',
    to: emailRecord.toEmails as string[],
    cc: emailRecord.ccEmails as string[] | undefined,
    subject: emailRecord.subject || '',
    body: emailRecord.bodyText || '',
    messageId: emailRecord.messageIdHeader || generateMessageId(),
    inReplyTo: emailRecord.inReplyTo || undefined,
    references: emailRecord.referencesHeader || undefined,
  });

  // Encode for Gmail API
  const encodedMessage = Buffer.from(mimeMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Send
  let response;
  try {
    response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: emailRecord.gmailThreadId || undefined,
      },
    });
  } catch (error: unknown) {
    // If thread not found in sender's mailbox, retry without threadId
    // The In-Reply-To and References headers will still thread correctly for recipients
    const gaxiosError = error as { code?: number };
    if (gaxiosError.code === 404 && emailRecord.gmailThreadId) {
      logger.info('Thread not found in sender mailbox, sending without threadId', {
        gmailThreadId: emailRecord.gmailThreadId,
      });
      response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });
    } else {
      throw error;
    }
  }

  // Update record with sent info
  await db
    .update(emailThreads)
    .set({
      gmailMessageId: response.data.id,
      gmailThreadId: response.data.threadId,
      sentAt: new Date(),
      scheduledSendAt: null,
    })
    .where(eq(emailThreads.id, emailThreadId));

  logger.info('Email sent via Gmail', {
    emailId: emailThreadId,
    schedulingRequestId: emailRecord.schedulingRequestId ?? undefined,
    subject: emailRecord.subject,
    to: emailRecord.toEmails,
    gmailMessageId: response.data.id,
    gmailThreadId: response.data.threadId,
  });
}
