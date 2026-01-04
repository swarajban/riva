import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { db } from '@/lib/db';
import { emailThreads } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getThread, parseGmailMessage } from '@/lib/integrations/gmail/client';

interface GetThreadEmailsInput {
  thread_id?: string;
  scheduling_request_id?: string;
}

export const getThreadEmailsDef: ToolDefinition = {
  name: 'get_thread_emails',
  description: `Get all emails in a thread for context. Can lookup by Gmail thread ID or by scheduling request ID.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      thread_id: {
        type: 'string',
        description: 'Gmail thread ID to fetch',
      },
      scheduling_request_id: {
        type: 'string',
        description: 'Scheduling request ID to get associated thread emails',
      },
    },
  },
};

export async function getThreadEmails(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as GetThreadEmailsInput;

  // Get from database first
  const requestId = params.scheduling_request_id || context.schedulingRequestId;

  if (requestId) {
    const emails = await db.query.emailThreads.findMany({
      where: eq(emailThreads.schedulingRequestId, requestId),
      orderBy: asc(emailThreads.createdAt),
    });

    if (emails.length > 0) {
      return {
        success: true,
        data: {
          source: 'database',
          emails: emails.map((e) => ({
            id: e.id,
            gmailMessageId: e.gmailMessageId,
            direction: e.direction,
            from: e.fromEmail,
            fromName: e.fromName,
            to: e.toEmails,
            cc: e.ccEmails,
            subject: e.subject,
            body: e.bodyText,
            sentAt: e.sentAt,
            receivedAt: e.receivedAt,
          })),
          count: emails.length,
        },
      };
    }
  }

  // If thread_id provided, fetch from Gmail
  if (params.thread_id) {
    try {
      const thread = await getThread(params.thread_id, context.assistantId);
      const messages = thread.messages || [];

      return {
        success: true,
        data: {
          source: 'gmail',
          emails: messages.map((m) => {
            const parsed = parseGmailMessage(m);
            return {
              gmailMessageId: parsed.gmailMessageId,
              from: parsed.fromEmail,
              fromName: parsed.fromName,
              to: parsed.toEmails,
              cc: parsed.ccEmails,
              subject: parsed.subject,
              body: parsed.bodyText,
              receivedAt: parsed.receivedAt,
            };
          }),
          count: messages.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  return {
    success: true,
    data: {
      emails: [],
      count: 0,
      message: 'No thread ID or scheduling request ID provided',
    },
  };
}
