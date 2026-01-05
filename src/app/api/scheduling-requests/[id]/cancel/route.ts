import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { schedulingRequests, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { cancelCalendarEvent } from '@/lib/integrations/calendar/client';
import { logger } from '@/lib/utils/logger';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Get the scheduling request - ensure it belongs to this user
    const schedulingRequest = await db.query.schedulingRequests.findFirst({
      where: and(eq(schedulingRequests.id, id), eq(schedulingRequests.userId, user.id)),
    });

    if (!schedulingRequest) {
      return NextResponse.json({ error: 'Scheduling request not found' }, { status: 404 });
    }

    // Check if already cancelled
    if (schedulingRequest.status === 'cancelled') {
      return NextResponse.json({ error: 'Request is already cancelled' }, { status: 400 });
    }

    // If there's a calendar event, cancel it
    if (schedulingRequest.googleCalendarEventId) {
      // Get user with assistant to cancel the calendar event
      const userWithAssistant = await db.query.users.findFirst({
        where: eq(users.id, user.id),
        with: { assistant: true },
      });

      if (userWithAssistant?.assistant?.id) {
        try {
          await cancelCalendarEvent(
            userWithAssistant.assistant.id,
            user.calendarId,
            schedulingRequest.googleCalendarEventId
          );
        } catch (calendarError) {
          logger.error('Failed to cancel calendar event', calendarError, { schedulingRequestId: id });
          // Continue with status update even if calendar deletion fails
        }
      }
    }

    // Update the scheduling request status to cancelled
    await db
      .update(schedulingRequests)
      .set({
        status: 'cancelled',
        googleCalendarEventId: null,
        updatedAt: new Date(),
      })
      .where(eq(schedulingRequests.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Cancel scheduling request error', error, { schedulingRequestId: id });
    return NextResponse.json({ error: 'Failed to cancel scheduling request' }, { status: 500 });
  }
}
