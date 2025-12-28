import { google } from 'googleapis';
import { getAuthenticatedClient } from '@/lib/auth/google-oauth';
import { config, getRandomEmailDelay } from '@/lib/config';
import { db } from '@/lib/db';
import { emailThreads } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

interface SendEmailOptions {
  userId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  schedulingRequestId?: string;
  immediate?: boolean; // Skip delay (for post-confirmation emails)
}

// Generate a Message-ID
function generateMessageId(): string {
  return `<${randomUUID()}@riva.systems>`;
}

// Build MIME message
function buildMimeMessage(options: {
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
  lines.push(`From: Riva <${config.rivaEmail}>`);
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

// Calculate when to send (respecting blackout hours)
function calculateSendTime(immediate: boolean): Date {
  if (immediate) {
    return new Date();
  }

  const now = new Date();
  const delay = getRandomEmailDelay();
  let sendTime = new Date(now.getTime() + delay);

  // Check if in blackout period (12am-5am PT)
  const ptFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  const ptHour = parseInt(ptFormatter.format(sendTime), 10);

  if (ptHour >= config.timing.blackoutStartHour && ptHour < config.timing.blackoutEndHour) {
    // Push to 5am PT
    const ptDate = new Date(
      sendTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    );
    ptDate.setHours(config.timing.blackoutEndHour, 0, 0, 0);

    // Convert back to UTC
    const ptOffset = sendTime.getTimezoneOffset();
    sendTime = new Date(ptDate.getTime() - ptOffset * 60 * 1000);

    // Add random delay on top
    sendTime = new Date(sendTime.getTime() + getRandomEmailDelay());
  }

  return sendTime;
}

// Queue an email for sending
export async function queueEmail(options: SendEmailOptions): Promise<string> {
  const messageId = generateMessageId();
  const sendTime = calculateSendTime(options.immediate || false);

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
      messageIdHeader: messageId,
      inReplyTo: options.inReplyTo,
      referencesHeader: references || null,
      subject: options.subject,
      fromEmail: config.rivaEmail,
      fromName: 'Riva',
      toEmails: options.to,
      ccEmails: options.cc || [],
      bodyText: options.body,
      direction: 'outbound',
      scheduledSendAt: sendTime,
    })
    .returning({ id: emailThreads.id });

  // If immediate, send now
  if (options.immediate) {
    await sendEmailNow(options.userId, emailThread.id);
  }

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

  if (emailRecord.sentAt) {
    console.log(`Email ${emailThreadId} already sent, skipping`);
    return;
  }

  const oauth2Client = await getAuthenticatedClient(userId);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const mimeMessage = buildMimeMessage({
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
  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      threadId: emailRecord.gmailThreadId || undefined,
    },
  });

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
}
