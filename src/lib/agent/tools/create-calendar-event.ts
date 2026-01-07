import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { createCalendarEvent } from '@/lib/integrations/calendar/client';
import { db } from '@/lib/db';
import { schedulingRequests, users, UserSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseISOWithTimezone } from '@/lib/utils/time';

interface CreateEventInput {
  title: string;
  start_time: string;
  end_time: string;
  attendees: { email: string; name?: string }[];
  include_zoom_link?: boolean;
  location?: string;
  scheduling_request_id?: string; // Override context's default when processing specific confirmation
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
        description:
          "Event start time in ISO format. Use the exact ISO string from check_availability slots, or specify time in user's timezone (e.g., 2026-01-06T10:00:00 for 10am in user's timezone).",
      },
      end_time: {
        type: 'string',
        description:
          "Event end time in ISO format. Use the exact ISO string from check_availability slots, or specify time in user's timezone.",
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
      location: {
        type: 'string',
        description: 'Physical meeting location (e.g., office address, conference room). Optional - omit for virtual-only meetings.',
      },
      scheduling_request_id: {
        type: 'string',
        description: 'Override the default scheduling request ID. Use this when processing a specific numbered confirmation from allPendingConfirmations.',
      },
    },
    required: ['title', 'start_time', 'end_time', 'attendees'],
  },
};

export async function createEvent(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as CreateEventInput;

  // Get user for Zoom link
  const user = await db.query.users.findFirst({
    where: eq(users.id, context.userId),
  });

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const settings = user.settings as UserSettings;
  const includeZoom = params.include_zoom_link !== false;

  // Build description
  let description = '';
  if (includeZoom && settings.zoomPersonalLink) {
    description = `Zoom: ${settings.zoomPersonalLink}`;
  }

  // Include user as attendee
  const allAttendees = [{ email: user.email, name: user.name || undefined }, ...params.attendees];

  // Parse times with proper timezone handling
  // Times without timezone info are interpreted as being in the user's timezone
  const startTime = parseISOWithTimezone(params.start_time, settings.timezone);
  const endTime = parseISOWithTimezone(params.end_time, settings.timezone);

  // Create the event
  const eventId = await createCalendarEvent({
    assistantId: context.assistantId,
    calendarId: user.calendarId,
    title: params.title,
    startTime,
    endTime,
    attendees: allAttendees,
    description: description || undefined,
    location: params.location,
    timezone: settings.timezone,
  });

  // Update scheduling request (use override if provided, otherwise fall back to context)
  const requestIdToUpdate = params.scheduling_request_id || context.schedulingRequestId;
  if (requestIdToUpdate) {
    await db
      .update(schedulingRequests)
      .set({
        status: 'confirmed',
        confirmedStartTime: startTime,
        confirmedEndTime: endTime,
        googleCalendarEventId: eventId,
        meetingTitle: params.title,
        updatedAt: new Date(),
      })
      .where(eq(schedulingRequests.id, requestIdToUpdate));
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
