import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { emailThreads, schedulingRequests, notifications } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { sendNotification } from '@/lib/integrations/notification/service';
import { logger } from '@/lib/utils/logger';

// Format email preview for SMS/Telegram confirmation (same as in send-email.ts)
function formatEmailPreview(to: string[], cc: string[] | undefined, subject: string, body: string): string {
  const recipients = [...to];
  if (cc && cc.length > 0) {
    recipients.push(...cc.map((e) => `${e} (CC)`));
  }

  return `Email to send:
To: ${recipients.join(', ')}
Subject: ${subject}
---
${body}
---
Reply: Y to send, N to cancel, or describe changes`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Get the email thread
    const emailThread = await db.query.emailThreads.findFirst({
      where: eq(emailThreads.id, id),
    });

    if (!emailThread) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    // Verify the email belongs to a scheduling request owned by this user
    if (emailThread.schedulingRequestId) {
      const schedulingRequest = await db.query.schedulingRequests.findFirst({
        where: eq(schedulingRequests.id, emailThread.schedulingRequestId),
      });

      if (!schedulingRequest || schedulingRequest.userId !== user.id) {
        return NextResponse.json({ error: 'Email not found' }, { status: 404 });
      }
    } else {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    // Check if already sent
    if (emailThread.sentAt) {
      return NextResponse.json({ error: 'Email has already been sent' }, { status: 400 });
    }

    // Check if it's pending confirmation (scheduledSendAt is null)
    if (emailThread.scheduledSendAt !== null) {
      return NextResponse.json(
        { error: 'Email is scheduled for automatic sending, not pending confirmation' },
        { status: 400 }
      );
    }

    // Check if it's an outbound email
    if (emailThread.direction !== 'outbound') {
      return NextResponse.json({ error: 'Can only resend notifications for outbound emails' }, { status: 400 });
    }

    // Check if there's already a pending notification for this email
    const existingNotification = await db.query.notifications.findFirst({
      where: and(eq(notifications.pendingEmailId, id), eq(notifications.awaitingResponseType, 'email_approval')),
    });

    if (existingNotification) {
      return NextResponse.json(
        { error: 'A notification for this email is already pending. Check SMS/Telegram.' },
        { status: 400 }
      );
    }

    // Send a new notification
    const preview = formatEmailPreview(
      emailThread.toEmails as string[],
      emailThread.ccEmails as string[] | undefined,
      emailThread.subject || '',
      emailThread.bodyText || ''
    );

    await sendNotification({
      userId: user.id,
      body: preview,
      schedulingRequestId: emailThread.schedulingRequestId || undefined,
      awaitingResponseType: 'email_approval',
      pendingEmailId: id,
    });

    return NextResponse.json({ success: true, message: 'Notification sent. Check SMS/Telegram for approval.' });
  } catch (error) {
    logger.error('Resend notification error', error, { emailId: id });
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
