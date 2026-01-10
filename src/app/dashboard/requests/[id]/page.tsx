import { db } from '@/lib/db';
import { schedulingRequests, emailThreads, smsMessages } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { eq, asc, desc, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatDateTimePT } from '@/lib/utils/time';
import { CancelRequestButton } from '@/components/CancelRequestButton';
import { SendNowButton } from '@/components/SendNowButton';
import { LocalTimestamp } from '@/components/LocalTimestamp';

const statusColors: Record<string, string> = {
  pending: 'badge-pending',
  proposing: 'badge-proposing',
  awaiting_confirmation: 'badge-awaiting',
  confirmed: 'badge-confirmed',
  expired: 'badge-expired',
  cancelled: 'badge-cancelled',
  error: 'badge-error',
};

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) return null;

  // Get the request - only if it belongs to the current user
  const request = await db.query.schedulingRequests.findFirst({
    where: and(eq(schedulingRequests.id, id), eq(schedulingRequests.userId, user.id)),
  });

  if (!request) {
    notFound();
  }

  // Get email threads
  const emails = await db.query.emailThreads.findMany({
    where: eq(emailThreads.schedulingRequestId, id),
    orderBy: desc(emailThreads.createdAt),
  });

  // Get SMS messages
  const sms = await db.query.smsMessages.findMany({
    where: eq(smsMessages.schedulingRequestId, id),
    orderBy: asc(smsMessages.createdAt),
  });

  const attendees = (request.attendees as { email: string; name?: string }[]) || [];
  const proposedTimes = (request.proposedTimes as { start: string; end: string; round: number }[]) || [];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/dashboard" className="text-sm text-slate hover:text-charcoal transition-colors inline-block mb-2">
          &larr; Back to requests
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl text-charcoal">{request.meetingTitle || 'Scheduling Request'}</h1>
          <span className={`badge ${statusColors[request.status]}`}>
            {request.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Email thread */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-display text-charcoal">Email Thread</h2>
            </div>
            {(() => {
              // Find the most recent sent email timestamp to filter out stale pending emails
              const mostRecentSentAt = emails
                .filter((e) => e.sentAt)
                .map((e) => e.sentAt!.getTime())
                .sort((a, b) => b - a)[0];

              // Filter out cancelled and stale pending emails
              const visibleEmails = emails.filter((email) => {
                // Hide cancelled emails (they have processingError set)
                if (email.processingError) {
                  return false;
                }

                // Hide stale pending emails (pending emails created before the most recent sent email)
                const isPending = !email.sentAt && !email.receivedAt && !email.scheduledSendAt && email.direction === 'outbound';
                if (isPending && mostRecentSentAt && email.createdAt && email.createdAt.getTime() < mostRecentSentAt) {
                  return false;
                }
                return true;
              });

              return visibleEmails.length === 0 ? (
                <div className="p-4 text-slate text-sm">No emails yet</div>
              ) : (
                <div className="divide-y divide-border-light">
                  {visibleEmails.map((email) => {
                    const toEmails = (email.toEmails as string[]) || [];
                    const ccEmails = (email.ccEmails as string[]) || [];

                    // Determine email status
                    const isSent = !!email.sentAt;
                    const isReceived = !!email.receivedAt;
                    const isScheduled = !isSent && !!email.scheduledSendAt;
                    const isPendingApproval = !isSent && !isReceived && !email.scheduledSendAt && email.direction === 'outbound';

                  return (
                    <div
                      key={email.id}
                      className={`p-4 ${
                        isPendingApproval
                          ? 'border-2 border-dashed border-amber-300 bg-amber-50/50 m-2 rounded-card'
                          : ''
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isPendingApproval ? 'text-slate' : 'text-charcoal'}`}>
                            {email.fromName || email.fromEmail}
                          </span>
                          <span className="text-slate text-sm">
                            {email.direction === 'outbound'
                              ? '(Assistant)'
                              : email.fromName && email.fromEmail
                                ? `<${email.fromEmail}>`
                                : ''}
                          </span>
                          {isPendingApproval && (
                            <span className="badge badge-pending">
                              Pending Approval
                            </span>
                          )}
                          {isScheduled && (
                            <span className="badge bg-amber-50 text-amber-700 border-amber-200">
                              Scheduled
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-muted flex items-center gap-1">
                          {isSent || isReceived ? (
                            <LocalTimestamp date={(email.sentAt || email.receivedAt)!} />
                          ) : isScheduled ? (
                            <>
                              <LocalTimestamp date={email.scheduledSendAt!} />
                              <SendNowButton emailId={email.id} />
                            </>
                          ) : null}
                        </span>
                      </div>
                      {toEmails.length > 0 && (
                        <div className={`text-sm mb-1 ${isPendingApproval ? 'text-slate-muted' : 'text-slate'}`}>
                          To: {toEmails.join(', ')}
                        </div>
                      )}
                      {ccEmails.length > 0 && (
                        <div className={`text-sm mb-1 ${isPendingApproval ? 'text-slate-muted' : 'text-slate'}`}>
                          Cc: {ccEmails.join(', ')}
                        </div>
                      )}
                      {email.subject && (
                        <div className={`text-sm mb-2 ${isPendingApproval ? 'text-slate' : 'text-charcoal-light'}`}>
                          Subject: {email.subject}
                        </div>
                      )}
                      <div className={`text-sm whitespace-pre-wrap ${isPendingApproval ? 'text-slate' : 'text-charcoal'}`}>
                        {email.bodyText}
                      </div>
                    </div>
                  );
                  })}
                </div>
              );
            })()}
          </div>

          {/* SMS history */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-display text-charcoal">SMS History</h2>
            </div>
            {sms.length === 0 ? (
              <div className="p-4 text-slate text-sm">No SMS messages yet</div>
            ) : (
              <div className="p-4 space-y-3">
                {sms.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-xs rounded-2xl px-4 py-2 ${
                        message.direction === 'outbound' ? 'bg-cream-alt text-charcoal' : 'bg-taupe text-white'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap">{message.body}</div>
                      <div
                        className={`text-xs mt-1 ${
                          message.direction === 'outbound' ? 'text-slate-muted' : 'text-white/70'
                        }`}
                      >
                        {(message.sentAt || message.receivedAt) && (
                          <LocalTimestamp date={(message.sentAt || message.receivedAt)!} />
                        )}
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
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-display text-charcoal">Attendees</h2>
            </div>
            <div className="p-4">
              {attendees.length === 0 ? (
                <div className="text-slate text-sm">No attendees</div>
              ) : (
                <ul className="space-y-2">
                  {attendees.map((attendee, i) => (
                    <li key={i} className="text-sm">
                      <div className="font-medium text-charcoal">{attendee.name || attendee.email}</div>
                      {attendee.name && <div className="text-slate">{attendee.email}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Proposed times */}
          {proposedTimes.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="font-display text-charcoal">Proposed Times</h2>
              </div>
              <div className="p-4">
                <ul className="space-y-2 text-sm">
                  {proposedTimes.map((slot, i) => (
                    <li key={i} className="text-slate">
                      {formatDateTimePT(new Date(slot.start))}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Confirmed booking */}
          {request.confirmedStartTime && (
            <div className="bg-emerald-50 rounded-card border border-emerald-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-emerald-200">
                <h2 className="font-display text-emerald-900">Confirmed Booking</h2>
              </div>
              <div className="p-4 text-sm text-emerald-800">
                <div className="font-medium">{formatDateTimePT(request.confirmedStartTime)}</div>
                {request.googleCalendarEventId && <div className="mt-2 text-emerald-600">Calendar event created</div>}
              </div>
            </div>
          )}

          {/* Error details */}
          {request.status === 'error' && request.errorMessage && (
            <div className="bg-rose-50 rounded-card border border-rose-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-rose-200">
                <h2 className="font-display text-rose-900">Error Details</h2>
              </div>
              <div className="p-4 text-sm text-rose-800">{request.errorMessage}</div>
            </div>
          )}

          {/* Metadata */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-display text-charcoal">Details</h2>
            </div>
            <div className="p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-slate">Created</span>
                <span className="text-charcoal">
                  {request.createdAt && <LocalTimestamp date={request.createdAt} />}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate">Meeting length</span>
                <span className="text-charcoal">{request.meetingLengthMinutes || 30} min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate">Video link</span>
                <span className="text-charcoal">{request.includeVideoLink ? 'Yes' : 'No'}</span>
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
