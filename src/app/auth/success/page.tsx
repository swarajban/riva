import { redirect } from 'next/navigation';
import { getCurrentAssistant } from '@/lib/auth/session';
import Link from 'next/link';

export default async function AssistantSuccessPage() {
  const assistant = await getCurrentAssistant();

  if (!assistant) {
    redirect('/auth/login');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 text-center">
        <div className="text-green-500 text-6xl mb-4">✓</div>
        <h1 className="text-2xl font-bold text-gray-900">Assistant Setup Complete</h1>
        <p className="text-gray-600">
          <strong>{assistant.name || assistant.email}</strong> is now connected with Gmail and Calendar access.
        </p>
        <div className="bg-gray-100 rounded-lg p-4 text-left text-sm">
          <p className="text-gray-700 mb-2">Riva can now:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-1">
            <li>Read incoming emails</li>
            <li>Send emails on behalf of the assistant</li>
            <li>Check calendar availability</li>
            <li>Create calendar events</li>
          </ul>
        </div>
        <div className="pt-4">
          <Link
            href="/auth/user/login"
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            Log in as a user to view the dashboard →
          </Link>
        </div>
      </div>
    </div>
  );
}
