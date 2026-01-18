import { db } from '@/lib/db';
import { scheduledCalendarEvents, users, UserSettings, CalendarEventData, schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createCalendarEvent } from './client';
import { getAssistantForUser } from '@/lib/auth/google-oauth';
import { getRandomEmailDelay, config } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { parseISOWithTimezone } from '@/lib/utils/time';

export interface QueueCalendarEventOptions {
  userId: string;
  schedulingRequestId: string;
  eventData: CalendarEventData;
  linkedEmailId?: string;
  immediate?: boolean;
}

// Calculate when to send (respecting blackout hours in user's timezone)
function calculateCalendarSendTime(immediate: boolean, timezone: string): Date {
  if (immediate) {
    return new Date();
  }

  const now = new Date();
  const delay = getRandomEmailDelay(); // Reuse email delay logic (2-7 minutes)
  let sendTime = new Date(now.getTime() + delay);

  // Check if in blackout period (12am-5am in user's timezone)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hour = parseInt(formatter.format(sendTime), 10);

  if (hour >= config.timing.blackoutStartHour && hour < config.timing.blackoutEndHour) {
    // Push to 5am in user's timezone
    const localDate = new Date(sendTime.toLocaleString('en-US', { timeZone: timezone }));
    localDate.setHours(config.timing.blackoutEndHour, 0, 0, 0);

    // Convert back to UTC
    const localOffset = sendTime.getTimezoneOffset();
    sendTime = new Date(localDate.getTime() - localOffset * 60 * 1000);

    // Add random delay on top
    sendTime = new Date(sendTime.getTime() + getRandomEmailDelay());
  }

  return sendTime;
}

// Queue a calendar event with delay (for auto-schedule mode)
export async function queueCalendarEvent(options: QueueCalendarEventOptions): Promise<string> {
  // Fetch user's timezone for blackout hours
  const user = await db.query.users.findFirst({
    where: eq(users.id, options.userId),
  });
  const timezone = (user?.settings as UserSettings)?.timezone || 'America/Los_Angeles';

  const sendTime = calculateCalendarSendTime(options.immediate || false, timezone);

  const [event] = await db
    .insert(scheduledCalendarEvents)
    .values({
      schedulingRequestId: options.schedulingRequestId,
      eventData: options.eventData,
      scheduledSendAt: sendTime,
      linkedEmailId: options.linkedEmailId,
    })
    .returning({ id: scheduledCalendarEvents.id });

  logger.info('Calendar event queued', {
    eventId: event.id,
    schedulingRequestId: options.schedulingRequestId,
    title: options.eventData.title,
    scheduledSendAt: sendTime.toISOString(),
    immediate: options.immediate || false,
  });

  // If immediate, create the event now
  if (options.immediate) {
    await createCalendarEventNow(options.userId, event.id);
  }

  return event.id;
}

// Queue a calendar event for confirmation (scheduledSendAt = null)
export async function queueCalendarEventForConfirmation(
  options: Omit<QueueCalendarEventOptions, 'immediate'>
): Promise<string> {
  const [event] = await db
    .insert(scheduledCalendarEvents)
    .values({
      schedulingRequestId: options.schedulingRequestId,
      eventData: options.eventData,
      scheduledSendAt: null, // Won't be picked up by worker until approved
      linkedEmailId: options.linkedEmailId,
    })
    .returning({ id: scheduledCalendarEvents.id });

  logger.info('Calendar event queued for confirmation', {
    eventId: event.id,
    schedulingRequestId: options.schedulingRequestId,
    title: options.eventData.title,
  });

  return event.id;
}

