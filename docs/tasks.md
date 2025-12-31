# Riva Tasks

## Completed

### Foundation
- [x] Next.js 14 project with App Router
- [x] Drizzle ORM + PostgreSQL schema
- [x] Multi-user/assistant architecture

### Authentication
- [x] Google OAuth for assistant (Riva email)
- [x] Google OAuth for users (calendar access)
- [x] Token refresh logic
- [x] Session management

### Core Integrations
- [x] Gmail API (read, send, watch via Pub/Sub)
- [x] Google Calendar API (freebusy, events)
- [x] Twilio SMS (send/receive)
- [x] Telegram Bot API (send/receive)
- [x] Unified notification service (SMS + Telegram)

### Agent System
- [x] Claude Opus 4.5 with extended thinking
- [x] Tool calling loop with error handling
- [x] All 9 agent tools implemented
- [x] System prompts with personality/rules

### Background Jobs
- [x] Polling-based worker (replaced pg-boss)
- [x] Delayed email sender
- [x] Gmail watch renewal

### Dashboard
- [x] Request list view
- [x] Request detail view
- [x] Settings page (working hours, Zoom, notifications)
- [x] Telegram setup instructions

### Bug Fixes
- [x] Email threading (Message-ID, In-Reply-To, References)
- [x] Duplicate email prevention (atomic claim)
- [x] Timezone date parsing (year boundary, PT offset)
- [x] Assistant OAuth for email sending

---

## Next Up: Deployment & CI

### Deployment
- [ ] Set up Render web service
- [ ] Configure production PostgreSQL
- [ ] Production environment variables
- [ ] Domain setup (app.riva.systems)
- [ ] SSL/HTTPS configuration

### CI/CD
- [ ] GitHub Actions workflow
- [ ] Build + type check on PR
- [ ] Auto-deploy to Render on merge to main

### Production Webhooks
- [ ] Production Pub/Sub subscription for Gmail
- [ ] Production Twilio webhook URL
- [ ] Production Telegram webhook URL

---

## Backlog

### Features
- [ ] Twilio A2P registration (in progress, 2 week wait)
- [ ] Request expiration handling (auto-expire after 2 days)
- [ ] SMS reminders for pending confirmations (3 hour)
- [ ] Reschedule/cancel flows
- [ ] Manual thread linking UI
- [ ] Multi-calendar support

### Polish
- [ ] Error handling improvements
- [ ] Dashboard UI refinements
- [ ] Observability/logging
- [ ] Rate limiting

### Testing
- [ ] Unit tests for availability logic
- [ ] Integration tests for agent flows
- [ ] E2E tests for webhook handlers
