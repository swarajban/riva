import { NextRequest, NextResponse } from 'next/server';
import {
  findUserByPhone,
  getMostRecentAwaitingSms,
  storeInboundSms,
  clearAwaitingResponse,
  validateTwilioSignature,
} from '@/lib/integrations/twilio/client';
import { runAgent } from '@/lib/agent';
import { db } from '@/lib/db';
import { schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { config } from '@/lib/config';

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
        console.error('Invalid Twilio signature');
        return new NextResponse('Forbidden', { status: 403 });
      }
    }
    const from = formData.get('From') as string;
    const body = formData.get('Body') as string;
    const messageSid = formData.get('MessageSid') as string;

    console.log('Twilio SMS received:', { from, messageSid });

    // Find user by phone number
    const user = await findUserByPhone(from);

    if (!user) {
      console.log('User not found for phone:', from);
      // Return TwiML response
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, your phone number is not registered with Riva.</Message></Response>',
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Find the most recent SMS awaiting response
    const awaitingSms = await getMostRecentAwaitingSms(user.id);

    // Store the inbound SMS
    await storeInboundSms(
      user.id,
      body,
      messageSid,
      awaitingSms?.schedulingRequestId || undefined
    );

    // Clear the awaiting response flag if there was one
    if (awaitingSms) {
      await clearAwaitingResponse(awaitingSms.id);
    }

    // Run the agent to process this SMS
    try {
      await runAgent({
        userId: user.id,
        schedulingRequestId: awaitingSms?.schedulingRequestId || undefined,
        triggerType: 'sms',
        triggerContent: body,
        awaitingResponseType: awaitingSms?.awaitingResponseType || undefined,
      });
    } catch (agentError) {
      console.error('Agent error:', agentError);
      // Update request with error if we have one
      if (awaitingSms?.schedulingRequestId) {
        await db
          .update(schedulingRequests)
          .set({
            status: 'error',
            errorMessage: agentError instanceof Error ? agentError.message : 'Agent processing failed',
            updatedAt: new Date(),
          })
          .where(eq(schedulingRequests.id, awaitingSms.schedulingRequestId));
      }
    }

    // Return empty TwiML response (agent will send any reply via our SMS function)
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    );
  } catch (error) {
    console.error('Twilio webhook error:', error);
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>An error occurred. Please try again.</Message></Response>',
      { headers: { 'Content-Type': 'text/xml' }, status: 500 }
    );
  }
}
