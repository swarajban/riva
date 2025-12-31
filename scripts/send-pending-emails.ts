/**
 * Manually send pending emails (bypasses pg-boss for debugging)
 *
 * Usage:
 *   npx tsx scripts/send-pending-emails.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const { db } = await import('../src/lib/db');
  const { emailThreads, users, schedulingRequests } = await import('../src/lib/db/schema');
  const { sendEmailNow } = await import('../src/lib/integrations/gmail/send');
  const { isNotNull, eq } = await import('drizzle-orm');

  console.log('Finding pending emails...');

  // Find emails that are scheduled but not sent
  const pendingEmails = await db.query.emailThreads.findMany({
    where: (fields, { and, isNotNull, isNull }) =>
      and(isNotNull(fields.scheduledSendAt), isNull(fields.sentAt)),
  });

  console.log(`Found ${pendingEmails.length} pending emails`);

  for (const email of pendingEmails) {
    console.log(`\nProcessing email ${email.id}`);
    console.log(`  To: ${email.toEmails}`);
    console.log(`  Subject: ${email.subject}`);
    console.log(`  Scheduled: ${email.scheduledSendAt}`);

    // Get the scheduling request to find the user
    if (!email.schedulingRequestId) {
      console.log('  No scheduling request, skipping');
      continue;
    }

    const request = await db.query.schedulingRequests.findFirst({
      where: eq(schedulingRequests.id, email.schedulingRequestId),
    });

    if (!request) {
      console.log('  Scheduling request not found, skipping');
      continue;
    }

    // Get assistant ID (we need this for sending)
    const { getAssistant } = await import('../src/lib/auth/google-oauth');
    const assistant = await getAssistant();

    console.log(`  Sending as assistant: ${assistant.email}`);

    try {
      await sendEmailNow(assistant.id, email.id);
      console.log('  Email sent successfully!');
    } catch (error) {
      console.error('  Failed to send:', error);
    }
  }

  console.log('\nDone');
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
