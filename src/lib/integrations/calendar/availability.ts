import { getFreeBusy } from './client';
import { UserSettings } from '@/lib/db/schema';
import { createDateInTimezone, getDateStringInTimezone } from '@/lib/utils/time';

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface FindSlotsOptions {
  assistantId: string;
  calendarId: string;
  settings: UserSettings;
  startDate: Date;
  endDate: Date;
  meetingLengthMinutes: number;
  preferredDays?: string[];
  preferredTimeRange?: { start: string; end: string };
}

// Convert day name to day of week (0 = Sunday)
const dayNameToNumber: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

// Parse time string (HH:MM) to minutes since midnight
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Check if a date is a working day
function isWorkingDay(date: Date, workingDays: string[]): boolean {
  const dayOfWeek = date.getDay();
  return workingDays.some((day) => dayNameToNumber[day] === dayOfWeek);
}

// Get working hours for a specific day in user's timezone
function getWorkingHoursForDay(
  date: Date,
  workingHoursStart: string,
  workingHoursEnd: string,
  timezone: string,
  preferredTimeRange?: { start: string; end: string }
): { start: Date; end: Date } {
  // Use preferred time range if specified, otherwise use default working hours
  const startTime = preferredTimeRange?.start || workingHoursStart;
  const endTime = preferredTimeRange?.end || workingHoursEnd;

  // Get the date string in user's timezone
  const dateStr = getDateStringInTimezone(date, timezone);

  // Create dates in user's timezone (handles DST automatically)
  const start = createDateInTimezone(dateStr, startTime, timezone);
  const end = createDateInTimezone(dateStr, endTime, timezone);

  return { start, end };
}

