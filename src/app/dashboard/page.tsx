import { db } from '@/lib/db';
import { schedulingRequests, users, assistants } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  proposing: 'bg-blue-100 text-blue-800',
  awaiting_confirmation: 'bg-purple-100 text-purple-800',
  confirmed: 'bg-green-100 text-green-800',
  expired: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
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

export default async function DashboardPage({ searchParams }: { searchParams: { status?: string } }) {
  const user = await getCurrentUser();
  if (!user) return null;

  // Get assistant email if connected
  const assistant = user.assistantId
    ? await db.query.assistants.findFirst({
        where: eq(assistants.id, user.assistantId),
      })
    : null;

  const statusFilter = searchParams.status;

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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Your Scheduling Requests</h1>

      {/* Status filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/dashboard"
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            !statusFilter ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                statusFilter === status ? 'bg-gray-900 text-white' : `${statusColors[status]} hover:opacity-80`
              }`}
            >
              {formatStatus(status)} ({count})
            </Link>
          ))}
      </div>

      {/* Request list */}
      {filteredRequests.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          {requests.length === 0
            ? assistant
              ? `No scheduling requests yet. CC ${assistant.email} on an email to get started.`
              : 'No scheduling requests yet. Connect an assistant to get started.'
            : 'No requests match the selected filter.'}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          {filteredRequests.map((request) => (
            <Link
              key={request.id}
              href={`/dashboard/requests/${request.id}`}
              className="block p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[request.status]}`}>
                      {formatStatus(request.status)}
                    </span>
                    <span className="text-gray-900 font-medium truncate">
                      {request.meetingTitle ||
                        (request.attendees as { name?: string; email: string }[])
                          .map((a) => a.name || a.email)
                          .join(', ') ||
                        'Untitled Meeting'}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    {request.confirmedStartTime
                      ? `Confirmed: ${formatDate(request.confirmedStartTime)}`
                      : `Created: ${formatDate(request.createdAt)}`}
                  </div>
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
