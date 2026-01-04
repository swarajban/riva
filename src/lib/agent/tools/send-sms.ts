import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { sendNotification } from '@/lib/integrations/notification/service';
import { scheduleSmsReminder, scheduleRequestExpiration } from '@/lib/jobs/scheduler';

interface SendSmsInput {
  body: string;
  awaiting_response_type?:
    | 'booking_approval'
    | 'availability_guidance'
    | 'stale_slot_decision'
    | 'reschedule_approval'
    | 'cancel_approval'
    | 'meeting_title';
}

export const sendSmsToUserDef: ToolDefinition = {
  name: 'send_sms_to_user',
  description: `Send an SMS to the user. Set awaiting_response_type to indicate what kind of response you're expecting.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      body: {
        type: 'string',
        description: 'The SMS message body. Keep concise for SMS format.',
      },
      awaiting_response_type: {
        type: 'string',
        enum: [
          'booking_approval',
          'availability_guidance',
          'stale_slot_decision',
          'reschedule_approval',
          'cancel_approval',
          'meeting_title',
        ],
        description: 'Type of response expected from user. Required to properly route their reply.',
      },
    },
    required: ['body'],
  },
};

export async function sendSmsToUser(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as SendSmsInput;

  const notificationId = await sendNotification({
    userId: context.userId,
    body: params.body,
    schedulingRequestId: context.schedulingRequestId,
    awaitingResponseType: params.awaiting_response_type,
  });

  // Schedule reminder and expiration if this is a booking approval request
  if (params.awaiting_response_type === 'booking_approval' && context.schedulingRequestId) {
    await scheduleSmsReminder(context.schedulingRequestId);
    await scheduleRequestExpiration(context.schedulingRequestId);
  }

  return {
    success: true,
    data: {
      notificationId,
      message: 'Message sent to user.',
      awaitingResponse: params.awaiting_response_type || null,
    },
  };
}
