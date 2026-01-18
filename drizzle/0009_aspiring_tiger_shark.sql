ALTER TYPE "public"."awaiting_response_type" ADD VALUE 'calendar_event_approval';--> statement-breakpoint
CREATE TABLE "scheduled_calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduling_request_id" uuid NOT NULL,
	"event_data" jsonb NOT NULL,
	"scheduled_send_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"google_calendar_event_id" varchar(255),
	"linked_email_id" uuid,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "notification_preference" SET DEFAULT 'dashboard';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "pending_calendar_event_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_calendar_events" ADD CONSTRAINT "scheduled_calendar_events_scheduling_request_id_scheduling_requests_id_fk" FOREIGN KEY ("scheduling_request_id") REFERENCES "public"."scheduling_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_calendar_events" ADD CONSTRAINT "scheduled_calendar_events_linked_email_id_email_threads_id_fk" FOREIGN KEY ("linked_email_id") REFERENCES "public"."email_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scheduled_calendar_events_pending_send" ON "scheduled_calendar_events" USING btree ("scheduled_send_at");--> statement-breakpoint
CREATE INDEX "idx_scheduled_calendar_events_request" ON "scheduled_calendar_events" USING btree ("scheduling_request_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_pending_calendar_event_id_scheduled_calendar_events_id_fk" FOREIGN KEY ("pending_calendar_event_id") REFERENCES "public"."scheduled_calendar_events"("id") ON DELETE set null ON UPDATE no action;