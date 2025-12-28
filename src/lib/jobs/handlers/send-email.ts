import { db } from '@/lib/db';
import { emailThreads, schedulingRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sendEmailNow } from '@/lib/integrations/gmail/send';

interface SendEmailJobData {
  emailThreadId: string;
}

export async function handleSendEmail(data: SendEmailJobData): Promise<void> {
  const { emailThreadId } = data;

  // Get the email record
  const emailRecord = await db.query.emailThreads.findFirst({
    where: eq(emailThreads.id, emailThreadId),
  });

  if (!emailRecord) {
    console.error(`Email thread not found: ${emailThreadId}`);
    return;
  }

  if (emailRecord.sentAt) {
    console.log(`Email ${emailThreadId} already sent, skipping`);
    return;
  }

  // Get the scheduling request to find the user
  if (!emailRecord.schedulingRequestId) {
    console.error(`Email ${emailThreadId} has no scheduling request`);
    return;
  }

  const request = await db.query.schedulingRequests.findFirst({
    where: eq(schedulingRequests.id, emailRecord.schedulingRequestId),
  });

  if (!request) {
    console.error(`Scheduling request not found for email ${emailThreadId}`);
    return;
  }

  // Send the email
  await sendEmailNow(request.userId, emailThreadId);

  console.log(`Email ${emailThreadId} sent successfully`);
}
