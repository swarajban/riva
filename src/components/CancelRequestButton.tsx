'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CancelRequestButtonProps {
  requestId: string;
  hasCalendarEvent: boolean;
}

export function CancelRequestButton({ requestId, hasCalendarEvent }: CancelRequestButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleCancel = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/scheduling-requests/${requestId}/cancel`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to cancel request');
      }

      router.refresh();
    } catch (error) {
      console.error('Cancel error:', error);
      alert(error instanceof Error ? error.message : 'Failed to cancel request');
    } finally {
      setIsLoading(false);
      setShowConfirm(false);
    }
  };

  if (showConfirm) {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-4">
        <p className="text-sm text-red-800 mb-3">
          Are you sure you want to cancel this request?
          {hasCalendarEvent && (
            <span className="block mt-1 font-medium">
              This will also delete the calendar event and notify attendees.
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={isLoading}
            className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50"
          >
            {isLoading ? 'Cancelling...' : 'Yes, cancel'}
          </button>
          <button
            onClick={() => setShowConfirm(false)}
            disabled={isLoading}
            className="px-3 py-1.5 bg-white text-gray-700 text-sm font-medium rounded border border-gray-300 hover:bg-gray-50"
          >
            No, keep it
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="w-full px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
    >
      Cancel Request
    </button>
  );
}
