'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface UserSettings {
  defaultMeetingLengthMinutes: number;
  zoomPersonalLink: string | null;
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: string[];
  timezone: string;
  bufferMinutes: number;
  lookaheadDays: number;
  numOptionsToSuggest: number;
  maxSlotsPerDay: number;
  keywordRules: KeywordRule[];
}

interface KeywordRule {
  phrase: string;
  meetingLengthMinutes?: number;
  allowedDays?: string[];
  hourRangeStart?: string;
  hourRangeEnd?: string;
}

interface AssistantInfo {
  email: string;
  name: string | null;
}

const DAYS = [
  { value: 'mon', label: 'Monday' },
  { value: 'tue', label: 'Tuesday' },
  { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' },
  { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
];

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [notificationPreference, setNotificationPreference] = useState<'sms' | 'telegram'>('sms');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [phone, setPhone] = useState('');
  const [assistant, setAssistant] = useState<AssistantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchSettings();

    // Handle OAuth callback messages
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (success === 'assistant_connected') {
      setMessage({ type: 'success', text: 'Assistant account connected successfully!' });
      // Clear the URL params
      router.replace('/dashboard/settings', { scroll: false });
    } else if (error) {
      const errorMessages: Record<string, string> = {
        oauth_failed: 'OAuth authentication failed. Please try again.',
        no_code: 'No authorization code received.',
        no_state: 'Invalid OAuth state. Please try again.',
        user_not_found: 'User not found. Please log in again.',
        same_email: 'You cannot use your own email as the assistant account. Please use a different Google account.',
        callback_failed: 'Failed to connect assistant account. Please try again.',
        assistant_login_failed: 'Failed to start assistant login. Please try again.',
      };
      setMessage({ type: 'error', text: errorMessages[error] || 'An error occurred.' });
      router.replace('/dashboard/settings', { scroll: false });
    }
  }, [searchParams, router]);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();
      setSettings(data.settings);
      setNotificationPreference(data.notificationPreference || 'sms');
      setTelegramChatId(data.telegramChatId || '');
      setPhone(data.user?.phone || '');
      setAssistant(data.assistant || null);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    if (!settings) return;

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings,
          notificationPreference,
          telegramChatId,
          phone,
        }),
      });

      if (!res.ok) throw new Error('Failed to save settings');

      setMessage({ type: 'success', text: 'Settings saved successfully' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  }

  function updateSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  }

  function toggleDay(day: string) {
    if (!settings) return;
    const days = settings.workingDays.includes(day)
      ? settings.workingDays.filter((d) => d !== day)
      : [...settings.workingDays, day];
    updateSetting('workingDays', days);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-red-600">Failed to load settings</div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {message && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-8">
        {/* Assistant Account */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Assistant Account</h2>
          {assistant ? (
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-gray-900">{assistant.name || assistant.email}</div>
                  <div className="text-sm text-gray-500">{assistant.email}</div>
                </div>
              </div>
              <p className="text-sm text-gray-500">
                This Google account sends emails and manages calendar events on your behalf.
              </p>
              <a
                href="/auth/assistant/login"
                className="inline-block text-sm text-blue-600 hover:underline"
              >
                Connect a different account
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Connect a Google account that Riva will use to send emails and manage calendar events on your behalf.
                This should be a separate account from your personal login (e.g., assistant@yourcompany.com).
              </p>
              <a
                href="/auth/assistant/login"
                className="inline-flex items-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Connect Google Account
              </a>
            </div>
          )}
        </div>

        {/* Working Hours */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Working Hours</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={settings.workingHoursStart}
                onChange={(e) => updateSetting('workingHoursStart', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <input
                type="time"
                value={settings.workingHoursEnd}
                onChange={(e) => updateSetting('workingHoursEnd', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Working Days */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Working Days</h2>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => (
              <button
                key={day.value}
                onClick={() => toggleDay(day.value)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  settings.workingDays.includes(day.value)
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>

        {/* Meeting Preferences */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Meeting Preferences</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Meeting Length (minutes)
              </label>
              <input
                type="number"
                value={settings.defaultMeetingLengthMinutes}
                onChange={(e) =>
                  updateSetting('defaultMeetingLengthMinutes', parseInt(e.target.value) || 30)
                }
                className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Buffer Between Meetings (minutes)
              </label>
              <input
                type="number"
                value={settings.bufferMinutes}
                onChange={(e) =>
                  updateSetting('bufferMinutes', parseInt(e.target.value) || 0)
                }
                className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Number of Options to Suggest
              </label>
              <input
                type="number"
                value={settings.numOptionsToSuggest}
                onChange={(e) =>
                  updateSetting('numOptionsToSuggest', parseInt(e.target.value) || 4)
                }
                className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Slots Per Day
              </label>
              <input
                type="number"
                value={settings.maxSlotsPerDay}
                onChange={(e) =>
                  updateSetting('maxSlotsPerDay', parseInt(e.target.value) || 2)
                }
                className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Lookahead Days
              </label>
              <input
                type="number"
                value={settings.lookaheadDays}
                onChange={(e) =>
                  updateSetting('lookaheadDays', parseInt(e.target.value) || 10)
                }
                className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Zoom Link */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Zoom Personal Meeting Room</h2>
          <input
            type="url"
            value={settings.zoomPersonalLink || ''}
            onChange={(e) => updateSetting('zoomPersonalLink', e.target.value || null)}
            placeholder="https://zoom.us/j/..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-2 text-sm text-gray-500">
            This link will be included in calendar invites when video is enabled.
          </p>
        </div>

        {/* Notification Preferences */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Notification Preferences</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notification Method
              </label>
              <select
                value={notificationPreference}
                onChange={(e) => setNotificationPreference(e.target.value as 'sms' | 'telegram')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="sms">SMS (Twilio)</option>
                <option value="telegram">Telegram</option>
              </select>
              <p className="mt-1 text-sm text-gray-500">
                Choose how you want to receive meeting confirmation requests.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number (for SMS)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1234567890"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-gray-500">
                Your phone number for SMS notifications (with country code).
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Telegram Chat ID
              </label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="123456789"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="mt-2 text-sm text-gray-500 space-y-2">
                <p>Setup steps:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>
                    <a
                      href={`https://t.me/${(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '').replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Open Riva bot in Telegram
                    </a>
                    {' '}and send /start
                  </li>
                  <li>
                    Message{' '}
                    <a
                      href="https://t.me/userinfobot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      @userinfobot
                    </a>
                    {' '}- it will reply with your info
                  </li>
                  <li>Copy the numeric <strong>Id</strong> (e.g. 123456789), not your username</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        {/* Keyword Rules */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Keyword Rules</h2>
          <p className="text-sm text-gray-500 mb-4">
            Define custom rules that trigger based on phrases in emails.
          </p>
          {settings.keywordRules.length === 0 ? (
            <div className="text-gray-500 text-sm">No keyword rules defined.</div>
          ) : (
            <div className="space-y-4">
              {settings.keywordRules.map((rule, index) => (
                <div key={index} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900">&quot;{rule.phrase}&quot;</span>
                    <button
                      onClick={() => {
                        const rules = [...settings.keywordRules];
                        rules.splice(index, 1);
                        updateSetting('keywordRules', rules);
                      }}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="text-sm text-gray-600">
                    {rule.meetingLengthMinutes && (
                      <span className="mr-3">{rule.meetingLengthMinutes} min</span>
                    )}
                    {rule.allowedDays && (
                      <span className="mr-3">Days: {rule.allowedDays.join(', ')}</span>
                    )}
                    {rule.hourRangeStart && rule.hourRangeEnd && (
                      <span>
                        Hours: {rule.hourRangeStart}-{rule.hourRangeEnd}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
