import { google, gmail_v1 } from 'googleapis';
import { getAuthenticatedClient, getAssistant } from '@/lib/auth/google-oauth';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { assistants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export type GmailClient = gmail_v1.Gmail;

// Get Gmail client for the assistant
export async function getGmailClient(assistantId?: string): Promise<GmailClient> {
  const id = assistantId || (await getAssistant()).id;
  const oauth2Client = await getAuthenticatedClient(id);
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Set up Gmail push notifications
export async function setupGmailWatch(assistantId?: string): Promise<{
  historyId: string;
  expiration: string;
}> {
  const assistant = assistantId
    ? await db.query.assistants.findFirst({ where: eq(assistants.id, assistantId) })
    : await getAssistant();

  if (!assistant) throw new Error('Assistant not found');

  const gmail = await getGmailClient(assistant.id);

  const response = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: config.google.pubsubTopic,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'include',
    },
  });

  // Store the history ID on the assistant
  await db
    .update(assistants)
    .set({
      gmailHistoryId: response.data.historyId!,
      updatedAt: new Date(),
    })
    .where(eq(assistants.id, assistant.id));

  return {
    historyId: response.data.historyId!,
    expiration: response.data.expiration!,
  };
}

// Stop Gmail push notifications
export async function stopGmailWatch(assistantId?: string): Promise<void> {
  const gmail = await getGmailClient(assistantId);
  await gmail.users.stop({ userId: 'me' });
}

// Get message by ID
export async function getMessage(
  messageId: string,
  assistantId?: string
): Promise<gmail_v1.Schema$Message> {
  const gmail = await getGmailClient(assistantId);
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return response.data;
}

// Get message history since a specific historyId
export async function getHistory(
  startHistoryId: string,
  assistantId?: string
): Promise<gmail_v1.Schema$History[]> {
  const gmail = await getGmailClient(assistantId);

  try {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
    });

    return response.data.history || [];
  } catch (error: unknown) {
    // If historyId is too old, we need to do a full sync
    if (error instanceof Error && (error as { code?: number }).code === 404) {
      console.warn('History ID too old, requires full sync');
      return [];
    }
    throw error;
  }
}

// Get thread by ID with all messages
export async function getThread(
  threadId: string,
  assistantId?: string
): Promise<gmail_v1.Schema$Thread> {
  const gmail = await getGmailClient(assistantId);
  const response = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });
  return response.data;
}

// Parse email headers
export function parseHeaders(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  for (const header of headers) {
    if (header.name && header.value) {
      result[header.name.toLowerCase()] = header.value;
    }
  }

  return result;
}

// Parse email body (handles multipart messages)
export function parseBody(
  payload: gmail_v1.Schema$MessagePart | undefined
): { text: string; html: string } {
  const result = { text: '', html: '' };
  if (!payload) return result;

  function extractParts(part: gmail_v1.Schema$MessagePart) {
    const mimeType = part.mimeType || '';

    if (mimeType === 'text/plain' && part.body?.data) {
      result.text = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (mimeType === 'text/html' && part.body?.data) {
      result.html = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.parts) {
      for (const subpart of part.parts) {
        extractParts(subpart);
      }
    }
  }

  extractParts(payload);

  // If we only have HTML, convert to text (basic)
  if (!result.text && result.html) {
    result.text = result.html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return result;
}

// Parse email addresses from header
export function parseEmailAddresses(header: string | undefined): string[] {
  if (!header) return [];

  // Match email addresses in various formats
  const emails: string[] = [];
  const regex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  let match;

  while ((match = regex.exec(header)) !== null) {
    emails.push(match[1].toLowerCase());
  }

  return [...new Set(emails)]; // Dedupe
}

// Parse sender name from From header
export function parseSenderName(fromHeader: string | undefined): string | null {
  if (!fromHeader) return null;

  // Try to extract name from "Name <email>" format
  const match = fromHeader.match(/^([^<]+)\s*</);
  if (match) {
    return match[1].trim().replace(/^["']|["']$/g, '');
  }

  return null;
}

// Check if Riva is in TO or CC
export function isRivaAddressed(headers: Record<string, string>): boolean {
  const rivaEmail = config.rivaEmail.toLowerCase();
  const to = parseEmailAddresses(headers['to']);
  const cc = parseEmailAddresses(headers['cc']);

  return to.includes(rivaEmail) || cc.includes(rivaEmail);
}

// Parsed email structure
export interface ParsedEmail {
  gmailMessageId: string;
  gmailThreadId: string;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  bodyText: string;
  bodyHtml: string;
  receivedAt: Date;
}

// Parse a Gmail message into our format
export function parseGmailMessage(message: gmail_v1.Schema$Message): ParsedEmail {
  const headers = parseHeaders(message.payload?.headers);
  const body = parseBody(message.payload);
  const fromEmails = parseEmailAddresses(headers['from']);

  return {
    gmailMessageId: message.id!,
    gmailThreadId: message.threadId!,
    messageIdHeader: headers['message-id'] || null,
    inReplyTo: headers['in-reply-to'] || null,
    referencesHeader: headers['references'] || null,
    subject: headers['subject'] || '(no subject)',
    fromEmail: fromEmails[0] || 'unknown@unknown.com',
    fromName: parseSenderName(headers['from']),
    toEmails: parseEmailAddresses(headers['to']),
    ccEmails: parseEmailAddresses(headers['cc']),
    bodyText: body.text,
    bodyHtml: body.html,
    receivedAt: new Date(parseInt(message.internalDate || '0', 10)),
  };
}
