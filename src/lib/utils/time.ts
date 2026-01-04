// Time formatting utilities for Pacific Time

const PT_TIMEZONE = 'America/Los_Angeles';

// Format time in PT (e.g., "2:30" or "10am")
export function formatTimePT(date: Date): string {
  const hours = parseInt(
    date.toLocaleString('en-US', {
      timeZone: PT_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    })
  );

  const minutes = parseInt(
    date.toLocaleString('en-US', {
      timeZone: PT_TIMEZONE,
      minute: '2-digit',
    })
  );

  let timeStr = hours > 12 ? String(hours - 12) : String(hours);
  if (hours === 0) timeStr = '12';

  if (minutes > 0) {
    timeStr += `:${String(minutes).padStart(2, '0')}`;
  }

  return timeStr;
}

// Format time range (e.g., "2-2:30pm" or "10:30-11am")
export function formatTimeSlot(start: Date, end: Date): string {
  const startHour = parseInt(
    start.toLocaleString('en-US', {
      timeZone: PT_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    })
  );

  const endHour = parseInt(
    end.toLocaleString('en-US', {
      timeZone: PT_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    })
  );

  const startStr = formatTimePT(start);
  const endStr = formatTimePT(end);

  const startAmPm = startHour >= 12 ? 'pm' : 'am';
  const endAmPm = endHour >= 12 ? 'pm' : 'am';

  // Always show am/pm - include start's am/pm only if different from end
  if (startAmPm !== endAmPm) {
    return `${startStr}${startAmPm}-${endStr}${endAmPm}`;
  }
  return `${startStr}-${endStr}${endAmPm}`;
}

// Format date for display (e.g., "Monday, 1/6")
export function formatDatePT(date: Date): string {
  return date.toLocaleDateString('en-US', {
    timeZone: PT_TIMEZONE,
    weekday: 'long',
    month: 'numeric',
    day: 'numeric',
  });
}

// Format full datetime for SMS (e.g., "Tue 1/7, 2pm PT")
export function formatDateTimePT(date: Date): string {
  const dayStr = date.toLocaleDateString('en-US', {
    timeZone: PT_TIMEZONE,
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  });

  const hour = parseInt(
    date.toLocaleString('en-US', {
      timeZone: PT_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    })
  );

  const minutes = parseInt(
    date.toLocaleString('en-US', {
      timeZone: PT_TIMEZONE,
      minute: '2-digit',
    })
  );

  let timeStr = hour > 12 ? String(hour - 12) : String(hour);
  if (hour === 0) timeStr = '12';

  if (minutes > 0) {
    timeStr += `:${String(minutes).padStart(2, '0')}`;
  }

  timeStr += hour >= 12 ? 'pm' : 'am';

  return `${dayStr}, ${timeStr} PT`;
}

// Get current date in PT
export function getNowPT(): Date {
  return new Date();
}

// Get start of today in PT
export function getStartOfTodayPT(): Date {
  const now = new Date();
  const ptDateStr = now.toLocaleDateString('en-US', {
    timeZone: PT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [month, day, year] = ptDateStr.split('/');
  return new Date(`${year}-${month}-${day}T00:00:00-08:00`);
}

// Add days to a date
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Parse relative date references like "next week", "tomorrow"
export function parseDateReference(reference: string): { start: Date; end: Date } | null {
  const now = getNowPT();
  const today = getStartOfTodayPT();
  const lowerRef = reference.toLowerCase().trim();

  if (lowerRef === 'tomorrow') {
    const start = addDays(today, 1);
    return { start, end: addDays(start, 1) };
  }

  if (lowerRef === 'this week') {
    const dayOfWeek = now.getDay();
    const daysUntilFriday = 5 - dayOfWeek;
    return { start: today, end: addDays(today, Math.max(daysUntilFriday, 1)) };
  }

  if (lowerRef === 'next week') {
    const dayOfWeek = now.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const start = addDays(today, daysUntilMonday);
    return { start, end: addDays(start, 5) };
  }

  // Try to parse day names
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = days.findIndex((d) => lowerRef.includes(d));

  if (dayIndex !== -1) {
    const currentDay = now.getDay();
    let daysUntil = dayIndex - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const start = addDays(today, daysUntil);
    return { start, end: addDays(start, 1) };
  }

  return null;
}
