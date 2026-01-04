'use client';

export function LocalTimestamp({ date }: { date: Date | string }) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return <>{d.toLocaleString()}</>;
}
