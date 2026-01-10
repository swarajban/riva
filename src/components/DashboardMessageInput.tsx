'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type AwaitingResponseType =
  | 'booking_approval'
  | 'availability_guidance'
  | 'stale_slot_decision'
  | 'reschedule_approval'
  | 'cancel_approval'
  | 'meeting_title'
  | 'email_approval';

interface DashboardMessageInputProps {
  schedulingRequestId: string;
  awaitingResponseType?: AwaitingResponseType | null;
  isProcessing: boolean;
}

// Quick action configurations based on awaiting response type
const QUICK_ACTIONS: Record<
  AwaitingResponseType,
  Array<{ label: string; message: string; variant: 'approve' | 'reject' | 'neutral' }>
> = {
  booking_approval: [
    { label: 'Approve', message: 'Y', variant: 'approve' },
    { label: 'Reject', message: 'N', variant: 'reject' },
  ],
  email_approval: [
    { label: 'Approve', message: 'approve', variant: 'approve' },
    { label: 'Reject', message: 'reject', variant: 'reject' },
  ],
  reschedule_approval: [
    { label: 'Approve', message: 'Y', variant: 'approve' },
    { label: 'Reject', message: 'N', variant: 'reject' },
  ],
  cancel_approval: [
    { label: 'Yes, cancel', message: 'Y', variant: 'reject' },
    { label: 'No, keep it', message: 'N', variant: 'approve' },
  ],
  availability_guidance: [],
  stale_slot_decision: [],
  meeting_title: [],
};

export function DashboardMessageInput({
  schedulingRequestId,
  awaitingResponseType,
  isProcessing,
}: DashboardMessageInputProps) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when not processing
  useEffect(() => {
    if (!isProcessing) {
      inputRef.current?.focus();
    }
  }, [isProcessing]);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    setIsSending(true);
    setError(null);

    try {
      const response = await fetch('/api/dashboard/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedulingRequestId,
          message: text.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send message');
      }

      setMessage('');
      // Refresh to show the user's message and pick up processing state
      router.refresh();
    } catch (err) {
      console.error('Dashboard message error:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(message);
  };

  const handleQuickAction = (actionMessage: string) => {
    sendMessage(actionMessage);
  };

  const quickActions = awaitingResponseType ? QUICK_ACTIONS[awaitingResponseType] : [];
  const showQuickActions = quickActions.length > 0 && !isProcessing;
  const isDisabled = isSending || isProcessing;

  return (
    <div className="border-t border-border-light pt-4 space-y-3">
      {/* Quick action buttons */}
      {showQuickActions && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate">Quick actions:</span>
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => handleQuickAction(action.message)}
              disabled={isDisabled}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 disabled:opacity-50 ${
                action.variant === 'approve'
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                  : action.variant === 'reject'
                    ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                    : 'bg-cream-alt text-charcoal hover:bg-cream'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Text input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            isProcessing
              ? 'Waiting for response...'
              : awaitingResponseType
                ? 'Type a response or use quick actions above...'
                : 'Type a message...'
          }
          disabled={isDisabled}
          className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-taupe/30 focus:border-taupe disabled:opacity-50 disabled:bg-cream-alt"
        />
        <button
          type="submit"
          disabled={isDisabled || !message.trim()}
          className="px-4 py-2 bg-taupe text-white text-sm font-medium rounded-lg hover:bg-taupe-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </form>

      {/* Error message */}
      {error && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">{error}</div>}

      {/* Helper text */}
      {awaitingResponseType && !isProcessing && (
        <p className="text-xs text-slate-muted">
          {awaitingResponseType === 'booking_approval' &&
            'Reply "Y" to confirm, "N" to reject, or type edits like "change to 3pm" or "change title to Team Sync"'}
          {awaitingResponseType === 'email_approval' &&
            'Reply "approve" to send, "reject" to cancel, or describe changes like "change the tone to be more formal"'}
          {awaitingResponseType === 'availability_guidance' &&
            'Describe when you\'re available, e.g., "next week" or "afternoons only"'}
          {awaitingResponseType === 'stale_slot_decision' &&
            'The selected time is no longer available. Choose a different option or ask to find new times.'}
          {awaitingResponseType === 'meeting_title' && 'Enter a title for the meeting'}
        </p>
      )}
    </div>
  );
}
