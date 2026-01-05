import { db } from '@/lib/db';
import { schedulingRequests, notifications } from '@/lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { sendNotification } from '@/lib/integrations/notification/service';
import { logger } from '@/lib/utils/logger';

interface SmsReminderJobData {
  schedulingRequestId: string;
}

export async function handleSmsReminder(data: SmsReminderJobData): Promise<void> {
  const { schedulingRequestId } = data;

  // Get the scheduling request
  const request = await db.query.schedulingRequests.findFirst({
    where: eq(schedulingRequests.id, schedulingRequestId),
  });

  if (!request) {
    logger.info('Request not found, skipping reminder', { schedulingRequestId });
    return;
  }

  // Only send reminder if still awaiting confirmation
  if (request.status !== 'awaiting_confirmation') {
    logger.info('Request not awaiting confirmation, skipping reminder', { schedulingRequestId, status: request.status });
    return;
  }

  // Check if there's still a notification awaiting response
  const awaitingNotification = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.schedulingRequestId, schedulingRequestId),
      eq(notifications.direction, 'outbound'),
      isNotNull(notifications.awaitingResponseType)
    ),
  });

  if (!awaitingNotification) {
    logger.info('No awaiting notification, skipping reminder', { schedulingRequestId });
    return;
  }

  // Send reminder
  await sendNotification({
    userId: request.userId,
    body: `Reminder: You have a pending meeting confirmation. Reply Y to confirm or N to cancel.`,
    schedulingRequestId,
    awaitingResponseType: awaitingNotification.awaitingResponseType as 'booking_approval',
  });

  // Update request to mark reminder sent
  await db
    .update(schedulingRequests)
    .set({
      smsReminderSentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schedulingRequests.id, schedulingRequestId));

  logger.info('Reminder sent', { schedulingRequestId });
}
