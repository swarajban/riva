import { ToolDefinition, ToolResult, AgentContext } from '../types';
import { db } from '@/lib/db';
import { users, UserSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { findAvailableSlots, TimeSlot } from '@/lib/integrations/calendar/availability';
import {
  startOfDayInTimezone,
  endOfDayInTimezone,
  formatTimeSlotInTimezone,
  getTimezoneAbbreviation,
  getTomorrowDateString,
} from '@/lib/utils/time';

interface CheckAvailabilityInput {
  start_date: string;
  end_date: string;
  meeting_length_minutes?: number;
  preferred_days?: string[];
  preferred_time_start?: string;
  preferred_time_end?: string;
}

export const checkAvailabilityDef: ToolDefinition = {
  name: 'check_availability',
  description: `Find open slots on the user's calendar within a date range. Returns available time slots that respect working hours, buffer times, and existing calendar events.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      start_date: {
        type: 'string',
        description: 'Start date for search in ISO format (YYYY-MM-DD)',
      },
      end_date: {
        type: 'string',
        description: 'End date for search in ISO format (YYYY-MM-DD)',
      },
      meeting_length_minutes: {
        type: 'number',
        description: 'Duration of the meeting in minutes. Defaults to user setting.',
      },
      preferred_days: {
        type: 'array',
        items: { type: 'string' },
        description: 'Preferred days of week (e.g., ["mon", "tue", "wed"])',
      },
      preferred_time_start: {
        type: 'string',
        description: 'Preferred start time (HH:MM format, e.g., "14:00")',
      },
      preferred_time_end: {
        type: 'string',
        description: 'Preferred end time (HH:MM format, e.g., "17:00")',
      },
    },
    required: ['start_date', 'end_date'],
  },
};

export async function checkAvailability(input: unknown, context: AgentContext): Promise<ToolResult> {
  const params = input as CheckAvailabilityInput;

  // Get user settings
  const user = await db.query.users.findFirst({
    where: eq(users.id, context.userId),
  });

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const settings = user.settings as UserSettings;

  // Enforce that start_date is at least tomorrow (no same-day scheduling)
  const tomorrowStr = getTomorrowDateString(settings.timezone);
  const effectiveStartDate = params.start_date < tomorrowStr ? tomorrowStr : params.start_date;
  const effectiveEndDate = params.end_date < tomorrowStr ? tomorrowStr : params.end_date;

  // Parse dates in user's timezone (handles DST automatically)
  const startDate = startOfDayInTimezone(effectiveStartDate, settings.timezone);
  const endDate = endOfDayInTimezone(effectiveEndDate, settings.timezone);

  // Find slots
  const slots = await findAvailableSlots({
    assistantId: context.assistantId,
    calendarId: user.calendarId,
    settings,
    startDate,
    endDate,
    meetingLengthMinutes: params.meeting_length_minutes || settings.defaultMeetingLengthMinutes,
    preferredDays: params.preferred_days,
    preferredTimeRange:
      params.preferred_time_start && params.preferred_time_end
        ? { start: params.preferred_time_start, end: params.preferred_time_end }
        : undefined,
  });

  if (slots.length === 0) {
    return {
      success: true,
      data: {
        slots: [],
        message: 'No available slots found in the requested time range.',
        formatted: 'No availability found.',
      },
    };
  }

  // Format slots for display
  const formattedSlots = formatSlotsForEmail(slots, settings.timezone);

  return {
    success: true,
    data: {
      slots: slots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
      })),
      formatted: formattedSlots,
      count: slots.length,
    },
  };
}

// Format slots in the email style: "Monday, 1/6: 2-2:30, 4-5 PT"
function formatSlotsForEmail(slots: TimeSlot[], timezone: string): string {
  // Group by day
  const byDay: Record<string, TimeSlot[]> = {};

  for (const slot of slots) {
    const dayKey = slot.start.toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'numeric',
      day: 'numeric',
    });

    if (!byDay[dayKey]) {
      byDay[dayKey] = [];
    }
    byDay[dayKey].push(slot);
  }

  // Format each day
  const lines: string[] = [];
  const tzAbbrev = getTimezoneAbbreviation(timezone);

  for (const [day, daySlots] of Object.entries(byDay)) {
    const timeRanges = daySlots.map((slot) => formatTimeSlotInTimezone(slot.start, slot.end, timezone));
    lines.push(`- ${day}: ${timeRanges.join(', ')} ${tzAbbrev}`);
  }

  return lines.join('\n');
}
