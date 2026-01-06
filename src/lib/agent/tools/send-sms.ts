import { ToolDefinition, ToolResult, AgentContext } from '../types';
import {
  sendNotification,
  updateNotification,
  getProviderForUser,
} from '@/lib/integrations/notification/service';
import { sendTelegramMessage } from '@/lib/integrations/telegram/client';
import { config } from '@/lib/config';
import Twilio from 'twilio';
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
  update_notification_id?: string;
}

export const sendSmsToUserDef: ToolDefinition = {
  name: 'send_sms_to_user',
  description: `Send an SMS/Telegram message to the user. Set awaiting_response_type to indicate what kind of response you're expecting. When re-sending an edited confirmation (e.g., user changed title/duration/location), use update_notification_id to update the existing notification instead of creating a new one - this preserves the reference number.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      body: {
        type: 'string',
        description: 'The message body. Keep concise for SMS format.',
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
      update_notification_id: {
        type: 'string',
        description:
          'If editing an existing confirmation (e.g., user requested title/time/location change), pass the notification ID to update. This preserves the reference number. Get the notification ID from allPendingConfirmations based on the referenceNumber the user specified.',
      },
    },
    required: ['body'],
  },
};

export async function sendSmsToUser(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as SendSmsInput;

  let notificationId: string;

  if (params.update_notification_id) {
    // Update existing notification instead of creating a new one (preserves reference number)
    const { provider, user } = await getProviderForUser(context.userId);

    let providerMessageId: string;
    if (provider === 'telegram') {
      providerMessageId = await sendTelegramMessage(user.telegramChatId!, params.body);
    } else {
      const client = Twilio(config.twilio.accountSid, config.twilio.authToken);
      const message = await client.messages.create({
        body: params.body,
        to: user.phone!,
        from: config.twilio.phoneNumber,
      });
      providerMessageId = message.sid;
    }

    await updateNotification(params.update_notification_id, params.body, providerMessageId);
    notificationId = params.update_notification_id;
  } else {
    // Create new notification (reference number logic handled in sendNotification())
    notificationId = await sendNotification({
      userId: context.userId,
      body: params.body,
      schedulingRequestId: context.schedulingRequestId,
      awaitingResponseType: params.awaiting_response_type,
    });

    // Schedule reminder and expiration if this is a booking approval request (only for new notifications)
    if (params.awaiting_response_type === 'booking_approval' && context.schedulingRequestId) {
      await scheduleSmsReminder(context.schedulingRequestId);
      await scheduleRequestExpiration(context.schedulingRequestId);
    }
  }

  return {
    success: true,
    data: {
      notificationId,
      message: params.update_notification_id ? 'Confirmation updated and re-sent.' : 'Message sent to user.',
      awaitingResponse: params.awaiting_response_type || null,
    },
  };
}
