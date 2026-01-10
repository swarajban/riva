'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface AgentProcessingBannerProps {
  isProcessing: boolean;
}

export function AgentProcessingBanner({ isProcessing }: AgentProcessingBannerProps) {
  const router = useRouter();

  // Poll for updates while processing
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      router.refresh();
    }, 2000);

    return () => clearInterval(interval);
  }, [isProcessing, router]);

  if (!isProcessing) return null;

  return (
    <div className="mb-6 bg-amber-50 border border-amber-200 rounded-card px-4 py-3 flex items-center gap-3">
      <svg
        className="animate-spin h-5 w-5 text-amber-600"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
      <div>
        <p className="text-sm font-medium text-amber-800">Riva AI is processing</p>
        <p className="text-xs text-amber-600">This may take a few seconds...</p>
      </div>
    </div>
  );
}
