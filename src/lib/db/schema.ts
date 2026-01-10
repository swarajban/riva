import { pgTable, uuid, varchar, text, timestamp, jsonb, boolean, integer, pgEnum, index } from 'drizzle-orm/pg-core';
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

export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);

export const awaitingResponseTypeEnum = pgEnum('awaiting_response_type', [
  'booking_approval',
  'availability_guidance',
  'stale_slot_decision',
  'reschedule_approval',
  'cancel_approval',
  'meeting_title',
  'email_approval',
]);

export const notificationPreferenceEnum = pgEnum('notification_preference', ['sms', 'telegram']);

export const notificationProviderEnum = pgEnum('notification_provider', ['twilio', 'telegram']);

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
  confirmOutboundEmails?: boolean;
};

export type KeywordRule = {
  phrase: string;
  instruction: string;
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

// Assistants table - stores OAuth credentials for each user's assistant
// Each user has their own assistant (1:1 relationship)
export const assistants = pgTable('assistants', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }),
  googleRefreshToken: text('google_refresh_token'),
  googleAccessToken: text('google_access_token'),
  googleTokenExpiresAt: timestamp('google_token_expires_at', { withTimezone: true }),
  gmailHistoryId: varchar('gmail_history_id', { length: 255 }),
  gmailWatchExpiresAt: timestamp('gmail_watch_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Users table - actual users whose calendars are managed
// Each user has their own assistant (1:1 relationship)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  telegramChatId: varchar('telegram_chat_id', { length: 255 }),
  isAdmin: boolean('is_admin').default(false),
  notificationPreference: notificationPreferenceEnum('notification_preference').default('telegram'),
  calendarId: varchar('calendar_id', { length: 255 }).notNull(), // Google Calendar ID (usually same as email)
  assistantId: uuid('assistant_id')
    .unique()
    .references(() => assistants.id, { onDelete: 'set null' }),
  settings: jsonb('settings')
    .$type<UserSettings>()
    .default({
      defaultMeetingLengthMinutes: 30,
      zoomPersonalLink: null,
      workingHoursStart: '10:00',
      workingHoursEnd: '17:00',
      workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      timezone: 'America/Los_Angeles',
      bufferMinutes: 15,
      lookaheadDays: 10,
      numOptionsToSuggest: 4,
      maxSlotsPerDay: 4,
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
    smsReminderAt: timestamp('sms_reminder_at', { withTimezone: true }),
    smsReminderSentAt: timestamp('sms_reminder_sent_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => ({
    userStatusIdx: index('idx_scheduling_requests_user_status').on(table.userId, table.status),
    expiresIdx: index('idx_scheduling_requests_expires').on(table.expiresAt),
  })
);

export const emailThreads = pgTable(
  'email_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schedulingRequestId: uuid('scheduling_request_id').references(() => schedulingRequests.id, { onDelete: 'cascade' }),
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

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schedulingRequestId: uuid('scheduling_request_id').references(() => schedulingRequests.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: notificationProviderEnum('provider').notNull(),
    direction: messageDirectionEnum('direction').notNull(),
    body: text('body').notNull(),
    awaitingResponseType: awaitingResponseTypeEnum('awaiting_response_type'),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    pendingEmailId: uuid('pending_email_id').references(() => emailThreads.id, { onDelete: 'set null' }),
    referenceNumber: integer('reference_number'), // Stable ref # for multi-confirmation disambiguation
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    awaitingIdx: index('idx_notifications_awaiting').on(table.userId, table.awaitingResponseType),
    providerIdx: index('idx_notifications_provider').on(table.provider),
  })
);

// Relations
export const assistantsRelations = relations(assistants, ({ one }) => ({
  user: one(users, {
    fields: [assistants.id],
    references: [users.assistantId],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  assistant: one(assistants, {
    fields: [users.assistantId],
    references: [assistants.id],
  }),
  schedulingRequests: many(schedulingRequests),
  notifications: many(notifications),
}));

export const schedulingRequestsRelations = relations(schedulingRequests, ({ one, many }) => ({
  user: one(users, {
    fields: [schedulingRequests.userId],
    references: [users.id],
  }),
  emailThreads: many(emailThreads),
  notifications: many(notifications),
}));

export const emailThreadsRelations = relations(emailThreads, ({ one }) => ({
  schedulingRequest: one(schedulingRequests, {
    fields: [emailThreads.schedulingRequestId],
    references: [schedulingRequests.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  schedulingRequest: one(schedulingRequests, {
    fields: [notifications.schedulingRequestId],
    references: [schedulingRequests.id],
  }),
  user: one(users, {
    fields: [notifications.userId],
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
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// Keep old type aliases for backward compatibility during migration
export type SmsMessage = Notification;
export type NewSmsMessage = NewNotification;
export const smsMessages = notifications;
