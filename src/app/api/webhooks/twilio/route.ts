import { NextRequest, NextResponse } from 'next/server';
import {
  findUserByNotificationId,
  getAllPendingConfirmations,
  storeInboundNotification,
  validateTwilioSignature,
} from '@/lib/integrations/notification/service';
import { runAgent } from '@/lib/agent';
import { db } from '@/lib/db';
import { schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { config } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { PendingConfirmation } from '@/lib/agent/types';

export async function POST(request: NextRequest) {
  try {
    // Clone request to read body twice (once for validation, once for parsing)
    const clonedRequest = request.clone();
    const formData = await request.formData();

    // Validate Twilio signature in production
    if (process.env.NODE_ENV === 'production') {
      const signature = request.headers.get('x-twilio-signature') || '';
      const url = `${config.appUrl}/api/webhooks/twilio`;

      // Convert FormData to object for validation
      const params: Record<string, string> = {};
      formData.forEach((value, key) => {
        params[key] = value.toString();
      });

      if (!validateTwilioSignature(signature, url, params)) {
        logger.error('Invalid Twilio signature');
        return new NextResponse('Forbidden', { status: 403 });
      }
    }
    const from = formData.get('From') as string;
    const body = formData.get('Body') as string;
    const messageSid = formData.get('MessageSid') as string;

    logger.info('Twilio SMS received', { from, messageSid });

    // Find user by phone number (with assistant)
    const user = await findUserByNotificationId(from, 'twilio');

    if (!user) {
      logger.info('User not found for phone', { from });
      // Return TwiML response
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, your phone number is not registered with Riva.</Message></Response>',
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (!user.assistantId) {
      logger.info('User has no assistant configured', { email: user.email });
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Your account is not fully set up. Please configure your assistant first.</Message></Response>',
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Get all pending confirmations for this user
    const allPending = await getAllPendingConfirmations(user.id);

    // Use most recent as default (backward compatible for single pending case)
    const defaultPending = allPending.length > 0 ? allPending[allPending.length - 1] : null;

    // Store the inbound notification (associate with default pending request)
    await storeInboundNotification(
      user.id,
      body,
      'twilio',
      messageSid,
      defaultPending?.schedulingRequestId || undefined
    );

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

    // Run the agent to process this SMS
    try {
      await runAgent({
        userId: user.id,
        assistantId: user.assistantId,
        schedulingRequestId: defaultPending?.schedulingRequestId || undefined,
        triggerType: 'sms',
        triggerContent: body,
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

    // Return empty TwiML response (agent will send any reply via our SMS function)
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    logger.error('Twilio webhook error', error);
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>An error occurred. Please try again.</Message></Response>',
      { headers: { 'Content-Type': 'text/xml' }, status: 500 }
    );
  }
}
