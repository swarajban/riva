import { google } from 'googleapis';
import { config } from '../config';
import { db } from '../db';
import { assistants } from '../db/schema';
import { eq } from 'drizzle-orm';

// Create OAuth2 client
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

// Generate authorization URL for assistant to visit (full Gmail/Calendar permissions)
export function getAssistantAuthUrl(state?: string): string {
  const oauth2Client = createOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [...config.google.assistantScopes],
    prompt: 'consent', // Force to get refresh token
    state,
  });
}

// Create OAuth2 client for user authentication
export function createUserOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.userRedirectUri
  );
}

// Generate authorization URL for users (minimal permissions - just identity)
export function getUserAuthUrl(state?: string): string {
  const oauth2Client = createUserOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: 'online', // Don't need refresh token for users
    scope: [...config.google.userScopes],
    prompt: 'select_account', // Let user pick which account
    state,
  });
}

// Exchange authorization code for tokens (for user login)
export async function exchangeUserCodeForTokens(code: string) {
  const oauth2Client = createUserOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Exchange authorization code for tokens
export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Get user info from access token
export async function getUserInfo(accessToken: string) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();

  return {
    email: data.email!,
    name: data.name || data.email!.split('@')[0],
  };
}

// Get a valid access token for the assistant, refreshing if necessary
export async function getValidAccessToken(assistantId: string): Promise<string> {
  const assistant = await db.query.assistants.findFirst({
    where: eq(assistants.id, assistantId),
  });

  if (!assistant) {
    throw new Error('Assistant not found');
  }

  if (!assistant.googleRefreshToken) {
    throw new Error('Assistant has no refresh token - needs to re-authenticate');
  }

  // Check if token expires in less than 5 minutes
  const now = new Date();
  const expiresAt = assistant.googleTokenExpiresAt;
  const bufferMs = config.timing.tokenRefreshBufferMs;

  if (expiresAt && expiresAt.getTime() - now.getTime() > bufferMs) {
    // Token is still valid
    return assistant.googleAccessToken!;
  }

  // Token expired or expiring soon - refresh it
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: assistant.googleRefreshToken,
  });

  const { credentials } = await oauth2Client.refreshAccessToken();

  // Update tokens in database
  await db
    .update(assistants)
    .set({
      googleAccessToken: credentials.access_token!,
      googleTokenExpiresAt: new Date(credentials.expiry_date!),
      updatedAt: new Date(),
    })
    .where(eq(assistants.id, assistantId));

  return credentials.access_token!;
}

// Get an authenticated OAuth2 client for the assistant
export async function getAuthenticatedClient(assistantId: string) {
  const accessToken = await getValidAccessToken(assistantId);
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  return oauth2Client;
}

// Get the single assistant (Riva) - convenience function
export async function getAssistant() {
  const assistant = await db.query.assistants.findFirst();
  if (!assistant) {
    throw new Error('No assistant configured - please complete OAuth setup');
  }
  return assistant;
}

// Get authenticated client for the default assistant
export async function getDefaultAuthenticatedClient() {
  const assistant = await getAssistant();
  return getAuthenticatedClient(assistant.id);
}

// Store tokens for the assistant (after OAuth callback)
export async function storeAssistantTokens(
  email: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  },
  assistantInfo: { name?: string }
) {
  const existingAssistant = await db.query.assistants.findFirst({
    where: eq(assistants.email, email),
  });

  if (existingAssistant) {
    // Update existing assistant
    await db
      .update(assistants)
      .set({
        googleAccessToken: tokens.access_token || existingAssistant.googleAccessToken,
        googleRefreshToken: tokens.refresh_token || existingAssistant.googleRefreshToken,
        googleTokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : existingAssistant.googleTokenExpiresAt,
        name: assistantInfo.name || existingAssistant.name,
        updatedAt: new Date(),
      })
      .where(eq(assistants.id, existingAssistant.id));

    return existingAssistant.id;
  } else {
    // Create new assistant
    const [newAssistant] = await db
      .insert(assistants)
      .values({
        email,
        name: assistantInfo.name,
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token,
        googleTokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : null,
      })
      .returning({ id: assistants.id });

    return newAssistant.id;
  }
}
