import { NextRequest, NextResponse } from 'next/server';
import { parseTelegramUpdate, sendTelegramMessage } from '@/lib/integrations/telegram/client';
import {
  findUserByNotificationId,
  getMostRecentAwaiting,
  storeInboundNotification,
  clearAwaitingResponse,
} from '@/lib/integrations/notification/service';
import { runAgent } from '@/lib/agent';
import { db } from '@/lib/db';
import { schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/utils/logger';

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

    logger.info('Telegram message received', { chatId, messageId });

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

    // Find the most recent notification awaiting response
    const awaitingNotification = await getMostRecentAwaiting(user.id);

    // Store the inbound notification
    await storeInboundNotification(
      user.id,
      text,
      'telegram',
      String(messageId),
      awaitingNotification?.schedulingRequestId || undefined
    );

    // Clear the awaiting response flag if there was one
    if (awaitingNotification) {
      await clearAwaitingResponse(awaitingNotification.id);
    }

    // Run the agent to process this message
    try {
      await runAgent({
        userId: user.id,
        assistantId: user.assistantId,
        schedulingRequestId: awaitingNotification?.schedulingRequestId || undefined,
        triggerType: 'sms', // Keep as 'sms' for prompt compatibility
        triggerContent: text,
        awaitingResponseType: awaitingNotification?.awaitingResponseType || undefined,
      });
    } catch (agentError) {
      logger.error('Agent error', agentError, { schedulingRequestId: awaitingNotification?.schedulingRequestId || undefined });
      // Update request with error if we have one
      if (awaitingNotification?.schedulingRequestId) {
        await db
          .update(schedulingRequests)
          .set({
            status: 'error',
            errorMessage: agentError instanceof Error ? agentError.message : 'Agent processing failed',
            updatedAt: new Date(),
          })
          .where(eq(schedulingRequests.id, awaitingNotification.schedulingRequestId));
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
