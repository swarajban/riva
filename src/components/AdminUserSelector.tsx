'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  name: string | null;
}

export function AdminUserSelector(): React.ReactElement {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/admin/users')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setUsers(data.users))
      .catch((error) => console.error('Failed to fetch users:', error));
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleImpersonate(userId: string) {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      if (res.ok) {
        setIsOpen(false);
        router.refresh();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to impersonate');
      }
    } catch (error) {
      console.error('Impersonation error:', error);
      alert('Failed to impersonate');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        <span>View as...</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-md shadow-lg border border-gray-200 z-50">
          <div className="p-2 border-b border-gray-100">
            <span className="text-xs font-medium text-gray-500 uppercase">Select user to view as</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {users.map((user) => (
              <button
                key={user.id}
                onClick={() => handleImpersonate(user.id)}
                disabled={loading}
                className="w-full text-left px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
              >
                <div className="text-sm font-medium text-gray-900">{user.name || user.email}</div>
                <div className="text-xs text-gray-500">{user.email}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
