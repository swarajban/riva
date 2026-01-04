CREATE TYPE "public"."awaiting_response_type" AS ENUM('booking_approval', 'availability_guidance', 'stale_slot_decision', 'reschedule_approval', 'cancel_approval', 'meeting_title');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."notification_preference" AS ENUM('sms', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."notification_provider" AS ENUM('twilio', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."scheduling_request_status" AS ENUM('pending', 'proposing', 'awaiting_confirmation', 'confirmed', 'expired', 'cancelled', 'error');--> statement-breakpoint
CREATE TABLE "assistants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"google_refresh_token" text,
	"google_access_token" text,
	"google_token_expires_at" timestamp with time zone,
	"gmail_history_id" varchar(255),
	"gmail_watch_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "assistants_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduling_request_id" uuid,
	"gmail_message_id" varchar(255),
	"gmail_thread_id" varchar(255),
	"message_id_header" varchar(255),
	"in_reply_to" varchar(255),
	"references_header" text,
	"subject" varchar(500),
	"from_email" varchar(255),
	"from_name" varchar(255),
	"to_emails" jsonb,
	"cc_emails" jsonb,
	"body_text" text,
	"body_html" text,
	"direction" "message_direction" NOT NULL,
	"processed" boolean DEFAULT false,
	"processing_error" text,
	"scheduled_send_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "email_threads_gmail_message_id_unique" UNIQUE("gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduling_request_id" uuid,
	"user_id" uuid NOT NULL,
	"provider" "notification_provider" NOT NULL,
	"direction" "message_direction" NOT NULL,
	"body" text NOT NULL,
	"awaiting_response_type" "awaiting_response_type",
	"provider_message_id" varchar(255),
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scheduling_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "scheduling_request_status" DEFAULT 'pending' NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb,
	"meeting_title" varchar(255),
	"meeting_length_minutes" integer,
	"include_video_link" boolean DEFAULT true,
	"matched_keyword_rule" jsonb,
	"requested_timeframe" text,
	"proposed_times" jsonb DEFAULT '[]'::jsonb,
	"confirmed_start_time" timestamp with time zone,
	"confirmed_end_time" timestamp with time zone,
	"google_calendar_event_id" varchar(255),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sms_reminder_at" timestamp with time zone,
	"sms_reminder_sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"phone" varchar(20),
	"telegram_chat_id" varchar(255),
	"notification_preference" "notification_preference" DEFAULT 'sms',
	"calendar_id" varchar(255) NOT NULL,
	"assistant_id" uuid,
	"settings" jsonb DEFAULT '{"defaultMeetingLengthMinutes":30,"zoomPersonalLink":null,"workingHoursStart":"10:00","workingHoursEnd":"17:00","workingDays":["mon","tue","wed","thu","fri"],"timezone":"America/Los_Angeles","bufferMinutes":15,"lookaheadDays":10,"numOptionsToSuggest":4,"maxSlotsPerDay":2,"keywordRules":[]}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_assistant_id_unique" UNIQUE("assistant_id")
);
--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_scheduling_request_id_scheduling_requests_id_fk" FOREIGN KEY ("scheduling_request_id") REFERENCES "public"."scheduling_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_scheduling_request_id_scheduling_requests_id_fk" FOREIGN KEY ("scheduling_request_id") REFERENCES "public"."scheduling_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_requests" ADD CONSTRAINT "scheduling_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_threads_gmail_thread" ON "email_threads" USING btree ("gmail_thread_id");--> statement-breakpoint
CREATE INDEX "idx_email_threads_gmail_message" ON "email_threads" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE INDEX "idx_email_threads_request" ON "email_threads" USING btree ("scheduling_request_id");--> statement-breakpoint
CREATE INDEX "idx_email_threads_pending_send" ON "email_threads" USING btree ("scheduled_send_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_awaiting" ON "notifications" USING btree ("user_id","awaiting_response_type");--> statement-breakpoint
CREATE INDEX "idx_notifications_provider" ON "notifications" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_scheduling_requests_user_status" ON "scheduling_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_scheduling_requests_expires" ON "scheduling_requests" USING btree ("expires_at");