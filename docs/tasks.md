# Riva Implementation Tasks

## Phase 1: Foundation
- [x] Initialize Next.js 14 project with App Router
- [x] Install dependencies (drizzle-orm, pg, pg-boss, googleapis, twilio, @anthropic-ai/sdk)
- [x] Set up Drizzle ORM configuration
- [x] Create database schema (users, scheduling_requests, email_threads, sms_messages)
- [x] Create .env.example with all environment variables
- [ ] Run initial migration

## Phase 2: Authentication
- [x] Implement Google OAuth client
- [x] Create /auth/callback route handler
- [x] Add token refresh logic
- [x] Create session middleware
- [x] Create login page

## Phase 3: Core Integrations
- [x] Gmail API client (read emails, send emails, setup watch)
- [x] Email parsing utilities (extract sender, recipients, body)
- [x] Google Calendar API client
- [x] Availability/slot finding algorithm
- [x] Calendar event CRUD operations
- [x] Twilio SMS client (send/receive)

## Phase 4: Webhooks
- [x] Gmail push notification handler (/api/webhooks/gmail)
- [x] Twilio inbound SMS handler (/api/webhooks/twilio)
- [ ] Webhook verification/security

## Phase 5: Agent System
- [x] Claude agent executor (tool calling loop)
- [x] System prompts with personality/rules
- [x] Tool: check_availability
- [x] Tool: send_email
- [x] Tool: send_sms_to_user
- [x] Tool: create_calendar_event
- [x] Tool: cancel_calendar_event
- [x] Tool: update_scheduling_request
- [x] Tool: lookup_contact
- [x] Tool: get_thread_emails
- [x] Tool: link_threads
- [x] Time formatting utilities (PT timezone)

## Phase 6: Background Jobs
- [x] pg-boss queue initialization
- [x] Job handler: delayed email sender
- [x] Job handler: SMS reminders (3 hours)
- [x] Job handler: request expiration (2 days)
- [x] Job handler: Gmail watch renewal (6 days)
- [x] Job scheduling utilities

## Phase 7: Dashboard
- [x] Dashboard layout with navigation
- [x] Auth-protected routes
- [x] Request list view with status filtering
- [x] Request detail view (email thread display)
- [x] Request detail view (SMS history display)
- [x] Settings page: working hours
- [x] Settings page: working days
- [x] Settings page: meeting preferences
- [x] Settings page: Zoom link
- [x] Settings page: keyword rules

## Phase 8: Polish
- [ ] Error handling for all edge cases
- [ ] Structured logging
- [ ] Local development documentation (ngrok setup)
- [ ] Manual thread linking UI

---

## Legend
- [ ] Todo
- [~] In Progress
- [x] Done
