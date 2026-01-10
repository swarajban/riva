'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ImpersonationBannerProps {
  impersonatedEmail: string;
}

export function ImpersonationBanner({ impersonatedEmail }: ImpersonationBannerProps): React.ReactElement {
  const router = useRouter();
  const [stopping, setStopping] = useState(false);

  async function handleStopImpersonation() {
    setStopping(true);
    try {
      const res = await fetch('/api/admin/stop-impersonate', {
        method: 'POST',
      });

      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to stop impersonation');
      }
    } catch (error) {
      console.error('Stop impersonation error:', error);
      alert('Failed to stop impersonation');
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="bg-amber-500 text-white px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          <span className="font-medium">
            Viewing as <strong>{impersonatedEmail}</strong>
          </span>
        </div>
        <button
          onClick={handleStopImpersonation}
          disabled={stopping}
          className="px-3 py-1 bg-white text-amber-600 rounded text-sm font-medium hover:bg-amber-50 disabled:opacity-50 transition-colors"
        >
          {stopping ? 'Stopping...' : 'Stop Viewing'}
        </button>
      </div>
    </div>
  );
}
