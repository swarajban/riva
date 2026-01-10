import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { runAgent } from '@/lib/agent';
import { db } from '@/lib/db';
import { notifications, schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getAllPendingConfirmations } from '@/lib/integrations/notification/service';
import { logger } from '@/lib/utils/logger';
import { PendingConfirmation } from '@/lib/agent/types';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user.assistantId) {
      return NextResponse.json({ error: 'No assistant connected' }, { status: 400 });
    }

    const { schedulingRequestId, message } = await request.json();

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // If a specific scheduling request is provided, verify it belongs to this user
    if (schedulingRequestId) {
      const request = await db.query.schedulingRequests.findFirst({
        where: eq(schedulingRequests.id, schedulingRequestId),
      });

      if (!request || request.userId !== user.id) {
        return NextResponse.json({ error: 'Scheduling request not found' }, { status: 404 });
      }
    }

    // Get all pending confirmations for this user
    const allPending = await getAllPendingConfirmations(user.id);

    // Use most recent as default (backward compatible for single pending case)
    const defaultPending = allPending.length > 0 ? allPending[allPending.length - 1] : null;

    // Determine which scheduling request to associate with (prefer explicit, then default pending)
    const targetSchedulingRequestId = schedulingRequestId || defaultPending?.schedulingRequestId;

    // Store the inbound message from dashboard
    const [inboundRecord] = await db
      .insert(notifications)
      .values({
        userId: user.id,
        schedulingRequestId: targetSchedulingRequestId,
        provider: 'dashboard',
        direction: 'inbound',
        body: message.trim(),
        receivedAt: new Date(),
      })
      .returning({ id: notifications.id });

    logger.info('Stored inbound dashboard message', {
      notificationId: inboundRecord.id,
      userId: user.id,
      schedulingRequestId: targetSchedulingRequestId,
      body: message.trim(),
    });

    // Build pending confirmations list for agent context
    const pendingConfirmations: PendingConfirmation[] = allPending.map((p) => ({
      referenceNumber: p.referenceNumber || 0,
      notificationId: p.id,
      schedulingRequestId: p.schedulingRequestId,
      awaitingResponseType: p.awaitingResponseType,
      pendingEmailId: p.pendingEmailId,
      body: p.body || '',
      attendees: p.schedulingRequest?.attendees || undefined,
      meetingTitle: p.schedulingRequest?.meetingTitle || undefined,
    }));

    logger.info('Running agent for dashboard message', {
      userId: user.id,
      schedulingRequestId: targetSchedulingRequestId,
      pendingConfirmationsCount: pendingConfirmations.length,
      awaitingResponseType: defaultPending?.awaitingResponseType,
    });

    // Run the agent asynchronously - don't block the response
    // The agent can take 10-30+ seconds with Claude API calls and tool executions
    const agentPromise = runAgent({
      userId: user.id,
      assistantId: user.assistantId,
      schedulingRequestId: targetSchedulingRequestId || undefined,
      triggerType: 'sms',
      triggerContent: message.trim(),
      awaitingResponseType: defaultPending?.awaitingResponseType || undefined,
      pendingEmailId: defaultPending?.pendingEmailId || undefined,
      allPendingConfirmations: pendingConfirmations.length > 0 ? pendingConfirmations : undefined,
    });

    // Handle errors in background (don't await)
    agentPromise.catch(async (agentError) => {
      logger.error('Agent error from dashboard', agentError, {
        schedulingRequestId: targetSchedulingRequestId,
      });

      // Update request with error if we have one
      if (targetSchedulingRequestId) {
        await db
          .update(schedulingRequests)
          .set({
            status: 'error',
            errorMessage: agentError instanceof Error ? agentError.message : 'Agent processing failed',
            updatedAt: new Date(),
          })
          .where(eq(schedulingRequests.id, targetSchedulingRequestId));
      }
    });

    // Return immediately - message is stored, agent runs in background
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Dashboard message API error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
