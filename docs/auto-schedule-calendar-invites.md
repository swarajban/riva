# Auto-Schedule Calendar Invites

This document describes the implementation of the auto-schedule calendar invites feature, which allows users to optionally bypass the manual approval step for calendar invites.

## Overview

Previously, all calendar invites required explicit user approval via SMS/Telegram before being sent. This feature adds a new setting `confirmCalendarInvites` that, when disabled, auto-schedules calendar invites with a 2-7 minute delay - mirroring how `confirmOutboundEmails` works for emails.

## User Setting

- **Setting**: `confirmCalendarInvites` (boolean)
- **Default**: `true` (require confirmation - existing behavior)
- **When `false`**: Calendar invites are auto-scheduled with a 2-7 minute delay

Users can toggle this in Settings > Calendar Invite Confirmation.

## Architecture

### Database Schema

#### New Table: `scheduled_calendar_events`

```sql
CREATE TABLE scheduled_calendar_events (
  id UUID PRIMARY KEY,
  scheduling_request_id UUID NOT NULL REFERENCES scheduling_requests(id),
  event_data JSONB NOT NULL,           -- CalendarEventData type
  scheduled_send_at TIMESTAMP,         -- null = awaiting approval
  sent_at TIMESTAMP,                   -- null = not yet sent
  google_calendar_event_id VARCHAR(255),
  linked_email_id UUID REFERENCES email_threads(id),
  processing_error TEXT,
  created_at TIMESTAMP DEFAULT now()
);
```

#### New Type: `CalendarEventData`

```typescript
type CalendarEventData = {
  title: string;
  startTime: string;  // ISO
  endTime: string;    // ISO
  attendees: { email: string; name?: string; optional?: boolean }[];
  location?: string;
  timezone: string;
  conferencing?: {
    type: 'zoom' | 'google_meet' | 'teams' | 'other';
    link?: string;
  } | null;
};
```

#### Modified Tables

- **`notifications`**: Added `pending_calendar_event_id` column
- **`awaiting_response_type` enum**: Added `'calendar_event_approval'`

### Flow Diagrams

#### Flow 1: confirmCalendarInvites = true (default)

```
External party confirms time
    ↓
Agent calls create_calendar_event()
    ↓
Event queued with scheduledSendAt = null
    ↓
Agent sends SMS to user asking for approval
    ↓
User responds "Y" or "N"
    ↓
Agent calls approve_calendar_event(action: 'approve'/'reject')
    ↓
If approved: createCalendarEventNow() + send linked email
```

#### Flow 2: confirmCalendarInvites = false (auto-schedule)

```
External party confirms time
    ↓
Agent calls create_calendar_event()
    ↓
Event queued with scheduledSendAt = now + 2-7 minutes
    ↓
Agent notifies user: "Scheduling [meeting] for [time]. Reply to modify/cancel."
    ↓
Worker picks up at scheduled time
    ↓
Worker sends linked email + creates calendar event
    ↓
Worker clears awaitingResponseType on notification
```

#### Flow 3: User modifies before send (auto-schedule mode)

```
User receives notification about scheduled invite
    ↓
User replies with modification (e.g., "change to 3pm")
    ↓
Agent calls approve_calendar_event(action: 'edit', edited_start_time: ...)
    ↓
Event data updated in DB
    ↓
Agent sends new preview notification
```

## Key Components

### 1. Calendar Queue Service (`src/lib/integrations/calendar/queue.ts`)

| Function | Description |
|----------|-------------|
| `queueCalendarEvent()` | Queue with random 2-7 min delay |
| `queueCalendarEventForConfirmation()` | Queue with `scheduledSendAt: null` |
| `createCalendarEventNow()` | Execute immediately |
| `updatePendingCalendarEvent()` | Update event data for edits |
| `deletePendingCalendarEvent()` | Delete cancelled events |
| `approveCalendarEvent()` | Set `scheduledSendAt = now` for immediate send |

### 2. Agent Tools

#### `create_calendar_event` (modified)

New parameters:
- `linked_email_id`: Confirmation email to send atomically
- `immediate`: Skip delay (for post-approval creation)

Behavior based on settings:
1. `immediate: true` → Create event now
2. `confirmCalendarInvites: false` → Queue with delay
3. `confirmCalendarInvites: true` → Queue for confirmation

