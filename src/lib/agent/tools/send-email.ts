import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { queueEmail, queueEmailForConfirmation } from '@/lib/integrations/gmail/send';
import { sendNotification } from '@/lib/integrations/notification/service';
import { db } from '@/lib/db';
import { emailThreads, users, UserSettings } from '@/lib/db/schema';
import { eq, desc, and, isNotNull } from 'drizzle-orm';

interface SendEmailInput {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  thread_id?: string;
  immediate?: boolean;
  scheduling_request_id?: string;
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
      scheduling_request_id: {
        type: 'string',
        description:
          'Override the default scheduling request ID. Use this when processing a specific numbered confirmation to ensure the email goes to the correct thread.',
      },
    },
    required: ['to', 'subject', 'body'],
  },
};

// Format email preview for SMS/Telegram confirmation
function formatEmailPreview(to: string[], cc: string[] | undefined, subject: string, body: string): string {
  const recipients = [...to];
  if (cc && cc.length > 0) {
    recipients.push(...cc.map((e) => `${e} (CC)`));
  }

  return `Email to send:
To: ${recipients.join(', ')}
Subject: ${subject}
---
${body}
---
Reply: Y to send, N to cancel, or describe changes`;
}

export async function sendEmail(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as SendEmailInput;

  // Use override scheduling_request_id if provided, otherwise fall back to context
  const schedulingRequestId = params.scheduling_request_id || context.schedulingRequestId;

  // Check if user has email confirmation enabled
  const user = await db.query.users.findFirst({
    where: eq(users.id, context.userId),
  });
  const settings = user?.settings as UserSettings | undefined;
  const confirmOutboundEmails = settings?.confirmOutboundEmails ?? false;

  // Get threading info if replying to a thread
  let inReplyTo: string | undefined;
  let references: string | undefined;
  let threadId = params.thread_id;
  let resolvedSubject: string | undefined;

  // Auto-resolve thread ID and subject from scheduling request if not provided
  if (!threadId && schedulingRequestId) {
    // Find an email with gmailThreadId set (filter out pending outbound emails without thread ID)
    const requestEmail = await db.query.emailThreads.findFirst({
      where: and(
        eq(emailThreads.schedulingRequestId, schedulingRequestId),
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

  const finalSubject = resolvedSubject || params.subject;

  // If email confirmation is enabled, queue for confirmation instead of sending
  if (confirmOutboundEmails && !params.immediate) {
    const emailId = await queueEmailForConfirmation({
      userId: context.userId,
      to: params.to,
      cc: params.cc,
      subject: finalSubject,
      body: params.body,
      inReplyTo,
      references,
      threadId,
      schedulingRequestId,
    });

    // Send SMS/Telegram notification asking for approval
    const preview = formatEmailPreview(params.to, params.cc, finalSubject, params.body);
    await sendNotification({
      userId: context.userId,
      body: preview,
      schedulingRequestId,
      awaitingResponseType: 'email_approval',
      pendingEmailId: emailId,
    });

    return {
      success: true,
      data: {
        emailId,
        awaitingConfirmation: true,
        message: 'Email queued for user approval. User will receive SMS/Telegram preview and must approve before sending.',
      },
    };
  }

  // Normal flow: queue the email for sending
  const emailId = await queueEmail({
    userId: context.userId,
    to: params.to,
    cc: params.cc,
    subject: finalSubject,
    body: params.body,
    inReplyTo,
    references,
    threadId,
    schedulingRequestId,
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
