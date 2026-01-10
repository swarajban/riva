import { db } from '@/lib/db';
import { schedulingRequests, users, assistants } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';

const statusColors: Record<string, string> = {
  pending: 'badge-pending',
  proposing: 'badge-proposing',
  awaiting_confirmation: 'badge-awaiting',
  confirmed: 'badge-confirmed',
  expired: 'badge-expired',
  cancelled: 'badge-cancelled',
  error: 'badge-error',
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function formatDate(date: Date | null): string {
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(date);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  // Get assistant email if connected
  const assistant = user.assistantId
    ? await db.query.assistants.findFirst({
        where: eq(assistants.id, user.assistantId),
      })
    : null;

  const { status: statusFilter } = await searchParams;

  // Get requests for this user only
  const requests = await db.query.schedulingRequests.findMany({
    where: eq(schedulingRequests.userId, user.id),
    orderBy: desc(schedulingRequests.createdAt),
  });

  // Filter by status if specified
  const filteredRequests = statusFilter ? requests.filter((r) => r.status === statusFilter) : requests;

  // Count by status
  const counts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === 'pending').length,
    proposing: requests.filter((r) => r.status === 'proposing').length,
    awaiting_confirmation: requests.filter((r) => r.status === 'awaiting_confirmation').length,
    confirmed: requests.filter((r) => r.status === 'confirmed').length,
    expired: requests.filter((r) => r.status === 'expired').length,
    cancelled: requests.filter((r) => r.status === 'cancelled').length,
    error: requests.filter((r) => r.status === 'error').length,
  };

  return (
    <div>
      <h1 className="font-display text-2xl text-charcoal mb-6">Your Scheduling Requests</h1>

      {/* Status filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/dashboard"
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
            !statusFilter
              ? 'bg-charcoal text-cream'
              : 'bg-cream-alt text-slate hover:bg-border hover:text-charcoal'
          }`}
        >
          All ({counts.all})
        </Link>
        {Object.entries(counts)
          .filter(([key]) => key !== 'all')
          .map(([status, count]) => (
            <Link
              key={status}
              href={`/dashboard?status=${status}`}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                statusFilter === status
                  ? 'bg-charcoal text-cream'
                  : `${statusColors[status]} hover:opacity-80`
              }`}
            >
              {formatStatus(status)} ({count})
            </Link>
          ))}
      </div>

      {/* Request list */}
      {filteredRequests.length === 0 ? (
        <div className="card p-8 text-center text-slate">
          {requests.length === 0
            ? assistant
              ? `No scheduling requests yet. CC ${assistant.email} on an email to get started.`
              : 'No scheduling requests yet. Connect an assistant to get started.'
            : 'No requests match the selected filter.'}
        </div>
      ) : (
        <div className="card divide-y divide-border-light overflow-hidden">
          {filteredRequests.map((request) => (
            <Link
              key={request.id}
              href={`/dashboard/requests/${request.id}`}
              className="block p-4 hover:bg-cream-alt transition-colors duration-200"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-3">
                    <span className={`badge ${statusColors[request.status]}`}>
                      {formatStatus(request.status)}
                    </span>
                    <span className="text-charcoal font-medium truncate">
                      {request.meetingTitle ||
                        (request.attendees as { name?: string; email: string }[])
                          .map((a) => a.name || a.email)
                          .join(', ') ||
                        'Untitled Meeting'}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-slate">
                    {request.confirmedStartTime
                      ? `Confirmed: ${formatDate(request.confirmedStartTime)}`
                      : `Created: ${formatDate(request.createdAt)}`}
                  </div>
                </div>
                <svg className="w-5 h-5 text-slate" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
