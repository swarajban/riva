# Working on Riva

Context for picking up the Riva project with a fresh context window.

## What is Riva?

Riva is an AI email scheduling assistant. When CC'd on an email thread, it:
1. Reads the email context to understand scheduling intent
2. Checks the user's Google Calendar for availability
3. Proposes meeting time options to the external party
4. Waits for external party to select a time
5. Sends SMS/Telegram to user for final confirmation
6. Creates Google Calendar event with Zoom link and sends confirmation email

## Architecture

### Per-User Assistant Model

| Entity | Role | Access |
|--------|------|--------|
| **Users** | People who use Riva | Login identity, notification preferences |
| **Assistants** | Per-user email account | Gmail (read/send), Calendar, OAuth tokens |

- Each user connects their own assistant Google account (1:1 relationship)
- The assistant account is a separate Google account from the user's login
- Assistants handle email sending and calendar management on behalf of their user
- Users configure their notification preference (SMS or Telegram)

### Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL (Docker locally, Render in prod)
- **ORM**: Drizzle
- **LLM**: Claude Opus 4.5 with extended thinking
- **Email**: Gmail API with Pub/Sub push notifications
- **Calendar**: Google Calendar API
- **Notifications**: Twilio SMS + Telegram Bot API
- **Auth**: Google OAuth (separate flows for assistant + users)
- **Background Jobs**: Polling-based worker (no pg-boss)

### Flow Diagram

```
┌─────────────────┐     ┌─────────────────┐
│  Gmail Pub/Sub  │────▶│  Webhook API    │
└─────────────────┘     └────────┬────────┘
                                 │
┌─────────────────┐              ▼
│ Twilio/Telegram │────▶┌─────────────────┐
│    Webhooks     │     │   AI Agent      │
└─────────────────┘     │  (Claude Opus)  │
                        └────────┬────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│   Calendar   │        │    Email     │        │ Notification │
│     API      │        │    Send      │        │    Service   │
└──────────────┘        └──────────────┘        └──────────────┘
```

## Key Files

```
src/
├── lib/
│   ├── db/schema.ts              # Database tables
│   ├── config.ts                 # Environment config
│   ├── agent/
│   │   ├── executor.ts           # Claude agent loop with tool calling
│   │   ├── prompts.ts            # System prompts
│   │   └── tools/*.ts            # Agent tools
│   ├── integrations/
│   │   ├── gmail/                # Gmail client + send
│   │   ├── calendar/             # Freebusy + events
│   │   ├── notification/         # Unified SMS/Telegram service
│   │   └── telegram/             # Telegram Bot API client
│   ├── jobs/
│   │   ├── worker.ts             # Background job processor
│   │   ├── scheduler.ts          # Job scheduling
│   │   └── handlers/             # Job handlers
│   └── auth/
│       ├── google-oauth.ts       # OAuth token management
│       └── session.ts            # User sessions
├── app/
│   ├── api/webhooks/
│   │   ├── gmail/route.ts        # Gmail push notifications
│   │   ├── twilio/route.ts       # Inbound SMS
│   │   └── telegram/route.ts     # Inbound Telegram
│   ├── auth/                     # OAuth flows
│   └── dashboard/                # User-facing UI
```

## Database Schema

- **assistants** - Per-user assistant accounts (Gmail/Calendar OAuth tokens)
- **users** - Individual users (assistantId FK, notification preference, settings)
- **scheduling_requests** - Meeting requests being processed
- **email_threads** - Inbound/outbound emails
- **notifications** - SMS/Telegram messages (replaced sms_messages)

### Status Machine

```
pending → proposing → awaiting_confirmation → confirmed
                  ↘         ↙
                   expired / cancelled / error
```

## Local Development

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL)
- ngrok (for webhooks)

### Setup

```bash
# Start PostgreSQL
docker run -d --name riva-postgres -e POSTGRES_PASSWORD=riva -e POSTGRES_DB=riva -p 5432:5432 postgres:18

# Install dependencies
npm install

# Copy env and fill in values
cp .env.example .env.local

# Push schema to database
DATABASE_URL="postgresql://postgres:riva@localhost:5432/riva" npm run db:push

# Start dev server
npm run dev

# Start background worker (separate terminal)
DATABASE_URL="postgresql://postgres:riva@localhost:5432/riva" npx tsx src/lib/jobs/worker.ts

# Start ngrok for webhooks
ngrok http 3000
```

### Webhook Configuration

When ngrok gives you a URL like `https://abc123.ngrok.io`:

1. **Gmail**: Set Pub/Sub push subscription to `https://<ngrok>/api/webhooks/gmail`
2. **Twilio**: Set webhook URL to `https://<ngrok>/api/webhooks/twilio`
3. **Telegram**:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<ngrok>/api/webhooks/telegram"
   ```

### Environment Variables

See `.env.example` for full list. Key ones:
- `DATABASE_URL` - PostgreSQL connection
- `GOOGLE_CLIENT_ID/SECRET` - OAuth credentials
- `TWILIO_*` - SMS credentials
- `TELEGRAM_BOT_TOKEN` - Telegram bot
- `ANTHROPIC_API_KEY` - Claude API
- `FAST_EMAIL_DELAY=true` - 5s delay instead of 5-15min for testing

## Agent Tools

1. **check_availability** - Find open calendar slots
2. **send_email** - Queue email with delay (or immediate)
3. **send_sms_to_user** - Send notification via SMS/Telegram
4. **create_calendar_event** - Create event with attendees + Zoom
5. **cancel_calendar_event** - Delete event
6. **update_scheduling_request** - Update status, times, etc.
7. **lookup_contact** - Google People API lookup
8. **get_thread_emails** - Get full email thread
9. **link_threads** - Associate threads with request

## Common Issues

### "Assistant not found" / "User has no assistant configured"
The `sendEmailNow` function needs the assistant's OAuth tokens. Each user must connect their own assistant account via Settings. Use `getAssistantForUser(userId)` to get the user's linked assistant.

### Duplicate emails
If immediate email send fails, the record stays in DB and worker sends it. Fixed by deleting record on failure.

### Timezone date parsing
`new Date('2026-01-06')` parses as UTC midnight, which is Jan 5th in PT. Fixed by parsing with explicit timezone.

### Telegram "chat not found"
User must message the bot first (send /start) before bot can message them. Also ensure numeric chat ID (not username).
