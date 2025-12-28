import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { db } from '@/lib/db';
import { emailThreads } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface LinkThreadsInput {
  gmail_thread_id: string;
  scheduling_request_id: string;
}

export const linkThreadsDef: ToolDefinition = {
  name: 'link_threads',
  description: `Link a Gmail thread to an existing scheduling request. Use this when a forwarded email thread should be associated with an existing request.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      gmail_thread_id: {
        type: 'string',
        description: 'Gmail thread ID to link',
      },
      scheduling_request_id: {
        type: 'string',
        description: 'Scheduling request ID to link to',
      },
    },
    required: ['gmail_thread_id', 'scheduling_request_id'],
  },
};

export async function linkThreads(
  input: unknown,
  context: AgentContext
): Promise<ToolResult> {
  const params = input as LinkThreadsInput;

  // Update all emails in this thread to point to the scheduling request
  const result = await db
    .update(emailThreads)
    .set({
      schedulingRequestId: params.scheduling_request_id,
    })
    .where(eq(emailThreads.gmailThreadId, params.gmail_thread_id));

  return {
    success: true,
    data: {
      message: `Thread ${params.gmail_thread_id} linked to request ${params.scheduling_request_id}`,
      updatedCount: result.rowCount,
    },
  };
}
