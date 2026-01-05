import { ToolDefinition, ToolName, ToolResult, AgentContext } from '../types';
import { checkAvailability, checkAvailabilityDef } from './check-availability';
import { sendEmail, sendEmailDef } from './send-email';
import { sendSmsToUser, sendSmsToUserDef } from './send-sms';
import { createEvent, createEventDef } from './create-calendar-event';
import { cancelEvent, cancelEventDef } from './cancel-calendar-event';
import { updateRequest, updateRequestDef } from './update-scheduling-request';
import { lookupContact, lookupContactDef } from './lookup-contact';
import { getThreadEmails, getThreadEmailsDef } from './get-thread-emails';
import { linkThreads, linkThreadsDef } from './link-threads';
import { logger } from '@/lib/utils/logger';

// All tool definitions
export const toolDefinitions: ToolDefinition[] = [
  checkAvailabilityDef,
  sendEmailDef,
  sendSmsToUserDef,
  createEventDef,
  cancelEventDef,
  updateRequestDef,
  lookupContactDef,
  getThreadEmailsDef,
  linkThreadsDef,
];

// Tool executor map
const toolExecutors: Record<ToolName, (input: unknown, context: AgentContext) => Promise<ToolResult>> = {
  check_availability: checkAvailability,
  send_email: sendEmail,
  send_sms_to_user: sendSmsToUser,
  create_calendar_event: createEvent,
  cancel_calendar_event: cancelEvent,
  update_scheduling_request: updateRequest,
  lookup_contact: lookupContact,
  get_thread_emails: getThreadEmails,
  link_threads: linkThreads,
};

// Execute a tool by name
export async function executeTool(toolName: ToolName, input: unknown, context: AgentContext): Promise<ToolResult> {
  const executor = toolExecutors[toolName];

  if (!executor) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
    };
  }

  try {
    return await executor(input, context);
  } catch (error) {
    logger.error('Tool execution error', error, { tool: toolName });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tool execution failed',
    };
  }
}