// Create a calendar event immediately
export async function createCalendarEventNow(userId: string, scheduledEventId: string): Promise<string> {
  const event = await db.query.scheduledCalendarEvents.findFirst({
    where: eq(scheduledCalendarEvents.id, scheduledEventId),
  });

  if (!event) {
    throw new Error(`Scheduled calendar event not found: ${scheduledEventId}`);
  }

  // Check if already sent
  if (event.sentAt) {
    logger.info('Calendar event already sent, skipping', { eventId: scheduledEventId });
    return event.googleCalendarEventId!;
  }

  // Get user and assistant info
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const assistant = await getAssistantForUser(userId);
  const settings = user.settings as UserSettings;
  const eventData = event.eventData as CalendarEventData;

  // Build description
  let description = '';
  if (eventData.conferencing?.link) {
    const typeLabel =
      eventData.conferencing.type === 'zoom'
        ? 'Zoom'
        : eventData.conferencing.type === 'google_meet'
          ? 'Google Meet'
          : eventData.conferencing.type === 'teams'
            ? 'Microsoft Teams'
            : 'Video call';
    description = `${typeLabel}: ${eventData.conferencing.link}`;
  }

  // Parse times with proper timezone handling
  const startTime = parseISOWithTimezone(eventData.startTime, eventData.timezone);
  const endTime = parseISOWithTimezone(eventData.endTime, eventData.timezone);

  // Include user as attendee
  const allAttendees = [{ email: user.email, name: user.name || undefined }, ...eventData.attendees];

  // Create the Google Calendar event
  const googleEventId = await createCalendarEvent({
    assistantId: assistant.id,
    calendarId: user.calendarId,
    title: eventData.title,
    startTime,
    endTime,
    attendees: allAttendees,
    description: description || undefined,
    location: eventData.location,
    timezone: eventData.timezone,
  });

  // Update the scheduled event record
  await db
    .update(scheduledCalendarEvents)
    .set({
      sentAt: new Date(),
      googleCalendarEventId: googleEventId,
      scheduledSendAt: null,
    })
    .where(eq(scheduledCalendarEvents.id, scheduledEventId));

  // Update the scheduling request
  await db
    .update(schedulingRequests)
    .set({
      status: 'confirmed',
      confirmedStartTime: startTime,
      confirmedEndTime: endTime,
      googleCalendarEventId: googleEventId,
      meetingTitle: eventData.title,
      updatedAt: new Date(),
    })
    .where(eq(schedulingRequests.id, event.schedulingRequestId));

  logger.info('Calendar event created', {
    scheduledEventId,
    googleEventId,
    schedulingRequestId: event.schedulingRequestId,
    title: eventData.title,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    attendeeCount: allAttendees.length,
  });

  return googleEventId;
}

// Get a pending calendar event by ID
export async function getPendingCalendarEvent(eventId: string) {
  return db.query.scheduledCalendarEvents.findFirst({
    where: eq(scheduledCalendarEvents.id, eventId),
  });
}

// Delete a pending calendar event
export async function deletePendingCalendarEvent(eventId: string): Promise<void> {
  await db.delete(scheduledCalendarEvents).where(eq(scheduledCalendarEvents.id, eventId));

  logger.info('Pending calendar event deleted', { eventId });
}

// Update a pending calendar event's data
export async function updatePendingCalendarEvent(
  eventId: string,
  updates: Partial<CalendarEventData>
): Promise<void> {
  const event = await db.query.scheduledCalendarEvents.findFirst({
    where: eq(scheduledCalendarEvents.id, eventId),
  });

  if (!event) {
    throw new Error(`Scheduled calendar event not found: ${eventId}`);
  }

  const currentData = event.eventData as CalendarEventData;
  const updatedData: CalendarEventData = {
    ...currentData,
    ...updates,
    attendees: updates.attendees || currentData.attendees,
  };

  await db
    .update(scheduledCalendarEvents)
    .set({ eventData: updatedData })
    .where(eq(scheduledCalendarEvents.id, eventId));

  logger.info('Pending calendar event updated', {
    eventId,
    updates: Object.keys(updates),
  });
}

// Approve and schedule a pending calendar event for immediate send
export async function approveCalendarEvent(eventId: string): Promise<void> {
  await db
    .update(scheduledCalendarEvents)
    .set({ scheduledSendAt: new Date() })
    .where(eq(scheduledCalendarEvents.id, eventId));

  logger.info('Calendar event approved for immediate send', { eventId });
}
