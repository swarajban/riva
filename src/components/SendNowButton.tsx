'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SendNowButtonProps {
  emailId: string;
}

export function SendNowButton({ emailId }: SendNowButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleSendNow = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/email-threads/${emailId}/send-now`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send email');
      }

      router.refresh();
    } catch (error) {
      console.error('Send now error:', error);
      alert(error instanceof Error ? error.message : 'Failed to send email');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleSendNow}
      disabled={isLoading}
      className="ml-2 px-2 py-0.5 bg-taupe text-white text-xs font-medium rounded hover:bg-taupe-hover disabled:opacity-50 transition-all duration-200"
    >
      {isLoading ? 'Sending...' : 'Send now'}
    </button>
  );
}
