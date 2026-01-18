import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { scheduledCalendarEvents, schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createCalendarEventNow } from '@/lib/integrations/calendar/queue';
import { sendEmailNow } from '@/lib/integrations/gmail/send';
import { logger } from '@/lib/utils/logger';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Get the scheduled calendar event
    const calendarEvent = await db.query.scheduledCalendarEvents.findFirst({
      where: eq(scheduledCalendarEvents.id, id),
    });

    if (!calendarEvent) {
      return NextResponse.json({ error: 'Calendar event not found' }, { status: 404 });
    }

    // Verify the event belongs to a scheduling request owned by this user
    const schedulingRequest = await db.query.schedulingRequests.findFirst({
      where: eq(schedulingRequests.id, calendarEvent.schedulingRequestId),
    });

    if (!schedulingRequest || schedulingRequest.userId !== user.id) {
      return NextResponse.json({ error: 'Calendar event not found' }, { status: 404 });
    }

    // Check if already sent
    if (calendarEvent.sentAt) {
      return NextResponse.json({ error: 'Calendar event has already been sent' }, { status: 400 });
    }

    // Send linked email first if it exists
    if (calendarEvent.linkedEmailId) {
      try {
        await sendEmailNow(user.id, calendarEvent.linkedEmailId);
        logger.info('Linked email sent with calendar event', {
          eventId: id,
          emailId: calendarEvent.linkedEmailId,
        });
      } catch (error) {
        logger.error('Failed to send linked email', error, {
          eventId: id,
          emailId: calendarEvent.linkedEmailId,
        });
        // Continue - still try to create the calendar event
      }
    }

    // Create the calendar event immediately
    await createCalendarEventNow(user.id, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Send now error', error, { calendarEventId: id });
    return NextResponse.json({ error: 'Failed to send calendar invite' }, { status: 500 });
  }
}
