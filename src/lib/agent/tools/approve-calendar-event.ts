import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { db } from '@/lib/db';
import { scheduledCalendarEvents, emailThreads, CalendarEventData } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  createCalendarEventNow,
  deletePendingCalendarEvent,
  updatePendingCalendarEvent,
} from '@/lib/integrations/calendar/queue';
import { sendEmailNow } from '@/lib/integrations/gmail/send';
import { logger } from '@/lib/utils/logger';

interface ApproveCalendarEventInput {
  event_id: string;
  action: 'approve' | 'reject' | 'edit';
  edited_title?: string;
  edited_start_time?: string;
  edited_end_time?: string;
  edited_attendees?: { email: string; name?: string }[];
  edited_location?: string;
}

export const approveCalendarEventDef: ToolDefinition = {
  name: 'approve_calendar_event',
  description: `Handle user's response to a calendar event confirmation request. Use 'approve' to create the event immediately, 'reject' to cancel it, or 'edit' to update details (you must then send a new confirmation SMS with the updated preview).`,
  input_schema: {
    type: 'object' as const,
    properties: {
      event_id: {
        type: 'string',
        description: 'The ID of the pending calendar event',
      },
      action: {
        type: 'string',
        enum: ['approve', 'reject', 'edit'],
        description:
          'Action to take: approve (create event immediately), reject (cancel), or edit (update details)',
      },
      edited_title: {
        type: 'string',
        description: 'New event title (optional for edit action)',
      },
      edited_start_time: {
        type: 'string',
        description: "New start time in ISO format (optional for edit action)",
      },
      edited_end_time: {
        type: 'string',
        description: "New end time in ISO format (optional for edit action)",
      },
      edited_attendees: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['email'],
        },
        description: 'New list of attendees (optional for edit action)',
      },
      edited_location: {
        type: 'string',
        description: 'New meeting location (optional for edit action)',
      },
    },
    required: ['event_id', 'action'],
  },
};

export async function approveCalendarEvent(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as ApproveCalendarEventInput;

  const event = await db.query.scheduledCalendarEvents.findFirst({
    where: eq(scheduledCalendarEvents.id, params.event_id),
  });

  if (!event) {
    return { success: false, error: 'Calendar event not found' };
  }

  // Check if event has already been sent
  if (event.sentAt) {
    return {
      success: false,
      error: 'Calendar invite already sent',
      data: {
        alreadySent: true,
        googleCalendarEventId: event.googleCalendarEventId,
        message: 'The calendar invite was already sent. Would you like to cancel or reschedule instead?',
      },
    };
  }

  switch (params.action) {
    case 'approve': {
      // Create the calendar event immediately
      const googleEventId = await createCalendarEventNow(context.userId, params.event_id);

      // Send the linked email if it exists
      if (event.linkedEmailId) {
        try {
          await sendEmailNow(context.userId, event.linkedEmailId);
          logger.info('Linked email sent with calendar event', {
            eventId: params.event_id,
            emailId: event.linkedEmailId,
          });
        } catch (error) {
          logger.error('Failed to send linked email', error, {
            eventId: params.event_id,
            emailId: event.linkedEmailId,
          });
          // Continue - the calendar event was created successfully
        }
      }

      return {
        success: true,
        data: {
          message: 'Calendar event created and invites sent to all attendees.',
          googleCalendarEventId: googleEventId,
        },
      };
    }

    case 'reject': {
      // Delete the pending calendar event
      await deletePendingCalendarEvent(params.event_id);

      // Also delete the linked email if it exists
      if (event.linkedEmailId) {
        await db.delete(emailThreads).where(eq(emailThreads.id, event.linkedEmailId));
        logger.info('Linked email deleted with calendar event', {
          eventId: params.event_id,
          emailId: event.linkedEmailId,
        });
      }

      return {
        success: true,
        data: { message: 'Calendar event cancelled and deleted.' },
      };
    }

    case 'edit': {
      // Build update object from provided fields
      const updates: Partial<CalendarEventData> = {};

      if (params.edited_title) {
        updates.title = params.edited_title;
      }
      if (params.edited_start_time) {
        updates.startTime = params.edited_start_time;
      }
      if (params.edited_end_time) {
        updates.endTime = params.edited_end_time;
      }
      if (params.edited_attendees) {
        updates.attendees = params.edited_attendees;
      }
      if (params.edited_location !== undefined) {
        updates.location = params.edited_location || undefined;
      }

      if (Object.keys(updates).length === 0) {
        return { success: false, error: 'No edit fields provided' };
      }

      // Update the pending event
      await updatePendingCalendarEvent(params.event_id, updates);

      // Fetch the updated event to return full details
      const updatedEvent = await db.query.scheduledCalendarEvents.findFirst({
        where: eq(scheduledCalendarEvents.id, params.event_id),
      });
      const updatedData = updatedEvent?.eventData as CalendarEventData;

      return {
        success: true,
        data: {
          message: 'Calendar event updated. You must now send a new SMS/Telegram preview to the user for approval.',
          eventId: params.event_id,
          updatedTitle: updatedData?.title,
          updatedStartTime: updatedData?.startTime,
          updatedEndTime: updatedData?.endTime,
          updatedAttendees: updatedData?.attendees,
          updatedLocation: updatedData?.location,
        },
      };
    }

    default:
      return { success: false, error: 'Invalid action' };
  }
}
