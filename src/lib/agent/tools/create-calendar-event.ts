import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { createCalendarEvent } from '@/lib/integrations/calendar/client';
import { db } from '@/lib/db';
import { schedulingRequests, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface CreateEventInput {
  title: string;
  start_time: string;
  end_time: string;
  attendees: { email: string; name?: string }[];
  include_zoom_link?: boolean;
}

export const createEventDef: ToolDefinition = {
  name: 'create_calendar_event',
  description: `Create a Google Calendar event and send invites to all attendees. Only use this AFTER receiving explicit SMS approval from the user.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Event title. For 1:1 meetings use "{FirstName} <> {FirstName}" format.',
      },
      start_time: {
        type: 'string',
        description: 'Event start time in ISO format',
      },
      end_time: {
        type: 'string',
        description: 'Event end time in ISO format',
      },
      attendees: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['email'],
        },
        description: 'List of attendees (do not include assistants who coordinated)',
      },
      include_zoom_link: {
        type: 'boolean',
        description: 'Include Zoom personal meeting room link in description. Defaults to true.',
      },
    },
    required: ['title', 'start_time', 'end_time', 'attendees'],
  },
};

export async function createEvent(
  input: unknown,
  context: AgentContext
): Promise<ToolResult> {
  const params = input as CreateEventInput;

  // Get user for Zoom link
  const user = await db.query.users.findFirst({
    where: eq(users.id, context.userId),
  });

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const settings = user.settings as { zoomPersonalLink?: string };
  const includeZoom = params.include_zoom_link !== false;

  // Build description
  let description = '';
  if (includeZoom && settings.zoomPersonalLink) {
    description = `Zoom: ${settings.zoomPersonalLink}`;
  }

  // Include user as attendee
  const allAttendees = [
    { email: user.email, name: user.name || undefined },
    ...params.attendees,
  ];

  // Create the event
  const eventId = await createCalendarEvent({
    calendarId: user.calendarId,
    title: params.title,
    startTime: new Date(params.start_time),
    endTime: new Date(params.end_time),
    attendees: allAttendees,
    description: description || undefined,
  });

  // Update scheduling request
  if (context.schedulingRequestId) {
    await db
      .update(schedulingRequests)
      .set({
        status: 'confirmed',
        confirmedStartTime: new Date(params.start_time),
        confirmedEndTime: new Date(params.end_time),
        googleCalendarEventId: eventId,
        meetingTitle: params.title,
        updatedAt: new Date(),
      })
      .where(eq(schedulingRequests.id, context.schedulingRequestId));
  }

  return {
    success: true,
    data: {
      eventId,
      message: 'Calendar event created and invites sent to all attendees.',
      zoomLink: includeZoom && settings.zoomPersonalLink ? settings.zoomPersonalLink : null,
    },
  };
}
