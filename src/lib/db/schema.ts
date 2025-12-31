import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const schedulingRequestStatusEnum = pgEnum('scheduling_request_status', [
  'pending',
  'proposing',
  'awaiting_confirmation',
  'confirmed',
  'expired',
  'cancelled',
  'error',
]);

export const messageDirectionEnum = pgEnum('message_direction', [
  'inbound',
  'outbound',
]);

export const awaitingResponseTypeEnum = pgEnum('awaiting_response_type', [
  'booking_approval',
  'availability_guidance',
  'stale_slot_decision',
  'reschedule_approval',
  'cancel_approval',
  'meeting_title',
]);

// Types for JSONB fields
export type UserSettings = {
  defaultMeetingLengthMinutes: number;
  zoomPersonalLink: string | null;
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: string[];
  timezone: string;
  bufferMinutes: number;
  lookaheadDays: number;
  numOptionsToSuggest: number;
  maxSlotsPerDay: number;
  keywordRules: KeywordRule[];
};

export type KeywordRule = {
  phrase: string;
  meetingLengthMinutes?: number;
  allowedDays?: string[];
  hourRangeStart?: string;
  hourRangeEnd?: string;
};

export type Attendee = {
  email: string;
  name?: string;
};

export type ProposedTime = {
  start: string;
  end: string;
  round: number;
};

// Assistants table - stores Riva's OAuth credentials
// Single row for the assistant (riva@semprehealth.com)
export const assistants = pgTable('assistants', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }),
  googleRefreshToken: text('google_refresh_token'),
  googleAccessToken: text('google_access_token'),
  googleTokenExpiresAt: timestamp('google_token_expires_at', { withTimezone: true }),
  gmailHistoryId: varchar('gmail_history_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Users table - actual users whose calendars Riva manages
// (e.g., Swaraj, Anurati)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  calendarId: varchar('calendar_id', { length: 255 }).notNull(), // Google Calendar ID (usually same as email)
  settings: jsonb('settings').$type<UserSettings>().default({
    defaultMeetingLengthMinutes: 30,
    zoomPersonalLink: null,
    workingHoursStart: '10:00',
    workingHoursEnd: '17:00',
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    timezone: 'America/Los_Angeles',
    bufferMinutes: 15,
    lookaheadDays: 10,
    numOptionsToSuggest: 4,
    maxSlotsPerDay: 2,
    keywordRules: [],
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const schedulingRequests = pgTable(
  'scheduling_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    status: schedulingRequestStatusEnum('status').default('pending').notNull(),
    attendees: jsonb('attendees').$type<Attendee[]>().default([]),
    meetingTitle: varchar('meeting_title', { length: 255 }),
    meetingLengthMinutes: integer('meeting_length_minutes'),
    includeVideoLink: boolean('include_video_link').default(true),
    matchedKeywordRule: jsonb('matched_keyword_rule').$type<KeywordRule | null>(),
    requestedTimeframe: text('requested_timeframe'),
    proposedTimes: jsonb('proposed_times').$type<ProposedTime[]>().default([]),
    confirmedStartTime: timestamp('confirmed_start_time', { withTimezone: true }),
    confirmedEndTime: timestamp('confirmed_end_time', { withTimezone: true }),
    googleCalendarEventId: varchar('google_calendar_event_id', { length: 255 }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    smsReminderSentAt: timestamp('sms_reminder_sent_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => ({
    userStatusIdx: index('idx_scheduling_requests_user_status').on(
      table.userId,
      table.status
    ),
    expiresIdx: index('idx_scheduling_requests_expires').on(table.expiresAt),
  })
);

export const emailThreads = pgTable(
  'email_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schedulingRequestId: uuid('scheduling_request_id').references(
      () => schedulingRequests.id,
      { onDelete: 'cascade' }
    ),
    gmailMessageId: varchar('gmail_message_id', { length: 255 }).unique(),
    gmailThreadId: varchar('gmail_thread_id', { length: 255 }),
    messageIdHeader: varchar('message_id_header', { length: 255 }),
    inReplyTo: varchar('in_reply_to', { length: 255 }),
    referencesHeader: text('references_header'),
    subject: varchar('subject', { length: 500 }),
    fromEmail: varchar('from_email', { length: 255 }),
    fromName: varchar('from_name', { length: 255 }),
    toEmails: jsonb('to_emails').$type<string[]>(),
    ccEmails: jsonb('cc_emails').$type<string[]>(),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    direction: messageDirectionEnum('direction').notNull(),
    processed: boolean('processed').default(false),
    processingError: text('processing_error'),
    scheduledSendAt: timestamp('scheduled_send_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    gmailThreadIdx: index('idx_email_threads_gmail_thread').on(table.gmailThreadId),
    gmailMessageIdx: index('idx_email_threads_gmail_message').on(table.gmailMessageId),
    requestIdx: index('idx_email_threads_request').on(table.schedulingRequestId),
    pendingSendIdx: index('idx_email_threads_pending_send').on(table.scheduledSendAt),
  })
);

export const smsMessages = pgTable(
  'sms_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schedulingRequestId: uuid('scheduling_request_id').references(
      () => schedulingRequests.id,
      { onDelete: 'set null' }
    ),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    direction: messageDirectionEnum('direction').notNull(),
    body: text('body').notNull(),
    awaitingResponseType: awaitingResponseTypeEnum('awaiting_response_type'),
    twilioMessageSid: varchar('twilio_message_sid', { length: 255 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    awaitingIdx: index('idx_sms_awaiting').on(
      table.userId,
      table.awaitingResponseType
    ),
  })
);

// Relations
export const assistantsRelations = relations(assistants, ({ }) => ({}));

export const usersRelations = relations(users, ({ many }) => ({
  schedulingRequests: many(schedulingRequests),
  smsMessages: many(smsMessages),
}));

export const schedulingRequestsRelations = relations(
  schedulingRequests,
  ({ one, many }) => ({
    user: one(users, {
      fields: [schedulingRequests.userId],
      references: [users.id],
    }),
    emailThreads: many(emailThreads),
    smsMessages: many(smsMessages),
  })
);

export const emailThreadsRelations = relations(emailThreads, ({ one }) => ({
  schedulingRequest: one(schedulingRequests, {
    fields: [emailThreads.schedulingRequestId],
    references: [schedulingRequests.id],
  }),
}));

export const smsMessagesRelations = relations(smsMessages, ({ one }) => ({
  schedulingRequest: one(schedulingRequests, {
    fields: [smsMessages.schedulingRequestId],
    references: [schedulingRequests.id],
  }),
  user: one(users, {
    fields: [smsMessages.userId],
    references: [users.id],
  }),
}));

// Type exports for use in application
export type Assistant = typeof assistants.$inferSelect;
export type NewAssistant = typeof assistants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type SchedulingRequest = typeof schedulingRequests.$inferSelect;
export type NewSchedulingRequest = typeof schedulingRequests.$inferInsert;
export type EmailThread = typeof emailThreads.$inferSelect;
export type NewEmailThread = typeof emailThreads.$inferInsert;
export type SmsMessage = typeof smsMessages.$inferSelect;
export type NewSmsMessage = typeof smsMessages.$inferInsert;
