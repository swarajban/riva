import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { cancelCalendarEvent } from '@/lib/integrations/calendar/client';
import { db } from '@/lib/db';
import { schedulingRequests, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface CancelEventInput {
  event_id: string;
}

export const cancelEventDef: ToolDefinition = {
  name: 'cancel_calendar_event',
  description: `Cancel (delete) a Google Calendar event. This will notify all attendees.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      event_id: {
        type: 'string',
        description: 'The Google Calendar event ID to cancel',
      },
    },
    required: ['event_id'],
  },
};

export async function cancelEvent(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as CancelEventInput;

  // Get user for calendarId
  const user = await db.query.users.findFirst({
    where: eq(users.id, context.userId),
  });

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  await cancelCalendarEvent(context.assistantId, user.calendarId, params.event_id);

  // Update scheduling request if we have one
  if (context.schedulingRequestId) {
    await db
      .update(schedulingRequests)
      .set({
        status: 'cancelled',
        googleCalendarEventId: null,
        updatedAt: new Date(),
      })
      .where(eq(schedulingRequests.id, context.schedulingRequestId));
  }

  return {
    success: true,
    data: {
      message: 'Calendar event cancelled. Attendees have been notified.',
    },
  };
}