#### `approve_calendar_event` (new)

Parameters:
- `event_id`: Pending calendar event ID
- `action`: `'approve'` | `'reject'` | `'edit'`
- `edited_*`: Optional fields for edits

Returns `{ alreadySent: true }` if event was already sent (graceful handling).

### 3. Worker (`src/lib/jobs/worker.ts`)

New function `processPendingCalendarEvents()`:
1. Query: `scheduledSendAt <= now AND sentAt IS NULL`
2. Atomically claim (set `sentAt` to epoch)
3. Send linked email if exists
4. Create Google Calendar event
5. Update `sentAt` and `googleCalendarEventId`
6. Clear `awaitingResponseType` on associated notification

### 4. Dashboard UI

#### Settings Page
- New checkbox: "Confirm calendar invites before sending"
- Description explains the 2-7 minute delay behavior

#### Request Detail Page
- "Scheduled Calendar Invite" section showing:
  - Event title and time
  - Attendees
  - Location (if set)
  - Scheduled send time with "Send now" button
  - Or "Awaiting your approval" if `scheduledSendAt` is null

### 5. Notification Service

Updated `SendNotificationOptions` to include `pendingCalendarEventId` for tracking which calendar event a notification is associated with.

## API Endpoints

### POST `/api/calendar-events/[id]/send-now`

Sends a pending calendar event immediately (used by dashboard "Send now" button).

- Validates user owns the event
- Sends linked email if exists
- Creates calendar event via Google Calendar API
- Returns `{ success: true }` or error

## Prompt Changes

The agent system prompt now includes:

1. **Conditional rule** based on `confirmCalendarInvites` setting:
   - If true: "NEVER send a calendar invite without explicit user approval"
   - If false: "Calendar invites are auto-scheduled with a 2-7 minute delay"

2. **New `calendar_event_approval` handling** section describing:
   - How to process user responses
   - Edit capabilities (time, title, location, attendees)
   - Graceful handling when invite already sent

## Migration

File: `drizzle/0009_aspiring_tiger_shark.sql`

To apply locally:
```bash
DATABASE_URL="postgresql://postgres:riva@localhost:5432/riva" npm run db:migrate
```

## Files Changed

### New Files
- `src/lib/integrations/calendar/queue.ts`
- `src/lib/agent/tools/approve-calendar-event.ts`
- `src/components/SendCalendarNowButton.tsx`
- `src/app/api/calendar-events/[id]/send-now/route.ts`
- `drizzle/0009_aspiring_tiger_shark.sql`
- `docs/auto-schedule-calendar-invites.md`

### Modified Files
- `src/lib/db/schema.ts`
- `src/lib/agent/tools/create-calendar-event.ts`
- `src/lib/agent/tools/index.ts`
- `src/lib/agent/types.ts`
- `src/lib/jobs/worker.ts`
- `src/lib/integrations/notification/service.ts`
- `src/lib/agent/tools/send-sms.ts`
- `src/lib/agent/prompts.ts`
- `src/app/dashboard/settings/page.tsx`
- `src/app/dashboard/requests/[id]/page.tsx`
- `src/components/DashboardMessageInput.tsx`

## Testing Checklist

- [ ] Enable auto-schedule mode (uncheck "Confirm calendar invites")
- [ ] Trigger a scheduling flow where external party confirms a time
- [ ] Verify invite is queued with 2-7 minute delay
- [ ] Verify user receives notification about scheduled invite
- [ ] Test "Send now" from dashboard
- [ ] Test cancellation before send time
- [ ] Test modification before send time (time change, title change, meeting title)
- [ ] Verify notification includes awaiting_response_type and pending_calendar_event_id
- [ ] Test response after invite already sent (graceful handling)
- [ ] Verify linked email is sent atomically with invite
- [ ] Re-enable confirmation mode and verify existing flow still works

## Future Enhancements

1. **Conferencing flexibility**: Currently Zoom link is set at creation time. Could allow changing conferencing type in edits.

2. **Batch operations**: Allow approving/rejecting multiple pending invites at once.

3. **Delay configuration**: Allow users to customize the delay duration (currently fixed 2-7 minutes).

4. **Calendar-specific scheduling rules**: Different delay/confirmation rules based on meeting type or attendees.
