import { NextRequest, NextResponse } from 'next/server';
import { parseTelegramUpdate, sendTelegramMessage } from '@/lib/integrations/telegram/client';
import {
  findUserByNotificationId,
  getAllPendingConfirmations,
  storeInboundNotification,
} from '@/lib/integrations/notification/service';
import { runAgent } from '@/lib/agent';
import { db } from '@/lib/db';
import { schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/utils/logger';
import { PendingConfirmation } from '@/lib/agent/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    logger.debug('Telegram update received', { body });

    // Parse the Telegram update
    const update = parseTelegramUpdate(body);

    if (!update) {
      // Not a text message, ignore
      return NextResponse.json({ status: 'ignored' });
    }

    const { chatId, text, messageId } = update;

    logger.info('Telegram message received', { chatId, messageId, body: text });

    // Handle /start command - send welcome message
    if (text.startsWith('/start')) {
      logger.info('User started Telegram bot', { chatId });
      await sendTelegramMessage(chatId, `You're ready to receive meeting confirmation notifications from Riva.`);
      return NextResponse.json({ status: 'ok', chatId });
    }

    // Find user by Telegram chat ID
    const user = await findUserByNotificationId(chatId, 'telegram');

    if (!user) {
      logger.info('User not found for Telegram chat ID', { chatId });
      // Optionally send a message back - for now just acknowledge
      return NextResponse.json({ status: 'user_not_found' });
    }

    if (!user.assistantId) {
      logger.info('User has no assistant configured', { email: user.email });
      await sendTelegramMessage(chatId, 'Your account is not fully set up. Please configure your assistant first.');
      return NextResponse.json({ status: 'no_assistant' });
    }

    // Get all pending confirmations for this user
    const allPending = await getAllPendingConfirmations(user.id);

    // Use most recent as default (backward compatible for single pending case)
    const defaultPending = allPending.length > 0 ? allPending[allPending.length - 1] : null;

    // Store the inbound notification (associate with default pending request)
    const inboundNotificationId = await storeInboundNotification(
      user.id,
      text,
      'telegram',
      String(messageId),
      defaultPending?.schedulingRequestId || undefined
    );

    logger.info('Stored inbound Telegram notification', {
      notificationId: inboundNotificationId,
      userId: user.id,
      schedulingRequestId: defaultPending?.schedulingRequestId ?? undefined,
      body: text,
    });

    // Build pending confirmations list for agent context (using stored reference numbers)
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

    // NOTE: Do NOT clear awaiting response here - let agent do it after disambiguation
    // This is important when there are multiple pending confirmations

    logger.info('Running agent for Telegram', {
      userId: user.id,
      schedulingRequestId: defaultPending?.schedulingRequestId ?? undefined,
      pendingConfirmationsCount: pendingConfirmations.length,
      awaitingResponseType: defaultPending?.awaitingResponseType ?? undefined,
    });

    // Run the agent to process this message
    try {
      await runAgent({
        userId: user.id,
        assistantId: user.assistantId,
        schedulingRequestId: defaultPending?.schedulingRequestId || undefined,
        triggerType: 'sms', // Keep as 'sms' for prompt compatibility
        triggerContent: text,
        awaitingResponseType: defaultPending?.awaitingResponseType || undefined,
        pendingEmailId: defaultPending?.pendingEmailId || undefined,
        allPendingConfirmations: pendingConfirmations.length > 0 ? pendingConfirmations : undefined,
      });
    } catch (agentError) {
      logger.error('Agent error', agentError, { schedulingRequestId: defaultPending?.schedulingRequestId || undefined });
      // Update request with error if we have one
      if (defaultPending?.schedulingRequestId) {
        await db
          .update(schedulingRequests)
          .set({
            status: 'error',
            errorMessage: agentError instanceof Error ? agentError.message : 'Agent processing failed',
            updatedAt: new Date(),
          })
          .where(eq(schedulingRequests.id, defaultPending.schedulingRequestId));
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    logger.error('Telegram webhook error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Telegram sends GET requests to verify webhook
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
