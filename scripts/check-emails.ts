import 'dotenv/config';
import { db } from '../src/lib/db';
import { emailThreads } from '../src/lib/db/schema';
import { desc } from 'drizzle-orm';

async function main() {
  const emails = await db.query.emailThreads.findMany({
    orderBy: [desc(emailThreads.createdAt)],
    limit: 10,
    columns: {
      id: true,
      subject: true,
      bodyText: true,
      direction: true,
      sentAt: true,
      scheduledSendAt: true,
      createdAt: true,
      gmailThreadId: true,
    }
  });

  for (const email of emails) {
    console.log('---');
    console.log('ID:', email.id);
    console.log('Subject:', email.subject);
    console.log('Direction:', email.direction);
    console.log('Sent:', email.sentAt);
    console.log('Scheduled:', email.scheduledSendAt);
    console.log('Gmail Thread:', email.gmailThreadId);
    console.log('Body preview:', email.bodyText?.substring(0, 200));
    console.log('');
  }
}

main().then(() => process.exit(0));
