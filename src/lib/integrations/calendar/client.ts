import { google, calendar_v3 } from 'googleapis';
import { getAuthenticatedClient } from '@/lib/auth/google-oauth';

export type CalendarClient = calendar_v3.Calendar;

// Get Calendar client for a user
export async function getCalendarClient(userId: string): Promise<CalendarClient> {
  const oauth2Client = await getAuthenticatedClient(userId);
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// Get freebusy data for a time range
export async function getFreeBusy(
  userId: string,
  timeMin: Date,
  timeMax: Date
): Promise<calendar_v3.Schema$FreeBusyCalendar> {
  const calendar = await getCalendarClient(userId);

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: 'primary' }],
    },
  });

  return response.data.calendars?.primary || { busy: [] };
}

// Create a calendar event
export interface CreateEventOptions {
  userId: string;
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
  const calendar = await getCalendarClient(options.userId);

  const response = await calendar.events.insert({
    calendarId: 'primary',
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
  userId: string,
  eventId: string
): Promise<void> {
  const calendar = await getCalendarClient(userId);

  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all', // Notify attendees
  });
}

// Get a calendar event by ID
export async function getCalendarEvent(
  userId: string,
  eventId: string
): Promise<calendar_v3.Schema$Event> {
  const calendar = await getCalendarClient(userId);

  const response = await calendar.events.get({
    calendarId: 'primary',
    eventId,
  });

  return response.data;
}

// Update a calendar event
export interface UpdateEventOptions {
  userId: string;
  eventId: string;
  title?: string;
  startTime?: Date;
  endTime?: Date;
  description?: string;
}

export async function updateCalendarEvent(
  options: UpdateEventOptions
): Promise<void> {
  const calendar = await getCalendarClient(options.userId);

  const existing = await getCalendarEvent(options.userId, options.eventId);

  await calendar.events.patch({
    calendarId: 'primary',
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
