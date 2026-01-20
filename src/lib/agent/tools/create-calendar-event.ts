import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { createCalendarEvent } from '@/lib/integrations/calendar/client';
import {
  queueCalendarEvent,
  queueCalendarEventForConfirmation,
} from '@/lib/integrations/calendar/queue';
import { db } from '@/lib/db';
import { schedulingRequests, users, UserSettings, CalendarEventData } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseISOWithTimezone } from '@/lib/utils/time';
import { logger } from '@/lib/utils/logger';

interface CreateEventInput {
  title: string;
  start_time: string;
  end_time: string;
  attendees: { email: string; name?: string }[];
  include_zoom_link?: boolean;
  location?: string;
  scheduling_request_id?: string; // Override context's default when processing specific confirmation
  linked_email_id?: string; // Confirmation email to send atomically with the invite
  immediate?: boolean; // Skip delay/confirmation (for post-approval creation)
}

export const createEventDef: ToolDefinition = {
  name: 'create_calendar_event',
  description: `Create a Google Calendar event and send invites to all attendees. Behavior depends on user settings:
- If confirmCalendarInvites is true (default): queues event for confirmation via SMS
- If confirmCalendarInvites is false: auto-schedules with 2-7 minute delay
- If immediate=true: creates event now (use after SMS approval)`,
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
      linked_email_id: {
        type: 'string',
        description: 'ID of confirmation email to send atomically with the calendar invite. The email will be sent at the same time as the invite.',
      },
      immediate: {
        type: 'boolean',
        description: 'Skip delay and create event immediately. Use this after receiving SMS approval. Defaults to false.',
      },
    },
    required: ['title', 'start_time', 'end_time', 'attendees'],
  },
};

export async function createEvent(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as CreateEventInput;

  // Get user for settings
  const user = await db.query.users.findFirst({
    where: eq(users.id, context.userId),
  });

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const settings = user.settings as UserSettings;
  const includeZoom = params.include_zoom_link !== false;

  // Get the scheduling request ID (use override if provided)
  const requestId = params.scheduling_request_id || context.schedulingRequestId;
  if (!requestId) {
    return { success: false, error: 'No scheduling request ID provided' };
  }

  // Parse times with proper timezone handling
  const startTime = parseISOWithTimezone(params.start_time, settings.timezone);
  const endTime = parseISOWithTimezone(params.end_time, settings.timezone);

  // Build event data for queueing
  const eventData: CalendarEventData = {
    title: params.title,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    attendees: params.attendees,
    location: params.location,
    timezone: settings.timezone,
    conferencing:
      includeZoom && settings.zoomPersonalLink
        ? { type: 'zoom', link: settings.zoomPersonalLink }
        : null,
  };

  // Determine behavior based on settings and immediate flag
  const confirmCalendarInvites = settings.confirmCalendarInvites !== false; // Default true

  // Case 1: immediate=true - create event now (after SMS approval)
  if (params.immediate) {
    // Include user as attendee
    const allAttendees = [{ email: user.email, name: user.name || undefined }, ...params.attendees];

    // Build description
    let description = '';
    if (includeZoom && settings.zoomPersonalLink) {
      description = `Zoom: ${settings.zoomPersonalLink}`;
    }

    // Create the event immediately
    const googleEventId = await createCalendarEvent({
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

    logger.info('Calendar event created immediately', {
      googleEventId,
      schedulingRequestId: requestId,
      title: params.title,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      attendeeCount: allAttendees.length,
    });

    // Update scheduling request
    await db
      .update(schedulingRequests)
      .set({
        status: 'confirmed',
        confirmedStartTime: startTime,
        confirmedEndTime: endTime,
        googleCalendarEventId: googleEventId,
        meetingTitle: params.title,
        updatedAt: new Date(),
      })
      .where(eq(schedulingRequests.id, requestId));

    return {
      success: true,
      data: {
        eventId: googleEventId,
        message: 'Calendar event created and invites sent to all attendees.',
        zoomLink: includeZoom && settings.zoomPersonalLink ? settings.zoomPersonalLink : null,
        mode: 'immediate',
      },
    };
  }

  // Case 2: confirmCalendarInvites=false - queue with delay (auto-schedule mode)
  if (!confirmCalendarInvites) {
    const queuedEventId = await queueCalendarEvent({
      userId: context.userId,
      schedulingRequestId: requestId,
      eventData,
      linkedEmailId: params.linked_email_id,
    });

    logger.info('Calendar event queued for auto-send', {
      queuedEventId,
      schedulingRequestId: requestId,
      title: params.title,
    });

    return {
      success: true,
      data: {
        queuedEventId,
        message: 'Calendar event has been scheduled. User will be notified and can cancel/modify before it sends.',
        zoomLink: includeZoom && settings.zoomPersonalLink ? settings.zoomPersonalLink : null,
        mode: 'auto_scheduled',
      },
    };
  }

  // Case 3: confirmCalendarInvites=true (default) - queue for confirmation
  const queuedEventId = await queueCalendarEventForConfirmation({
    userId: context.userId,
    schedulingRequestId: requestId,
    eventData,
    linkedEmailId: params.linked_email_id,
  });

  logger.info('Calendar event queued for confirmation', {
    queuedEventId,
    schedulingRequestId: requestId,
    title: params.title,
  });

  return {
    success: true,
    data: {
      queuedEventId,
      message: 'Calendar event queued. Waiting for user confirmation via SMS before sending.',
      zoomLink: includeZoom && settings.zoomPersonalLink ? settings.zoomPersonalLink : null,
      mode: 'awaiting_confirmation',
    },
  };
}
