import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assistants, users, emailThreads, schedulingRequests } from '@/lib/db/schema';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';
import {
  getHistory,
  getMessage,
  parseGmailMessage,
  isAssistantAddressed,
  parseHeaders,
} from '@/lib/integrations/gmail/client';
import { runAgent } from '@/lib/agent';
import { logger } from '@/lib/utils/logger';

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

    logger.info('Gmail notification received', { email: notification.emailAddress, historyId: notification.historyId });

    // Find assistant by email
    const assistant = await db.query.assistants.findFirst({
      where: eq(assistants.email, notification.emailAddress),
    });

    if (!assistant) {
      logger.info('Assistant not found for email', { email: notification.emailAddress });
      return NextResponse.json({ status: 'assistant_not_found' });
    }

    // Find the user who owns this assistant
    const user = await db.query.users.findFirst({
      where: eq(users.assistantId, assistant.id),
    });

    if (!user) {
      logger.info('No user found for assistant', { assistantEmail: assistant.email });
      return NextResponse.json({ status: 'user_not_found' });
    }

    // Get the stored history ID or use a default
    const lastHistoryId = assistant.gmailHistoryId || notification.historyId;

    // Get message history since last known historyId
    const history = await getHistory(lastHistoryId, assistant.id);

    // Update the assistant's history ID
    await db
      .update(assistants)
      .set({
        gmailHistoryId: notification.historyId,
        updatedAt: new Date(),
      })
      .where(eq(assistants.id, assistant.id));

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
          logger.debug('Message already processed', { messageId });
          continue;
        }

        // Get full message using assistant's credentials
        const fullMessage = await getMessage(messageId, assistant.id);
        const headers = parseHeaders(fullMessage.payload?.headers);

        // Check if assistant is addressed
        if (!isAssistantAddressed(headers, assistant.email)) {
          logger.debug('Assistant not addressed in message', { messageId });
          continue;
        }

        // Parse the message
        const parsed = parseGmailMessage(fullMessage);

        // Check if this is from the assistant (ignore our own sent messages)
        if (parsed.fromEmail.toLowerCase() === assistant.email.toLowerCase()) {
          logger.debug('Message from assistant, ignoring', { messageId });
          continue;
        }

        // Find existing scheduling request for this thread
        const existingThread = await db.query.emailThreads.findFirst({
          where: eq(emailThreads.gmailThreadId, parsed.gmailThreadId),
        });

        let schedulingRequestId = existingThread?.schedulingRequestId;

        // If no existing request, create one
        if (!schedulingRequestId) {
          // Identify external parties (not user, not assistant)
          const assistantEmail = assistant.email.toLowerCase();
          const userEmail = user.email.toLowerCase();

          const externalParties = [
            ...parsed.toEmails.map((email) => ({ email, name: undefined as string | undefined })),
            ...parsed.ccEmails.map((email) => ({ email, name: undefined as string | undefined })),
          ].filter((p) => {
            const email = p.email.toLowerCase();
            return email !== assistantEmail && email !== userEmail;
          });

          // If sender is external (not the user), add them too
          if (parsed.fromEmail.toLowerCase() !== userEmail) {
            externalParties.unshift({
              email: parsed.fromEmail,
              name: parsed.fromName || undefined,
            });
          }

          const [newRequest] = await db
            .insert(schedulingRequests)
            .values({
              userId: user.id,
              status: 'pending',
              attendees: externalParties.length > 0 ? externalParties : [],
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

        // Cancel any pending outbound emails for this request
        // They're now stale since new context has arrived - the agent will
        // run fresh and queue new responses with the updated context
        const cancelledEmails = await db
          .update(emailThreads)
          .set({
            scheduledSendAt: null,
            processingError: 'Cancelled: new inbound email arrived before send',
          })
          .where(
            and(
              eq(emailThreads.schedulingRequestId, schedulingRequestId),
              eq(emailThreads.direction, 'outbound'),
              isNotNull(emailThreads.scheduledSendAt),
              isNull(emailThreads.sentAt)
            )
          )
          .returning({ id: emailThreads.id });

        if (cancelledEmails.length > 0) {
          logger.info('Cancelled pending outbound emails due to new inbound', {
            count: cancelledEmails.length,
            schedulingRequestId,
          });
        }

        // Get the scheduling request to pass attendees to agent
        const schedulingRequest = await db.query.schedulingRequests.findFirst({
          where: eq(schedulingRequests.id, schedulingRequestId),
        });

        // Run the agent to process this email
        try {
          await runAgent({
            userId: user.id,
            assistantId: assistant.id,
            schedulingRequestId,
            triggerType: 'email',
            triggerContent: JSON.stringify({
              subject: parsed.subject,
              from: parsed.fromEmail,
              fromName: parsed.fromName,
              to: parsed.toEmails,
              cc: parsed.ccEmails,
              body: parsed.bodyText,
              threadId: parsed.gmailThreadId,
              attendees: schedulingRequest?.attendees || [],
            }),
          });
        } catch (agentError) {
          logger.error('Agent error', agentError, { schedulingRequestId });
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
    logger.error('Gmail webhook error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Acknowledge GET requests (used by Pub/Sub to verify endpoint)
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
