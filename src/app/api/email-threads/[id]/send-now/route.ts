import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { emailThreads, schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sendEmailNow } from '@/lib/integrations/gmail/send';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;

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
      // Email not associated with a scheduling request - deny access
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    // Check if already sent
    if (emailThread.sentAt) {
      return NextResponse.json({ error: 'Email has already been sent' }, { status: 400 });
    }

    // Check if it's an outbound email
    if (emailThread.direction !== 'outbound') {
      return NextResponse.json({ error: 'Can only send outbound emails' }, { status: 400 });
    }

    // Send the email immediately
    await sendEmailNow(user.id, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Send now error:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
