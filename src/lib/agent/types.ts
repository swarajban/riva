import { Anthropic } from '@anthropic-ai/sdk';

export interface PendingConfirmation {
  referenceNumber: number;
  notificationId: string;
  schedulingRequestId: string | null;
  awaitingResponseType: string | null;
  pendingEmailId?: string | null; // For email_approval confirmations
  body: string;
  attendees?: Array<{ email: string; name?: string }>;
  meetingTitle?: string | null;
}

export interface AgentContext {
  userId: string;
  assistantId: string;
  schedulingRequestId?: string;
  triggerType: 'email' | 'sms';
  triggerContent: string;
  awaitingResponseType?: string;
  pendingEmailId?: string;
  allPendingConfirmations?: PendingConfirmation[];
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
  | 'link_threads'
  | 'approve_email'
  | 'clear_awaiting_response';

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
