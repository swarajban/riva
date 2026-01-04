import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { queueEmail } from '@/lib/integrations/gmail/send';
import { db } from '@/lib/db';
import { emailThreads } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

interface SendEmailInput {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  thread_id?: string;
  immediate?: boolean;
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
        description: 'Gmail thread ID to reply to. If not provided, starts a new thread.',
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

  if (params.thread_id) {
    // Find the most recent message in this thread
    const recentMessage = await db.query.emailThreads.findFirst({
      where: eq(emailThreads.gmailThreadId, params.thread_id),
      orderBy: desc(emailThreads.createdAt),
    });

    if (recentMessage) {
      inReplyTo = recentMessage.messageIdHeader || undefined;
      references = recentMessage.referencesHeader || undefined;
    }
  }

  // Queue the email
  const emailId = await queueEmail({
    userId: context.userId,
    to: params.to,
    cc: params.cc,
    subject: params.subject,
    body: params.body,
    inReplyTo,
    references,
    threadId: params.thread_id,
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
