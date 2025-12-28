# Working on Riva

This document provides context for picking up the Riva project with a fresh context window.

## What is Riva?

Riva is an AI email scheduling assistant. When CC'd on an email thread, it:
1. Reads the email context to understand scheduling intent
2. Checks the user's Google Calendar for availability
3. Proposes 4 meeting time options to the external party
4. Waits for external party to select a time
5. Sends SMS to user for final confirmation (Y/N)
6. Creates Google Calendar event and sends confirmation email

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL on Render
- **ORM**: Drizzle
- **Job Queue**: pg-boss (Postgres-based)
- **LLM**: Claude API (claude-sonnet-4-5-20250929)
- **Email**: Gmail API with push notifications
- **Calendar**: Google Calendar API
- **SMS**: Twilio
- **Auth**: Google OAuth 2.0
- **Styling**: Tailwind CSS (no component library)
- **Hosting**: Render (Web Service)
- **Domain**: app.riva.systems

## Key Files

```
src/
├── lib/
│   ├── db/schema.ts           # Database tables (users, scheduling_requests, email_threads, sms_messages)
│   ├── agent/executor.ts      # Claude agent loop with tool calling
│   ├── agent/tools/*.ts       # 9 agent tools
│   ├── integrations/
│   │   ├── gmail/client.ts    # Gmail read/send/watch
│   │   ├── calendar/          # Freebusy + events
│   │   └── twilio/client.ts   # SMS send/receive
│   └── jobs/queue.ts          # pg-boss job queue
├── app/
│   ├── api/webhooks/
│   │   ├── gmail/route.ts     # Gmail push notifications
│   │   └── twilio/route.ts    # Inbound SMS
│   └── dashboard/             # User-facing UI
```

## Core Spec Reference

Full spec is at `docs/riva-spec-v2.md`. Key points:

### Database Tables
1. **users** - OAuth tokens, settings (working hours, keyword rules)
2. **scheduling_requests** - Status machine, proposed/confirmed times
3. **email_threads** - Gmail message tracking, threading headers
4. **sms_messages** - Twilio messages, awaiting_response_type

### Status Machine
```
pending → proposing → awaiting_confirmation → confirmed
                  ↘         ↙
                   expired / cancelled / error
```

### Agent Tools
1. check_availability - Google Calendar freebusy
2. send_email - Queue with 5-15 min delay
3. send_sms_to_user - Twilio with response tracking
4. create_calendar_event - Google Calendar
5. cancel_calendar_event - Google Calendar
6. update_scheduling_request - Status updates
7. lookup_contact - Google People API
8. get_thread_emails - Thread history
9. link_threads - Manual thread association

### Time Formatting
Format: "Day, M/D: time-time PT"
Examples:
- "Monday, 1/6: 2-2:30, 4-5 PT"
- "Tuesday, 1/7: 10:30-11am PT"

### Email Delay Logic
- All outbound emails: 5-15 min random delay
- Blackout: 12am-5am PT (queue until 5am)
- Exception: Post-confirmation emails send immediately

## Local Development

### Prerequisites
1. Node.js 18+
2. Docker (for local Postgres)
3. ngrok for webhook testing
4. Google Cloud project with OAuth + APIs enabled
5. Twilio account with SMS number

### Setup

```bash
# 1. Start local Postgres via Docker
docker run --name riva-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=riva \
  -p 5432:5432 \
  -d postgres:16

# 2. Install dependencies
npm install

# 3. Copy env file and update values
cp .env.example .env.local
# Edit .env.local with:
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/riva

# 4. Run migrations
npm run db:push

# 5. Start dev server
npm run dev

# 6. In another terminal, start ngrok
ngrok http 3000
```

### Docker Commands

```bash
# Stop Postgres
docker stop riva-postgres

# Start Postgres (after machine restart)
docker start riva-postgres

# View logs
docker logs riva-postgres

# Remove container (data will be lost)
docker rm -f riva-postgres
```

### ngrok Webhook Setup
When ngrok gives you a URL like `https://abc123.ngrok.io`:

1. **Google Cloud Console**: Update OAuth redirect URI to `https://abc123.ngrok.io/auth/callback`
2. **Pub/Sub Subscription**: Update push endpoint to `https://abc123.ngrok.io/api/webhooks/gmail`
3. **Twilio Console**: Update SMS webhook to `https://abc123.ngrok.io/api/webhooks/twilio`

### Testing the Agent
```bash
# Seed a test user (update phone number first)
npm run seed:user

# Complete OAuth flow in browser
open http://localhost:3000/auth/login

# Send a test email with Riva CC'd, or:
npm run test:agent
```

## Task Tracking

See `docs/tasks.md` for ordered task list with status.

## Key Decisions

- **Single user MVP** - No multi-user switching for now
- **Build first, test later** - Tests added as separate phase
- **Real APIs via ngrok** - For webhook testing
- **Tailwind only** - No component library

## Common Issues

### Token Refresh
Tokens auto-refresh 5 minutes before expiration. Check `src/lib/auth/google-oauth.ts`.

### Email Threading
Gmail requires proper Message-ID, In-Reply-To, References headers. See `src/lib/utils/email-threading.ts`.

### Stale Slots
If a proposed slot becomes unavailable, the agent sends an SMS with `stale_slot_decision` type.

## Updating the Spec

When discovering new edge cases or functionality, update `docs/riva-spec-v2.md` with:
- New flow examples
- Edge case handling
- Any spec clarifications
