import { db } from '@/lib/db';
import { schedulingRequests, smsMessages } from '@/lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

interface ExpireRequestJobData {
  schedulingRequestId: string;
}

export async function handleExpireRequest(data: ExpireRequestJobData): Promise<void> {
  const { schedulingRequestId } = data;

  // Get the scheduling request
  const request = await db.query.schedulingRequests.findFirst({
    where: eq(schedulingRequests.id, schedulingRequestId),
  });

  if (!request) {
    console.log(`Request ${schedulingRequestId} not found, skipping expiration`);
    return;
  }

  // Only expire if still in a pending state
  const pendingStates = ['pending', 'proposing', 'awaiting_confirmation'];
  if (!pendingStates.includes(request.status)) {
    console.log(`Request ${schedulingRequestId} is ${request.status}, skipping expiration`);
    return;
  }

  // Mark as expired
  await db
    .update(schedulingRequests)
    .set({
      status: 'expired',
      updatedAt: new Date(),
    })
    .where(eq(schedulingRequests.id, schedulingRequestId));

  // Clear any awaiting response types on SMS
  await db
    .update(smsMessages)
    .set({
      awaitingResponseType: null,
    })
    .where(
      and(
        eq(smsMessages.schedulingRequestId, schedulingRequestId),
        isNotNull(smsMessages.awaitingResponseType)
      )
    );

  console.log(`Request ${schedulingRequestId} expired`);
}