// Merge overlapping busy intervals
function mergeBusyIntervals(intervals: TimeSlot[]): TimeSlot[] {
  if (intervals.length === 0) return [];

  // Sort by start time
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeSlot[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start.getTime() <= last.end.getTime()) {
      // Overlapping - extend the end
      last.end = new Date(Math.max(last.end.getTime(), current.end.getTime()));
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// Find multiple slots in a gap, spread out across the available time
function findSlotsInGap(gapStart: number, gapEnd: number, meetingLengthMs: number): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const thirtyMin = 30 * 60 * 1000;

  // Round gap start to nearest 30-minute boundary
  const roundedGapStart = Math.ceil(gapStart / thirtyMin) * thirtyMin;
  const availableTime = gapEnd - roundedGapStart;

  if (availableTime < meetingLengthMs) return slots;

  // Calculate how many slots could fit (at 30-min intervals)
  const possibleSlotStarts: number[] = [];
  let slotStart = roundedGapStart;
  while (slotStart + meetingLengthMs <= gapEnd) {
    possibleSlotStarts.push(slotStart);
    slotStart += thirtyMin;
  }

  if (possibleSlotStarts.length === 0) return slots;

  // If only 1-2 possible slots, return them all
  if (possibleSlotStarts.length <= 2) {
    return possibleSlotStarts.map((start) => ({
      start: new Date(start),
      end: new Date(start + meetingLengthMs),
    }));
  }

  // Otherwise, pick slots spread across the gap: first, middle, last
  const first = possibleSlotStarts[0];
  const last = possibleSlotStarts[possibleSlotStarts.length - 1];
  const midIndex = Math.floor(possibleSlotStarts.length / 2);
  const mid = possibleSlotStarts[midIndex];

  // Return up to 3 well-spread slots per gap
  const selected = [first];
  if (mid !== first && mid !== last) {
    selected.push(mid);
  }
  if (last !== first) {
    selected.push(last);
  }

  return selected.map((start) => ({
    start: new Date(start),
    end: new Date(start + meetingLengthMs),
  }));
}

// Find free slots in a day given busy intervals
function findFreeSlotsInDay(
  workingStart: Date,
  workingEnd: Date,
  busyIntervals: TimeSlot[],
  meetingLengthMs: number
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  let searchStart = workingStart.getTime();
  const workingEndMs = workingEnd.getTime();

  // Sort busy intervals
  const sortedBusy = busyIntervals
    .filter((b) => b.end.getTime() > workingStart.getTime() && b.start.getTime() < workingEnd.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const busy of sortedBusy) {
    const busyStart = Math.max(busy.start.getTime(), workingStart.getTime());
    const gapEnd = busyStart;

    // Find multiple slots in this gap
    if (gapEnd - searchStart >= meetingLengthMs) {
      const gapSlots = findSlotsInGap(searchStart, gapEnd, meetingLengthMs);
      slots.push(...gapSlots);
    }

    // Move search start to after this busy slot
    searchStart = Math.max(searchStart, busy.end.getTime());
  }

  // Check for slots after last busy period
  if (workingEndMs - searchStart >= meetingLengthMs) {
    const gapSlots = findSlotsInGap(searchStart, workingEndMs, meetingLengthMs);
    slots.push(...gapSlots);
  }

  return slots;
}

// Main function: Find available slots
export async function findAvailableSlots(options: FindSlotsOptions): Promise<TimeSlot[]> {
  const {
    assistantId,
    calendarId,
    settings,
    startDate,
    endDate,
    meetingLengthMinutes,
    preferredDays,
    preferredTimeRange,
  } = options;

  const { workingHoursStart, workingHoursEnd, workingDays, bufferMinutes, numOptionsToSuggest, maxSlotsPerDay } =
    settings;

  // Get freebusy data
  const freeBusy = await getFreeBusy(assistantId, calendarId, startDate, endDate);

  // Build busy intervals with buffer
  const busyIntervals: TimeSlot[] = (freeBusy.busy || []).map((b) => ({
    start: new Date(new Date(b.start!).getTime() - bufferMinutes * 60 * 1000),
    end: new Date(new Date(b.end!).getTime() + bufferMinutes * 60 * 1000),
  }));

  const mergedBusy = mergeBusyIntervals(busyIntervals);
  const meetingLengthMs = meetingLengthMinutes * 60 * 1000;
  const effectiveWorkingDays = preferredDays || workingDays;

  const allSlots: TimeSlot[] = [];
  const slotsPerDay: Record<string, number> = {};

  // Iterate through each day
  let currentDate = new Date(startDate);
  while (currentDate <= endDate && allSlots.length < numOptionsToSuggest) {
    const dateKey = currentDate.toISOString().split('T')[0];

    // Skip non-working days
    if (!isWorkingDay(currentDate, effectiveWorkingDays)) {
      currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }

    // Skip if we've hit max slots for this day
    if ((slotsPerDay[dateKey] || 0) >= maxSlotsPerDay) {
      currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }

    // Get working hours for this day
    const { start: workingStart, end: workingEnd } = getWorkingHoursForDay(
      currentDate,
      workingHoursStart,
      workingHoursEnd,
      settings.timezone,
      preferredTimeRange
    );

    // Find free slots
    const daySlots = findFreeSlotsInDay(workingStart, workingEnd, mergedBusy, meetingLengthMs);

    // Add slots up to max per day and total needed
    for (const slot of daySlots) {
      if (allSlots.length >= numOptionsToSuggest) break;
      if ((slotsPerDay[dateKey] || 0) >= maxSlotsPerDay) break;

      allSlots.push(slot);
      slotsPerDay[dateKey] = (slotsPerDay[dateKey] || 0) + 1;
    }

    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
  }

  // Filter out any slots that are in the past (defensive check)
  const now = new Date();
  return allSlots.filter((slot) => slot.start.getTime() > now.getTime());
}

// Check if a specific slot is still available
export async function isSlotAvailable(
  assistantId: string,
  calendarId: string,
  slot: TimeSlot,
  bufferMinutes: number
): Promise<boolean> {
  const freeBusy = await getFreeBusy(
    assistantId,
    calendarId,
    new Date(slot.start.getTime() - bufferMinutes * 60 * 1000),
    new Date(slot.end.getTime() + bufferMinutes * 60 * 1000)
  );

  // If there are no busy slots overlapping, the slot is available
  const busy = freeBusy.busy || [];
  for (const b of busy) {
    const busyStart = new Date(b.start!).getTime();
    const busyEnd = new Date(b.end!).getTime();
    const slotStart = slot.start.getTime() - bufferMinutes * 60 * 1000;
    const slotEnd = slot.end.getTime() + bufferMinutes * 60 * 1000;

    // Check for overlap
    if (busyStart < slotEnd && busyEnd > slotStart) {
      return false;
    }
  }

  return true;
}
