# Riva - AI Email Scheduling Assistant

## Overview

Riva is an AI scheduling assistant that helps users schedule meetings via email. When CC'd on an email thread, Riva reads the context, checks the user's Google Calendar availability, proposes meeting times, and books the meeting after SMS confirmation.

## Core User Flow

1. Anurati emails Heather: "Adding Riva to help us find time to connect next week"
2. Riva receives email (via Gmail API push notification)
3. Riva parses intent, checks Anurati's Google Calendar
4. After 5-15 min delay, Riva replies to thread with 4 time options in PT
5. Heather replies: "Tuesday at 2pm works"
6. Riva sends SMS to Anurati: "Meeting: Anurati <> Heather | Tue Jan 7, 2pm PT | 30min | Zoom. Reply Y to send, N to cancel, or suggest changes"
7. Anurati replies "Y"
8. Riva immediately creates Google Calendar event with Zoom link, sends confirmation email to Heather

## Tech Stack

- Framework: Next.js 14 (App Router) - single codebase for dashboard + API
- Database: PostgreSQL on Render
- Job Queue: pg-boss (Postgres-based, no Redis needed)
- ORM: Drizzle
- LLM: Claude API (claude-sonnet-4-5-20250929)
- Email: Gmail API with push notifications
- Calendar: Google Calendar API
- SMS: Twilio
- Video: Zoom personal meeting room link (no API needed for v1)
- Auth: Google OAuth for dashboard login
- Hosting: Render (Web Service)
- Domain: app.riva.systems

## Database Schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  phone VARCHAR(20),
  google_refresh_token TEXT,
  google_access_token TEXT,
  google_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  settings JSONB DEFAULT '{
    "defaultMeetingLengthMinutes": 30,
    "zoomPersonalLink": null,
    "workingHoursStart": "10:00",
    "workingHoursEnd": "17:00",
    "workingDays": ["mon", "tue", "wed", "thu", "fri"],
    "timezone": "America/Los_Angeles",
    "bufferMinutes": 15,
    "lookaheadDays": 10,
    "numOptionsToSuggest": 4,
    "maxSlotsPerDay": 2,
    "keywordRules": []
  }'::jsonb
);

-- keywordRules example:
-- [{"phrase": "time to connect", "meetingLengthMinutes": 30, "allowedDays": ["mon", "wed"], "hourRangeStart": "14:00", "hourRangeEnd": "17:00"}]

