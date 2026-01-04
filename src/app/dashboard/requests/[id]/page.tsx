import { db } from '@/lib/db';
import { schedulingRequests, emailThreads, smsMessages } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { eq, asc, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatDateTimePT } from '@/lib/utils/time';
import { CancelRequestButton } from '@/components/CancelRequestButton';
import { SendNowButton } from '@/components/SendNowButton';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  proposing: 'bg-blue-100 text-blue-800',
  awaiting_confirmation: 'bg-purple-100 text-purple-800',
  confirmed: 'bg-green-100 text-green-800',
  expired: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
};

export default async function RequestDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return null;

  // Get the request - only if it belongs to the current user
  const request = await db.query.schedulingRequests.findFirst({
    where: and(eq(schedulingRequests.id, params.id), eq(schedulingRequests.userId, user.id)),
  });

  if (!request) {
    notFound();
  }

  // Get email threads
  const emails = await db.query.emailThreads.findMany({
    where: eq(emailThreads.schedulingRequestId, params.id),
    orderBy: asc(emailThreads.createdAt),
  });

  // Get SMS messages
  const sms = await db.query.smsMessages.findMany({
    where: eq(smsMessages.schedulingRequestId, params.id),
    orderBy: asc(smsMessages.createdAt),
  });

  const attendees = (request.attendees as { email: string; name?: string }[]) || [];
  const proposedTimes = (request.proposedTimes as { start: string; end: string; round: number }[]) || [];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">
          &larr; Back to requests
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{request.meetingTitle || 'Scheduling Request'}</h1>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[request.status]}`}>
            {request.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Email thread */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="font-medium text-gray-900">Email Thread</h2>
            </div>
            {emails.length === 0 ? (
              <div className="p-4 text-gray-500 text-sm">No emails yet</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {emails.map((email) => {
                  const toEmails = (email.toEmails as string[]) || [];
                  const ccEmails = (email.ccEmails as string[]) || [];
                  return (
                    <div key={email.id} className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <span className="font-medium text-gray-900">{email.fromName || email.fromEmail}</span>
                          <span className="text-gray-500 text-sm ml-2">
                            {email.direction === 'outbound' ? '(Assistant)' : ''}
                          </span>
                        </div>
                        <span className="text-xs text-gray-400 flex items-center">
                          {email.sentAt || email.receivedAt ? (
                            new Date((email.sentAt || email.receivedAt)!).toLocaleString()
                          ) : email.scheduledSendAt ? (
                            <>
                              Scheduled: {new Date(email.scheduledSendAt).toLocaleString()}
                              <SendNowButton emailId={email.id} />
                            </>
                          ) : (
                            ''
                          )}
                        </span>
                      </div>
                      {toEmails.length > 0 && (
                        <div className="text-sm text-gray-500 mb-1">To: {toEmails.join(', ')}</div>
                      )}
                      {ccEmails.length > 0 && (
                        <div className="text-sm text-gray-500 mb-1">Cc: {ccEmails.join(', ')}</div>
                      )}
                      {email.subject && <div className="text-sm text-gray-600 mb-2">Subject: {email.subject}</div>}
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">{email.bodyText}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SMS history */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="font-medium text-gray-900">SMS History</h2>
            </div>
            {sms.length === 0 ? (
              <div className="p-4 text-gray-500 text-sm">No SMS messages yet</div>
            ) : (
              <div className="p-4 space-y-3">
                {sms.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-xs rounded-lg px-4 py-2 ${
                        message.direction === 'outbound' ? 'bg-gray-100 text-gray-900' : 'bg-blue-500 text-white'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap">{message.body}</div>
                      <div
                        className={`text-xs mt-1 ${
                          message.direction === 'outbound' ? 'text-gray-400' : 'text-blue-100'
                        }`}
                      >
                        {(message.sentAt || message.receivedAt) &&
                          new Date((message.sentAt || message.receivedAt)!).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Attendees */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="font-medium text-gray-900">Attendees</h2>
            </div>
            <div className="p-4">
              {attendees.length === 0 ? (
                <div className="text-gray-500 text-sm">No attendees</div>
              ) : (
                <ul className="space-y-2">
                  {attendees.map((attendee, i) => (
                    <li key={i} className="text-sm">
                      <div className="font-medium text-gray-900">{attendee.name || attendee.email}</div>
                      {attendee.name && <div className="text-gray-500">{attendee.email}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Proposed times */}
          {proposedTimes.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="font-medium text-gray-900">Proposed Times</h2>
              </div>
              <div className="p-4">
                <ul className="space-y-2 text-sm">
                  {proposedTimes.map((slot, i) => (
                    <li key={i} className="text-gray-700">
                      {formatDateTimePT(new Date(slot.start))}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Confirmed booking */}
          {request.confirmedStartTime && (
            <div className="bg-green-50 rounded-lg border border-green-200">
              <div className="px-4 py-3 border-b border-green-200">
                <h2 className="font-medium text-green-900">Confirmed Booking</h2>
              </div>
              <div className="p-4 text-sm text-green-800">
                <div className="font-medium">{formatDateTimePT(request.confirmedStartTime)}</div>
                {request.googleCalendarEventId && <div className="mt-2 text-green-600">Calendar event created</div>}
              </div>
            </div>
          )}

          {/* Error details */}
          {request.status === 'error' && request.errorMessage && (
            <div className="bg-red-50 rounded-lg border border-red-200">
              <div className="px-4 py-3 border-b border-red-200">
                <h2 className="font-medium text-red-900">Error Details</h2>
              </div>
              <div className="p-4 text-sm text-red-800">{request.errorMessage}</div>
            </div>
          )}

          {/* Metadata */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="font-medium text-gray-900">Details</h2>
            </div>
            <div className="p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-900">{request.createdAt?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Meeting length</span>
                <span className="text-gray-900">{request.meetingLengthMinutes || 30} min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Video link</span>
                <span className="text-gray-900">{request.includeVideoLink ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          {/* Cancel button - only show for active requests */}
          {!['cancelled', 'expired', 'error'].includes(request.status) && (
            <CancelRequestButton requestId={request.id} hasCalendarEvent={!!request.googleCalendarEventId} />
          )}
        </div>
      </div>
    </div>
  );
}
