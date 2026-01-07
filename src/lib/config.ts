// Centralized configuration
// All environment variables and constants are defined here

export const config = {
  // Environment
  isProduction: process.env.NODE_ENV === 'production',

  // App
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',

  // Database
  databaseUrl: process.env.DATABASE_URL!,

  // Google OAuth
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    userRedirectUri: process.env.GOOGLE_USER_REDIRECT_URI || 'http://localhost:3000/auth/user/callback',
    assistantRedirectUri: process.env.GOOGLE_ASSISTANT_REDIRECT_URI || 'http://localhost:3000/auth/assistant/callback',
    pubsubTopic: process.env.GOOGLE_PUBSUB_TOPIC!,
    // Full scopes for assistant (Gmail + Calendar access)
    assistantScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/contacts.readonly',
    ],
    // Minimal scopes for users (just identity verification)
    userScopes: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
  },

  // Twilio
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER!,
  },

  // Anthropic
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-opus-4-5-20251101',
    useExtendedThinking: true,
    thinkingBudget: 10000, // tokens for thinking
  },

  // Telegram
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
  },

  // Session
  sessionSecret: process.env.SESSION_SECRET!,

  // Development options
  fastEmailDelay: process.env.FAST_EMAIL_DELAY === 'true',

  // Timing constants
  timing: {
    emailDelayMinMs: 2 * 60 * 1000, // 2 minutes
    emailDelayMaxMs: 7 * 60 * 1000, // 7 minutes
    smsReminderMs: 3 * 60 * 60 * 1000, // 3 hours
    requestExpirationMs: 2 * 24 * 60 * 60 * 1000, // 2 days
    gmailWatchRenewalMs: 6 * 24 * 60 * 60 * 1000, // 6 days
    tokenRefreshBufferMs: 5 * 60 * 1000, // 5 minutes before expiration
    blackoutStartHour: 0, // 12am PT
    blackoutEndHour: 5, // 5am PT
  },
} as const;

// Helper to get a random delay between min and max
export function getRandomEmailDelay(): number {
  // Fast mode for local testing: 5 second delay
  if (config.fastEmailDelay) {
    return 60 * 1000; // 5 seconds
  }

  const { emailDelayMinMs, emailDelayMaxMs } = config.timing;
  return Math.floor(Math.random() * (emailDelayMaxMs - emailDelayMinMs + 1)) + emailDelayMinMs;
}