CREATE TABLE scheduling_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  
  status VARCHAR(50) DEFAULT 'pending',
  -- pending: just received, agent processing
  -- proposing: sent time options to external party
  -- awaiting_confirmation: external confirmed, waiting for user SMS approval
  -- confirmed: meeting booked
  -- expired: timed out
  -- cancelled: explicitly cancelled
  -- error: processing failed
  
  attendees JSONB DEFAULT '[]'::jsonb,
  -- [{"email": "heather@acme.com", "name": "Heather Smith"}]
  
  meeting_title VARCHAR(255),
  meeting_length_minutes INT,
  include_video_link BOOLEAN DEFAULT TRUE,
  
  matched_keyword_rule JSONB,
  requested_timeframe TEXT,
  
  proposed_times JSONB DEFAULT '[]'::jsonb,
  -- [{"start": "2025-01-08T14:00:00-08:00", "end": "2025-01-08T14:30:00-08:00", "round": 1}]
  
  confirmed_start_time TIMESTAMPTZ,
  confirmed_end_time TIMESTAMPTZ,
  google_calendar_event_id VARCHAR(255),
  
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  sms_reminder_sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduling_request_id UUID REFERENCES scheduling_requests(id) ON DELETE CASCADE,
  
  gmail_message_id VARCHAR(255) UNIQUE,
  gmail_thread_id VARCHAR(255),
  message_id_header VARCHAR(255),
  in_reply_to VARCHAR(255),
  references_header TEXT,
  
  subject VARCHAR(500),
  from_email VARCHAR(255),
  from_name VARCHAR(255),
  to_emails JSONB,
  cc_emails JSONB,
  body_text TEXT,
  body_html TEXT,
  
  direction VARCHAR(10) NOT NULL, -- 'inbound' or 'outbound'
  
  processed BOOLEAN DEFAULT FALSE,
  processing_error TEXT,
  
  scheduled_send_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduling_request_id UUID REFERENCES scheduling_requests(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  
  direction VARCHAR(10) NOT NULL, -- 'inbound' or 'outbound'
  body TEXT NOT NULL,
  
  awaiting_response_type VARCHAR(50),
  -- 'booking_approval': waiting for Y/N/changes
  -- 'availability_guidance': no slots found, asking what to do
  -- 'stale_slot_decision': slot became unavailable
  -- 'reschedule_approval': external party requested reschedule
  -- 'cancel_approval': external party requested cancel
  
  twilio_message_sid VARCHAR(255),
  
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_scheduling_requests_user_status ON scheduling_requests(user_id, status);
CREATE INDEX idx_scheduling_requests_expires ON scheduling_requests(expires_at) WHERE status IN ('pending', 'proposing', 'awaiting_confirmation');
CREATE INDEX idx_email_threads_gmail_thread ON email_threads(gmail_thread_id);
CREATE INDEX idx_email_threads_gmail_message ON email_threads(gmail_message_id);
CREATE INDEX idx_email_threads_request ON email_threads(scheduling_request_id);
CREATE INDEX idx_email_threads_pending_send ON email_threads(scheduled_send_at) WHERE scheduled_send_at IS NOT NULL AND sent_at IS NULL;
CREATE INDEX idx_sms_awaiting ON sms_messages(user_id, awaiting_response_type) WHERE awaiting_response_type IS NOT NULL;
```

## Gmail Integration

### Required Scopes
- gmail.readonly
- gmail.send
- gmail.modify
- calendar
- userinfo.email
- userinfo.profile

### Behavior
- Use Gmail push notifications via Pub/Sub (not polling)
- Gmail watch expires after ~7 days, must renew before expiration
- Riva should respond when CC'd OR in TO field
- Maintain proper email threading using Message-ID, In-Reply-To, References headers
- Send from riva@semprehealth.com

## Google Calendar Integration

### Availability Logic
- Use freebusy API to check primary calendar
- Respect busy/free status
- Treat tentative/unconfirmed events as busy
- Apply buffer time (default 15 min) before and after busy slots
- Only check primary calendar (no multi-calendar support in v1)

### Slot Finding
- Working hours: 10am-5pm PT, Mon-Fri (configurable)
- Default lookahead: by Friday of following week
- If email specifies timeframe ("next week", "Thursday"), respect it
- Return numOptionsToSuggest slots (default 4)
- Maximum maxSlotsPerDay slots per day (default 2)
- Start slot search from earliest available 30-minute boundary

### Event Creation
- Title format for 1:1 meetings: "{FirstName} <> {FirstName}" (e.g., "Anurati <> Heather")
- Title format for 3+ attendees: Ask user via SMS for meeting title (may be org name, topic, etc.)
- Include Zoom personal meeting room link in description (if video enabled)
- Send calendar invites to all attendees via Google Calendar (sendUpdates: 'all')

### Time Format in Emails
- Format: "Day, M/D: time-time, time-time PT"
- Examples: "Monday, 1/6: 2-2:30, 4-5 PT" or "Tuesday, 1/7: 10:30-11am, 2-3 PT"
- Include colon only when minutes are non-zero (use "2" not "2:00", but use "2:30" not "230")
- Show am/pm only when needed to avoid ambiguity (e.g., "10:30-11am" when times span morning)
- PT appears once at the end of each line
- Multiple slots on same day grouped together

## Twilio SMS Integration

### Inbound SMS Handling
- Match phone number to user
- Find most recent scheduling request awaiting SMS response for that user
- Pass to agent for processing

### SMS Response Types

**Booking Approval (awaiting_response_type: 'booking_approval')**
- "Y" / "Yes" / "Send" → Create calendar event, send confirmation email
- "N" / "No" / "Cancel" → Cancel request, do NOT notify external party
- Number (e.g., "30") → Change meeting duration to 30 minutes
- "Tomorrow" → Find new slots for tomorrow
- Natural language (e.g., "can you check if she's free at 3pm instead") → Follow up with external party

**Availability Guidance (awaiting_response_type: 'availability_guidance')**
- No slots found in requested window
- Options: "extend" to widen search, specific dates, "custom" to ask external party

**Stale Slot Decision (awaiting_response_type: 'stale_slot_decision')**
- Selected slot became unavailable between proposal and confirmation
- Ask user what to do (may want to bump existing meeting)

**Reschedule/Cancel Approval**
- External party requested change
- Require explicit user approval before taking action

### SMS Timing
- Send reminder if no response after 3 hours
- Auto-expire request after 2 days (mark as expired, no further action)
- Never auto-send invites without explicit user approval

## Email Sending Behavior

### Delay Logic
- All outbound emails delayed 5-15 minutes (random)
- Never send emails between 12am-5am PT
- If email would send during blackout: queue until 5am PT, then apply 5-15 min delay
- Exception: After user confirms via SMS, send confirmation email immediately (no delay)

### Reply Behavior
- If external party replies only to Riva (not user): Riva replies just to external party (act human)
- If user forwards an email to Riva with context: Pick up conversation, reply to appropriate thread
- Use LLM to determine correct thread and recipients when ambiguous

## Agent System

### Agent Triggers
1. Inbound email where Riva is in TO or CC
2. Inbound SMS from registered user

### Available Tools
1. **check_availability** - Find open slots given date range, meeting length, optional day/time preferences
2. **send_email** - Queue email with delay (to, cc, subject, body, optional thread_id for replies)
3. **send_sms_to_user** - Send SMS for confirmation/guidance with awaiting_response_type
4. **create_calendar_event** - Create event with attendees, optional Zoom link
5. **cancel_calendar_event** - Delete existing event by ID
6. **update_scheduling_request** - Update status, attendees, times, etc.
7. **lookup_contact** - Look up contact info by email via Google Contacts/People API
8. **get_thread_emails** - Get full thread history for context
9. **link_threads** - Link email thread to existing scheduling request (for forwarded threads)

### Agent Personality
- Professional and formal tone
- No exclamation marks
- Valediction: "Thanks" (not "Best", "Cheers", etc.)
- Concise - avoid unnecessary words
- Human-like - acting as user's assistant, not a robot
- Always present times in Pacific Time (PT)

### Keyword Rules
User can define keyword rules that override defaults:
- Phrase to match (e.g., "time to connect")
- Custom meeting length
- Allowed days
- Allowed hour range

## Dashboard Features

### Request List View
- Show all scheduling requests for user
- Display: meeting title, attendees, status, confirmed time (if booked), created time
- Status badges: pending (yellow), proposing (blue), awaiting_confirmation (purple), confirmed (green), expired (gray), cancelled (red), error (red)
- Click to view details

### Request Detail View
- Full email thread history
- SMS history
- Proposed times
- Confirmed booking details
- Manual thread linking: ability to associate another email thread with this request
- Error details if failed

### Settings Page
- Working hours (start/end time)
- Working days (checkboxes)
- Default meeting length
- Buffer between meetings
- Number of options to suggest
- Max slots per day
- Zoom personal meeting room link
- Keyword rules (add/edit/remove)

## Error Handling

### No Availability Found
- SMS user with options: extend window, specify dates, ask external party for availability

### Email Parsing Failure / Unclear Intent
- Show error in dashboard
- SMS user that something went wrong with link to dashboard

### Stale Slot
- If selected time became unavailable before booking
- SMS user to decide (may want to bump existing meeting)

## Environment Variables

```
DATABASE_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://app.riva.systems/auth/callback
GOOGLE_PUBSUB_TOPIC=projects/{project}/topics/gmail-push
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
ANTHROPIC_API_KEY
NEXT_PUBLIC_APP_URL=https://app.riva.systems
RIVA_EMAIL=riva@semprehealth.com
SESSION_SECRET
```

## Manual Setup Steps

### 1. Google Cloud Setup
1. Create project at console.cloud.google.com
2. Enable APIs: Gmail, Calendar, People, Pub/Sub
3. Create OAuth consent screen (Internal for Workspace, or External)
4. Add scopes: gmail.readonly, gmail.send, gmail.modify, calendar, userinfo.email, userinfo.profile
5. Create OAuth 2.0 credentials (Web application)
6. Set redirect URI: https://app.riva.systems/auth/callback
7. Create Pub/Sub topic: gmail-push
8. Grant publish permissions to gmail-api-push@system.gserviceaccount.com
9. Create push subscription pointing to https://app.riva.systems/api/webhooks/gmail

### 2. Twilio Setup
1. Create account at twilio.com
2. Get phone number with SMS capability
3. Configure webhook for incoming SMS: https://app.riva.systems/api/webhooks/twilio (POST)

### 3. Render Setup
1. Create PostgreSQL database
2. Create Web Service connected to GitHub repo
3. Set all environment variables
4. Add custom domain: app.riva.systems

### 4. DNS Setup
1. Add CNAME record: app → {render-app}.onrender.com

### 5. Initial User Setup
Insert initial user record with phone number, then have user complete Google OAuth to store tokens.

## Sample Email Flows

### Flow 1: Basic Scheduling

**Email 1 (Anurati → Heather, CC Riva):**
```
Subject: Catch up
Hey Heather, adding Riva to help find time to connect next week. 
```

**Email 2 (Riva → Heather, CC Anurati):** [after 5-15 min delay]
```
Subject: Re: Catch up
Hi Heather,

I have a few times that work for a 30-minute call:

- Monday, 1/6: 2-2:30 PT
- Tuesday, 1/7: 10:30-11am PT
- Wednesday, 1/8: 3-3:30 PT
- Thursday, 1/9: 11-11:30am PT

Let me know what works for you.

Thanks,
Riva
```

**Email 3 (Heather → Riva, Anurati):**
```
Tuesday works for me!
```

**SMS (Riva → Anurati):**
```
📅 Anurati <> Heather
Tue 1/7, 10:30am PT | 30min | Zoom
Reply Y to send, N to cancel, or make changes
```

**SMS (Anurati → Riva):**
```
Y
```

**Email 4 (Riva → Heather, CC Anurati):** [immediate, no delay]
```
Subject: Re: Catch up
I've sent a calendar invite for Tuesday, 1/7 at 10:30am PT.

Zoom: https://zoom.us/j/xxxxx

Thanks,
Riva
```

### Flow 2: User Counter-Proposal via SMS

**Email 1 (Anurati → Heather, CC Riva):**
```
Subject: Quick sync
Hey Heather, adding Riva to find a time for us to chat this week.
```

**Email 2 (Riva → Heather, CC Anurati):** [after 5-15 min delay]
```
Subject: Re: Quick sync
Hi Heather,

Here are a few times that work:

- Tuesday, 1/7: 10:30-11am PT
- Wednesday, 1/8: 2-2:30 PT
- Thursday, 1/9: 11-11:30am, 3-3:30 PT

Let me know what works for you.

Thanks,
Riva
```

**Email 3 (Heather → Riva, Anurati):**
```
Tuesday at 10:30 works great!
```

**SMS (Riva → Anurati):**
```
📅 Anurati <> Heather
Tue 1/7, 10:30am PT | 30min | Zoom
Reply Y to send, N to cancel, or make changes
```

**SMS (Anurati → Riva):**
```
Can we do 2pm instead
```

**SMS (Riva → Anurati):**
```
✓ You're free at 2pm on Tue 1/7.
Reply Y to send, N to cancel
```

**SMS (Anurati → Riva):**
```
Y
```

**Email 4 (Riva → Heather, CC Anurati):** [immediate, no delay]
```
Subject: Re: Quick sync
Hi Heather,

Slight change - could we do 2pm PT on Tuesday instead? I've sent a calendar invite for that time.

Zoom: https://zoom.us/j/xxxxx

Thanks,
Riva
```

### Flow 3: No Availability

**SMS (Riva → Anurati):**
```
⚠️ No availability found for meeting with Heather next week.
Reply "extend" to look 2 weeks out, specific dates to try, or "custom" to ask Heather for her availability
```

### Flow 4: External Party Reschedule Request

**Email 1 (Heather → Riva, Anurati):**
```
Hi, something came up. Can we reschedule our Tuesday call?
```

**SMS (Riva → Anurati):**
```
🔄 Heather wants to reschedule:
Anurati <> Heather | Tue 1/7, 2pm PT

Reply Y to find new times, N to cancel meeting
```

**SMS (Anurati → Riva):**
```
Y
```

**Email 2 (Riva → Heather, CC Anurati):** [after 5-15 min delay]
```
Subject: Re: Quick sync
No problem. Here are some other times that work:

- Wednesday, 1/8: 10-10:30am, 3-3:30 PT
- Thursday, 1/9: 11-11:30am PT
- Friday, 1/10: 2-2:30 PT

Let me know what works.

Thanks,
Riva
```

(Flow continues as normal scheduling from here)

### Flow 5: Forwarded Thread Linking

**Email (Anurati → Riva):** [forwarding separate thread]
```
Subject: Fwd: Quick sync
This is about the Heather meeting we're scheduling
```

Riva links forwarded thread to existing Heather scheduling request and continues appropriately.

### Flow 6: Ambiguous Confirmation

**Email (Heather → Riva, Anurati):**
```
Yes, that works!
```
(But multiple times were proposed)

**Email (Riva → Heather, CC Anurati):** [after delay]
```
Just to confirm - which time works for you?

- Monday, 1/6: 2-2:30 PT
- Tuesday, 1/7: 10:30-11am PT
- Wednesday, 1/8: 3-3:30 PT
- Thursday, 1/9: 11-11:30am PT

Thanks,
Riva
```

### Flow 7: External Party Counter-Proposal

**Email (Heather → Riva, Anurati):**
```
Could we do 30 minutes earlier on Tuesday?
```

Riva checks if 10:00am is free. If yes, sends SMS to Anurati for approval with new time. If no, replies to Heather with alternative options.

### Flow 8: External Party's Assistant Coordinates

**Email 1 (Anurati → Heather, CC Riva):**
```
Subject: Intro call
Hey Heather, adding Riva to help find time for us to connect.
```

**Email 2 (Heather → Anurati, Riva, CC Sarah):**
```
Great! Adding my assistant Sarah to help coordinate.
```

**Email 3 (Riva → Sarah, CC Anurati, Heather):** [after 5-15 min delay]
```
Subject: Re: Intro call
Hi Sarah,

Here are a few times that work for Anurati:

- Monday, 1/6: 2-2:30 PT
- Tuesday, 1/7: 10:30-11am PT
- Wednesday, 1/8: 3-3:30 PT
- Thursday, 1/9: 11-11:30am PT

Let me know what works for Heather.

Thanks,
Riva
```

**Email 4 (Sarah → Riva, Anurati, Heather):**
```
Wednesday at 3pm works for Heather.
```

**SMS (Riva → Anurati):**
```
📅 Anurati <> Heather
Wed 1/8, 3pm PT | 30min | Zoom
(Coordinated with Sarah)
Reply Y to send, N to cancel, or make changes
```

**SMS (Anurati → Riva):**
```
Y
```

**Calendar invite sent to:** Anurati, Heather (NOT Sarah - she's the assistant, not an attendee)

**Email 5 (Riva → Sarah, CC Anurati, Heather):** [immediate]
```
Subject: Re: Intro call
I've sent a calendar invite to Anurati and Heather for Wednesday, 1/8 at 3pm PT.

Zoom: https://zoom.us/j/xxxxx

Thanks,
Riva
```

### Flow 9: Multiple Attendees from External Party

**Email 1 (Anurati → Heather, CC Riva):**
```
Subject: Product demo
Hey Heather, adding Riva to find time for a product demo.
```

**Email 2 (Heather → Anurati, Riva, CC Mike, Lisa):**
```
Great! Adding Mike and Lisa from my team - they should join too.
```

**Email 3 (Riva → Heather, Mike, Lisa, CC Anurati):** [after 5-15 min delay]
```
Subject: Re: Product demo
Hi all,

Here are a few times that work:

- Monday, 1/6: 2-2:30 PT
- Tuesday, 1/7: 10:30-11am PT
- Wednesday, 1/8: 3-3:30 PT
- Thursday, 1/9: 11-11:30am PT

Let me know what works for everyone.

Thanks,
Riva
```

**Email 4 (Heather → Riva, Mike, Lisa, Anurati):**
```
Tuesday works for all of us!
```

**SMS (Riva → Anurati):**
```
📅 Meeting with Heather, Mike, Lisa
Tue 1/7, 10:30am PT | 30min | Zoom
What should the calendar title be?
```

**SMS (Anurati → Riva):**
```
Sempre Health Product Demo
```

**SMS (Riva → Anurati):**
```
Got it. Reply Y to send, N to cancel, or make changes
```

**SMS (Anurati → Riva):**
```
Y
```

**Calendar invite sent to:** Anurati, Heather, Mike, Lisa
**Calendar title:** "Sempre Health Product Demo"

**Email 5 (Riva → Heather, Mike, Lisa, CC Anurati):** [immediate]
```
Subject: Re: Product demo
I've sent calendar invites to everyone for Tuesday, 1/7 at 10:30am PT.

Zoom: https://zoom.us/j/xxxxx

Thanks,
Riva
```
