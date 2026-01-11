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
  confirmOutboundEmails?: boolean;
}

interface KeywordRule {
  phrase: string;
  instruction: string;
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
  const [notificationPreference, setNotificationPreference] = useState<'dashboard' | 'sms' | 'telegram'>('dashboard');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [phone, setPhone] = useState('');
  const [assistant, setAssistant] = useState<AssistantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRule, setNewRule] = useState<KeywordRule>({ phrase: '', instruction: '' });

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

  // Auto-detect timezone on first load if still default
  useEffect(() => {
    if (settings && settings.timezone === 'America/Los_Angeles') {
      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browserTimezone !== 'America/Los_Angeles') {
        updateSetting('timezone', browserTimezone);
      }
    }
  }, [settings?.timezone]);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();
      setSettings(data.settings);
      setNotificationPreference(data.notificationPreference || 'dashboard');
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

  function addRule() {
    if (!settings || !newRule.phrase.trim() || !newRule.instruction.trim()) return;
    updateSetting('keywordRules', [
      ...settings.keywordRules,
      { phrase: newRule.phrase.trim(), instruction: newRule.instruction.trim() },
    ]);
    setNewRule({ phrase: '', instruction: '' });
    setIsAddingRule(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate">Loading settings...</div>
      </div>
    );
  }

  if (!settings) {
    return <div className="text-rose-600">Failed to load settings</div>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-charcoal mb-6">Settings</h1>

      {message && (
        <div
          className={`mb-6 p-4 rounded-card ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {/* Assistant Account */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-charcoal mb-4">Assistant Account</h2>
          {assistant ? (
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-charcoal">{assistant.name || assistant.email}</div>
                  <div className="text-sm text-slate">{assistant.email}</div>
                </div>
              </div>
              <p className="text-sm text-slate">
                This Google account sends emails and manages calendar events on your behalf.
              </p>
              <a href="/auth/assistant/login" className="inline-block text-sm link-underline">
                Connect a different account
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate">
                Connect a Google account that Riva will use to send emails and manage calendar events on your behalf.
                This should be a separate account from your personal login (e.g., assistant@yourcompany.com).
              </p>
              <a
                href="/auth/assistant/login"
                className="btn-accent"
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

        {/* Timezone */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-charcoal mb-4">Timezone</h2>
          <select
            value={settings.timezone}
            onChange={(e) => updateSetting('timezone', e.target.value)}
            className="select"
          >
            {Intl.supportedValuesOf('timeZone').map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-slate">
            Used for working hours and to avoid sending emails during your nighttime (12am-5am).
          </p>
        </div>

        {/* Working Hours */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-charcoal mb-4">Working Hours</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1">Start Time</label>
              <input
                type="time"
                value={settings.workingHoursStart}
                onChange={(e) => updateSetting('workingHoursStart', e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1">End Time</label>
              <input
                type="time"
                value={settings.workingHoursEnd}
                onChange={(e) => updateSetting('workingHoursEnd', e.target.value)}
                className="input"
              />
            </div>
          </div>
        </div>

        {/* Working Days */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-charcoal mb-4">Working Days</h2>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => (
              <button
                key={day.value}
                onClick={() => toggleDay(day.value)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                  settings.workingDays.includes(day.value)
                    ? 'bg-taupe text-white'
                    : 'bg-cream-alt text-slate hover:bg-border hover:text-charcoal'
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>

        {/* Meeting Preferences */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-charcoal mb-4">Meeting Preferences</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1">Default Meeting Length (minutes)</label>
              <input
                type="number"
                value={settings.defaultMeetingLengthMinutes}
                onChange={(e) => updateSetting('defaultMeetingLengthMinutes', parseInt(e.target.value) || 30)}
                className="input w-32"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1">Buffer Between Meetings (minutes)</label>
              <input
                type="number"
                value={settings.bufferMinutes}
                onChange={(e) => updateSetting('bufferMinutes', parseInt(e.target.value) || 0)}
                className="input w-32"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1">Number of Options to Suggest</label>
              <input
                type="number"
                value={settings.numOptionsToSuggest}
                onChange={(e) => updateSetting('numOptionsToSuggest', parseInt(e.target.value) || 4)}
                className="input w-32"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1">Max Slots Per Day</label>
              <input
                type="number"
                value={settings.maxSlotsPerDay}
                onChange={(e) => updateSetting('maxSlotsPerDay', parseInt(e.target.value) || 2)}
                className="input w-32"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1">Lookahead Days</label>
              <input
                type="number"
                value={settings.lookaheadDays}
                onChange={(e) => updateSetting('lookaheadDays', parseInt(e.target.value) || 10)}
                className="input w-32"
              />
            </div>
          </div>
        </div>

        {/* Zoom Link */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-charcoal mb-4">Zoom Personal Meeting Room</h2>
          <input
            type="url"
            value={settings.zoomPersonalLink || ''}
            onChange={(e) => updateSetting('zoomPersonalLink', e.target.value || null)}
            placeholder="https://zoom.us/j/..."
            className="input"
          />
          <p className="mt-2 text-sm text-slate">
            This link will be included in calendar invites when video is enabled.
          </p>
        </div>

        {/* Email Confirmation */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-charcoal mb-4">Email Confirmation</h2>
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.confirmOutboundEmails || false}
              onChange={(e) => updateSetting('confirmOutboundEmails', e.target.checked)}
              className="checkbox"
            />
            <span className="text-charcoal">Confirm all outbound emails before sending</span>
          </label>
          <p className="mt-3 text-sm text-slate">
            When enabled, you will receive a preview of every email via SMS/Telegram and must approve it before it is
            sent. You can also request edits to the email content or recipients.
          </p>
        </div>

        {/* Notification Preferences */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-charcoal mb-4">Notification Preferences</h2>
          <div className="space-y-4">
            <p className="text-sm text-slate">
              Dashboard notifications are always enabled. You can view and respond to confirmation requests directly in the dashboard.
            </p>

            {/* Real-time alerts toggle */}
            <div className="pt-2">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationPreference !== 'dashboard'}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setNotificationPreference('telegram');
                    } else {
                      setNotificationPreference('dashboard');
                    }
                  }}
                  className="checkbox"
                />
                <span className="text-charcoal">Enable real-time alerts</span>
              </label>
              <p className="mt-1 ml-7 text-sm text-slate">
                Get notified instantly via SMS or Telegram when Riva needs your attention.
              </p>
            </div>

            {/* Alert method selection - only show when alerts enabled */}
            {notificationPreference !== 'dashboard' && (
              <div className="ml-7 space-y-4 pt-2">
                <div className="flex gap-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="alertMethod"
                      checked={notificationPreference === 'telegram'}
                      onChange={() => setNotificationPreference('telegram')}
                      className="w-4 h-4 text-taupe focus:ring-taupe"
                    />
                    <span className="text-charcoal">Telegram</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="alertMethod"
                      checked={notificationPreference === 'sms'}
                      onChange={() => setNotificationPreference('sms')}
                      className="w-4 h-4 text-taupe focus:ring-taupe"
                    />
                    <span className="text-charcoal">SMS</span>
                  </label>
                </div>

                {/* Telegram setup */}
                {notificationPreference === 'telegram' && (
                  <div>
                    <label className="block text-sm font-medium text-charcoal mb-1">Telegram Chat ID</label>
                    <input
                      type="text"
                      value={telegramChatId}
                      onChange={(e) => setTelegramChatId(e.target.value)}
                      placeholder="123456789"
                      className="input"
                    />
                    <div className="mt-2 text-sm text-slate space-y-2">
                      <p>Setup steps:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>
                          <a
                            href={`https://t.me/${(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '').replace('@', '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link-underline"
                          >
                            Open Riva bot in Telegram
                          </a>{' '}
                          and send /start
                        </li>
                        <li>
                          Message{' '}
                          <a
                            href="https://t.me/userinfobot"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link-underline"
                          >
                            @userinfobot
                          </a>{' '}
                          - it will reply with your info
                        </li>
                        <li>
                          Copy the numeric <strong>Id</strong> (e.g. 123456789), not your username
                        </li>
                      </ol>
                    </div>
                  </div>
                )}

                {/* SMS setup */}
                {notificationPreference === 'sms' && (
                  <div>
                    <label className="block text-sm font-medium text-charcoal mb-1">Phone Number</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 (555) 123-4567"
                      className="input"
                    />
                    <p className="mt-1 text-sm text-slate">
                      Include country code for international numbers.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Keyword Rules */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-charcoal mb-4">Keyword Rules</h2>
          <p className="text-sm text-slate mb-4">
            Define custom instructions that trigger based on phrases in emails.
          </p>
          {settings.keywordRules.length > 0 && (
            <div className="space-y-3 mb-4">
              {settings.keywordRules.map((rule, index) => (
                <div key={index} className="p-3 bg-cream-alt rounded-card flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-charcoal">&quot;{rule.phrase}&quot;</span>
                    <span className="text-slate mx-2">&rarr;</span>
                    <span className="text-slate">{rule.instruction}</span>
                  </div>
                  <button
                    onClick={() => {
                      const rules = [...settings.keywordRules];
                      rules.splice(index, 1);
                      updateSetting('keywordRules', rules);
                    }}
                    className="text-rose-600 hover:text-rose-800 text-sm shrink-0 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {isAddingRule ? (
            <div className="p-4 bg-cream-alt rounded-card space-y-3">
              <div>
                <label className="block text-sm font-medium text-charcoal mb-1">When I see...</label>
                <input
                  type="text"
                  value={newRule.phrase}
                  onChange={(e) => setNewRule({ ...newRule, phrase: e.target.value })}
                  placeholder="e.g., quick sync"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-charcoal mb-1">Then...</label>
                <input
                  type="text"
                  value={newRule.instruction}
                  onChange={(e) => setNewRule({ ...newRule, instruction: e.target.value })}
                  placeholder="e.g., make the meeting 15 minutes"
                  className="input"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setIsAddingRule(false);
                    setNewRule({ phrase: '', instruction: '' });
                  }}
                  className="px-3 py-1.5 text-sm text-slate hover:text-charcoal transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={addRule}
                  disabled={!newRule.phrase.trim() || !newRule.instruction.trim()}
                  className="btn-accent text-sm px-3 py-1.5"
                >
                  Add Rule
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingRule(true)}
              className="text-sm link"
            >
              + Add Rule
            </button>
          )}
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={saveSettings}
            disabled={saving}
            className="btn-accent"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
