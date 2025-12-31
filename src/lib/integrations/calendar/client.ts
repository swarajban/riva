import { google, calendar_v3 } from 'googleapis';
import { getAuthenticatedClient, getAssistant } from '@/lib/auth/google-oauth';

export type CalendarClient = calendar_v3.Calendar;

// Get Calendar client using assistant's credentials
export async function getCalendarClient(assistantId?: string): Promise<CalendarClient> {
  const id = assistantId || (await getAssistant()).id;
  const oauth2Client = await getAuthenticatedClient(id);
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// Get freebusy data for a time range on a specific calendar
export async function getFreeBusy(
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<calendar_v3.Schema$FreeBusyCalendar> {
  const calendar = await getCalendarClient();

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }],
    },
  });

  return response.data.calendars?.[calendarId] || { busy: [] };
}

// Create a calendar event
export interface CreateEventOptions {
  calendarId: string;
  title: string;
  startTime: Date;
  endTime: Date;
  attendees: { email: string; name?: string }[];
  description?: string;
  location?: string;
}

export async function createCalendarEvent(
  options: CreateEventOptions
): Promise<string> {
  const calendar = await getCalendarClient();

  const response = await calendar.events.insert({
    calendarId: options.calendarId,
    sendUpdates: 'all', // Send email invites to all attendees
    requestBody: {
      summary: options.title,
      description: options.description,
      location: options.location,
      start: {
        dateTime: options.startTime.toISOString(),
        timeZone: 'America/Los_Angeles',
      },
      end: {
        dateTime: options.endTime.toISOString(),
        timeZone: 'America/Los_Angeles',
      },
      attendees: options.attendees.map((a) => ({
        email: a.email,
        displayName: a.name,
      })),
    },
  });

  return response.data.id!;
}

// Cancel (delete) a calendar event
export async function cancelCalendarEvent(
  calendarId: string,
  eventId: string
): Promise<void> {
  const calendar = await getCalendarClient();

  await calendar.events.delete({
    calendarId,
    eventId,
    sendUpdates: 'all', // Notify attendees
  });
}

// Get a calendar event by ID
export async function getCalendarEvent(
  calendarId: string,
  eventId: string
): Promise<calendar_v3.Schema$Event> {
  const calendar = await getCalendarClient();

  const response = await calendar.events.get({
    calendarId,
    eventId,
  });

  return response.data;
}

// Update a calendar event
export interface UpdateEventOptions {
  calendarId: string;
  eventId: string;
  title?: string;
  startTime?: Date;
  endTime?: Date;
  description?: string;
}

export async function updateCalendarEvent(
  options: UpdateEventOptions
): Promise<void> {
  const calendar = await getCalendarClient();

  const existing = await getCalendarEvent(options.calendarId, options.eventId);

  await calendar.events.patch({
    calendarId: options.calendarId,
    eventId: options.eventId,
    sendUpdates: 'all',
    requestBody: {
      summary: options.title || existing.summary,
      description: options.description ?? existing.description,
      start: options.startTime
        ? { dateTime: options.startTime.toISOString(), timeZone: 'America/Los_Angeles' }
        : existing.start,
      end: options.endTime
        ? { dateTime: options.endTime.toISOString(), timeZone: 'America/Los_Angeles' }
        : existing.end,
    },
  });
}
