import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { clearAwaitingResponse } from '@/lib/integrations/notification/service';

interface ClearAwaitingInput {
  notification_id: string;
}

export const clearAwaitingDef: ToolDefinition = {
  name: 'clear_awaiting_response',
  description: `Clear the awaiting response status for a specific notification. Call this after successfully processing a user's confirmation response to mark it as resolved. This is required when handling multiple pending confirmations.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      notification_id: {
        type: 'string',
        description: 'The notification ID to clear awaiting status for',
      },
    },
    required: ['notification_id'],
  },
};

export async function clearAwaiting(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as ClearAwaitingInput;

  await clearAwaitingResponse(params.notification_id);

  return {
    success: true,
    data: {
      message: 'Awaiting response cleared for notification.',
    },
  };
}
