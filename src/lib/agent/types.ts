import { Anthropic } from '@anthropic-ai/sdk';

export interface AgentContext {
  userId: string;
  assistantId: string;
  schedulingRequestId?: string;
  triggerType: 'email' | 'sms';
  triggerContent: string;
  awaitingResponseType?: string;
}

export type ToolName =
  | 'check_availability'
  | 'send_email'
  | 'send_sms_to_user'
  | 'create_calendar_event'
  | 'cancel_calendar_event'
  | 'update_scheduling_request'
  | 'lookup_contact'
  | 'get_thread_emails'
  | 'link_threads';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  input_schema: Anthropic.Messages.Tool['input_schema'];
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
