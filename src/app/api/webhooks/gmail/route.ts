import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, emailThreads, schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getHistory,
  getMessage,
  parseGmailMessage,
  isRivaAddressed,
  parseHeaders,
} from '@/lib/integrations/gmail/client';
import { runAgent } from '@/lib/agent';

// Gmail Pub/Sub push notification format
interface PubSubMessage {
  message: {
    data: string; // base64 encoded
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: PubSubMessage = await request.json();

    // Decode the Pub/Sub message
    const data = Buffer.from(body.message.data, 'base64').toString('utf-8');
    const notification: GmailNotification = JSON.parse(data);

    console.log('Gmail notification received:', notification);

    // Find user by email
    const user = await db.query.users.findFirst({
      where: eq(users.email, notification.emailAddress),
    });

    if (!user) {
      console.log('User not found for email:', notification.emailAddress);
      return NextResponse.json({ status: 'user_not_found' });
    }

    // Get message history since last known historyId
    // For now, we'll use the historyId from the notification
    // In production, you'd want to store and compare historyIds
    const history = await getHistory(user.id, notification.historyId);

    // Process each new message
    for (const historyItem of history) {
      const messagesAdded = historyItem.messagesAdded || [];

      for (const messageAdded of messagesAdded) {
        const messageId = messageAdded.message?.id;
        if (!messageId) continue;

        // Check if we've already processed this message
        const existing = await db.query.emailThreads.findFirst({
          where: eq(emailThreads.gmailMessageId, messageId),
        });

        if (existing) {
          console.log('Message already processed:', messageId);
          continue;
        }

        // Get full message
        const fullMessage = await getMessage(user.id, messageId);
        const headers = parseHeaders(fullMessage.payload?.headers);

        // Check if Riva is addressed
        if (!isRivaAddressed(headers)) {
          console.log('Riva not addressed in message:', messageId);
          continue;
        }

        // Parse the message
        const parsed = parseGmailMessage(fullMessage);

        // Check if this is from the user themselves (ignore)
        if (parsed.fromEmail.toLowerCase() === user.email.toLowerCase()) {
          console.log('Message from user, ignoring:', messageId);
          continue;
        }

        // Find existing scheduling request for this thread
        const existingThread = await db.query.emailThreads.findFirst({
          where: eq(emailThreads.gmailThreadId, parsed.gmailThreadId),
        });

        let schedulingRequestId = existingThread?.schedulingRequestId;

        // If no existing request, create one
        if (!schedulingRequestId) {
          const [newRequest] = await db
            .insert(schedulingRequests)
            .values({
              userId: user.id,
              status: 'pending',
              attendees: [
                {
                  email: parsed.fromEmail,
                  name: parsed.fromName || undefined,
                },
              ],
            })
            .returning({ id: schedulingRequests.id });

          schedulingRequestId = newRequest.id;
        }

        // Store the email
        await db.insert(emailThreads).values({
          schedulingRequestId,
          gmailMessageId: parsed.gmailMessageId,
          gmailThreadId: parsed.gmailThreadId,
          messageIdHeader: parsed.messageIdHeader,
          inReplyTo: parsed.inReplyTo,
          referencesHeader: parsed.referencesHeader,
          subject: parsed.subject,
          fromEmail: parsed.fromEmail,
          fromName: parsed.fromName,
          toEmails: parsed.toEmails,
          ccEmails: parsed.ccEmails,
          bodyText: parsed.bodyText,
          bodyHtml: parsed.bodyHtml,
          direction: 'inbound',
          receivedAt: parsed.receivedAt,
        });

        // Run the agent to process this email
        try {
          await runAgent({
            userId: user.id,
            schedulingRequestId,
            triggerType: 'email',
            triggerContent: JSON.stringify({
              subject: parsed.subject,
              from: parsed.fromEmail,
              fromName: parsed.fromName,
              body: parsed.bodyText,
              threadId: parsed.gmailThreadId,
            }),
          });
        } catch (agentError) {
          console.error('Agent error:', agentError);
          // Update request with error
          await db
            .update(schedulingRequests)
            .set({
              status: 'error',
              errorMessage: agentError instanceof Error ? agentError.message : 'Agent processing failed',
              updatedAt: new Date(),
            })
            .where(eq(schedulingRequests.id, schedulingRequestId));
        }
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Gmail webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Acknowledge GET requests (used by Pub/Sub to verify endpoint)
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
