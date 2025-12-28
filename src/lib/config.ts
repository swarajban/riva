// Centralized configuration
// All environment variables and constants are defined here

export const config = {
  // App
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  rivaEmail: process.env.RIVA_EMAIL || 'riva@semprehealth.com',

  // Database
  databaseUrl: process.env.DATABASE_URL!,

  // Google OAuth
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback',
    pubsubTopic: process.env.GOOGLE_PUBSUB_TOPIC!,
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/contacts.readonly',
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
    model: 'claude-sonnet-4-5-20250929',
  },

  // Session
  sessionSecret: process.env.SESSION_SECRET!,

  // Timing constants
  timing: {
    emailDelayMinMs: 5 * 60 * 1000,      // 5 minutes
    emailDelayMaxMs: 15 * 60 * 1000,     // 15 minutes
    smsReminderMs: 3 * 60 * 60 * 1000,   // 3 hours
    requestExpirationMs: 2 * 24 * 60 * 60 * 1000, // 2 days
    gmailWatchRenewalMs: 6 * 24 * 60 * 60 * 1000, // 6 days
    tokenRefreshBufferMs: 5 * 60 * 1000, // 5 minutes before expiration
    blackoutStartHour: 0,  // 12am PT
    blackoutEndHour: 5,    // 5am PT
  },
} as const;

// Helper to get a random delay between min and max
export function getRandomEmailDelay(): number {
  const { emailDelayMinMs, emailDelayMaxMs } = config.timing;
  return Math.floor(Math.random() * (emailDelayMaxMs - emailDelayMinMs + 1)) + emailDelayMinMs;
}
