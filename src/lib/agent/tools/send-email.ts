import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { queueEmail } from '@/lib/integrations/gmail/send';
import { db } from '@/lib/db';
import { emailThreads } from '@/lib/db/schema';
import { eq, desc, and, isNotNull } from 'drizzle-orm';

interface SendEmailInput {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  thread_id?: string;
  immediate?: boolean;
}

/**
 * Normalize subject for reply threading.
 * Strips existing Re:/Fwd:/[Ext] prefixes and adds a single "Re: " prefix.
 */
function normalizeReplySubject(originalSubject: string): string {
  // Remove existing Re:/RE:/Fwd:/FWD:/[Ext] prefixes
  const base = originalSubject
    .replace(/^(\s*(re:|fwd?:|\[ext\])\s*)+/gi, '')
    .trim();
  return `Re: ${base}`;
}

export const sendEmailDef: ToolDefinition = {
  name: 'send_email',
  description: `Queue an email to be sent. By default, emails are delayed 5-15 minutes to appear more human. Use immediate: true only for confirmation emails after SMS approval.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      to: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of recipient email addresses',
      },
      cc: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of CC email addresses',
      },
      subject: {
        type: 'string',
        description: 'Email subject line (use "Re: " prefix for replies)',
      },
      body: {
        type: 'string',
        description: 'Plain text email body',
      },
      thread_id: {
        type: 'string',
        description: 'Gmail thread ID to reply to. If not provided, auto-resolved from the scheduling request emails.',
      },
      immediate: {
        type: 'boolean',
        description: 'Set to true to send immediately (only use after SMS confirmation)',
      },
    },
    required: ['to', 'subject', 'body'],
  },
};

export async function sendEmail(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as SendEmailInput;

  // Get threading info if replying to a thread
  let inReplyTo: string | undefined;
  let references: string | undefined;
  let threadId = params.thread_id;
  let resolvedSubject: string | undefined;

  // Auto-resolve thread ID and subject from scheduling request if not provided
  if (!threadId && context.schedulingRequestId) {
    // Find an email with gmailThreadId set (filter out pending outbound emails without thread ID)
    const requestEmail = await db.query.emailThreads.findFirst({
      where: and(
        eq(emailThreads.schedulingRequestId, context.schedulingRequestId),
        isNotNull(emailThreads.gmailThreadId)
      ),
      orderBy: desc(emailThreads.createdAt),
    });

    if (requestEmail?.gmailThreadId) {
      threadId = requestEmail.gmailThreadId;

      // Auto-resolve subject for proper threading (Gmail uses subject + headers for threading)
      if (requestEmail.subject) {
        resolvedSubject = normalizeReplySubject(requestEmail.subject);
      }
    }
  }

  if (threadId) {
    // Find the most recent message in this thread
    const recentMessage = await db.query.emailThreads.findFirst({
      where: eq(emailThreads.gmailThreadId, threadId),
      orderBy: desc(emailThreads.createdAt),
    });

    if (recentMessage) {
      inReplyTo = recentMessage.messageIdHeader || undefined;
      references = recentMessage.referencesHeader || undefined;
    }
  }

  // Queue the email (use resolved subject for threading, fall back to agent-provided subject)
  const emailId = await queueEmail({
    userId: context.userId,
    to: params.to,
    cc: params.cc,
    subject: resolvedSubject || params.subject,
    body: params.body,
    inReplyTo,
    references,
    threadId,
    schedulingRequestId: context.schedulingRequestId,
    immediate: params.immediate,
  });

  return {
    success: true,
    data: {
      emailId,
      scheduled: !params.immediate,
      message: params.immediate ? 'Email sent immediately.' : 'Email queued for sending with 5-15 minute delay.',
    },
  };
}
