'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();
      setSettings(data.settings);
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
        body: JSON.stringify({ settings }),
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
