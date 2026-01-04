# CLAUDE.md

This file provides guidance for Claude Code when working on Riva.

## Project Overview

Riva is an AI email scheduling assistant. When CC'd on an email thread, it reads the context, checks the user's Google Calendar, proposes meeting times, waits for selection, gets user confirmation via SMS/Telegram, and creates a calendar event with Zoom link.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL with Drizzle ORM
- **LLM**: Claude Opus 4.5 with extended thinking
- **Email/Calendar**: Gmail API + Google Calendar API
- **Notifications**: Twilio SMS + Telegram Bot API
- **Background Jobs**: Polling-based worker (no pg-boss)

## Key Commands

```bash
# Start PostgreSQL (Docker)
docker run -d --name riva-postgres -e POSTGRES_PASSWORD=riva -e POSTGRES_DB=riva -p 5432:5432 postgres:18

# Install dependencies
npm install

# Push schema to database
DATABASE_URL="postgresql://postgres:riva@localhost:5432/riva" npm run db:push

# Start dev server
npm run dev

# Start background worker (separate terminal)
DATABASE_URL="postgresql://postgres:riva@localhost:5432/riva" npx tsx src/lib/jobs/worker.ts

# Start ngrok for webhooks
ngrok http 3000
```

## Key Directories

- `src/lib/db/schema.ts` - Database tables
- `src/lib/config.ts` - Environment config
- `src/lib/agent/executor.ts` - Claude agent loop with tool calling
- `src/lib/agent/prompts.ts` - System prompts
- `src/lib/agent/tools/` - Agent tools
- `src/lib/integrations/` - Gmail, Calendar, Twilio, Telegram clients
- `src/lib/jobs/` - Background job processor and handlers
- `src/app/api/webhooks/` - Gmail, Twilio, Telegram webhook routes
- `src/app/auth/user/` - User login OAuth (identity only)
- `src/app/auth/assistant/` - Assistant setup OAuth (full Gmail+Calendar scopes)

## Architecture Notes

### Per-User Assistant Model
- Each user has their own assistant (1:1 relationship via `users.assistantId`)
- User logs in with their Google account (identity verification)
- User separately connects an assistant Google account (full Gmail+Calendar OAuth)
- The assistant account is a different Google account that handles email sending/calendar access
- Users configure notification preference (SMS or Telegram via shared Twilio/Telegram)

### Scheduling Request Status Flow
```
pending → proposing → awaiting_confirmation → confirmed
                  ↘         ↙
                   expired / cancelled / error
```

### Agent Tools
1. `check_availability` - Find open calendar slots
2. `send_email` - Queue email with delay
3. `send_sms_to_user` - Send via SMS/Telegram based on user preference
4. `create_calendar_event` - Create event with Zoom
5. `cancel_calendar_event` - Delete event
6. `update_scheduling_request` - Update status/times
7. `lookup_contact` - Google People API lookup
8. `get_thread_emails` - Get full email thread
9. `link_threads` - Associate threads with request

## Common Gotchas

- **"User has no assistant"**: User must connect an assistant account via `/auth/assistant/login` before using the system.
- **Assistant vs User OAuth**: Users have minimal scopes (identity only). Assistants have full Gmail+Calendar scopes.
- **Duplicate emails**: If immediate send fails, record stays in DB and worker resends. Delete record on failure.
- **Timezone parsing**: `new Date('2026-01-06')` parses as UTC midnight = Jan 5th in PT. Parse with explicit timezone.
- **Telegram "chat not found"**: User must send `/start` to bot first. Ensure numeric chat ID, not username.

## Environment Variables

Key variables (see `.env.example` for full list):
- `DATABASE_URL` - PostgreSQL connection
- `GOOGLE_CLIENT_ID/SECRET` - OAuth credentials
- `TWILIO_*` - SMS credentials
- `TELEGRAM_BOT_TOKEN` - Telegram bot
- `ANTHROPIC_API_KEY` - Claude API
- `FAST_EMAIL_DELAY=true` - 5s delay instead of 5-15min for testing
