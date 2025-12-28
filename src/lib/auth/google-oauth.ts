import { google } from 'googleapis';
import { config } from '../config';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

// Create OAuth2 client
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

// Generate authorization URL for user to visit
export function getAuthUrl(state?: string): string {
  const oauth2Client = createOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [...config.google.scopes],
    prompt: 'consent', // Force to get refresh token
    state,
  });
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

// Get a valid access token for a user, refreshing if necessary
export async function getValidAccessToken(userId: string): Promise<string> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.googleRefreshToken) {
    throw new Error('User has no refresh token - needs to re-authenticate');
  }

  // Check if token expires in less than 5 minutes
  const now = new Date();
  const expiresAt = user.googleTokenExpiresAt;
  const bufferMs = config.timing.tokenRefreshBufferMs;

  if (expiresAt && expiresAt.getTime() - now.getTime() > bufferMs) {
    // Token is still valid
    return user.googleAccessToken!;
  }

  // Token expired or expiring soon - refresh it
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: user.googleRefreshToken,
  });

  const { credentials } = await oauth2Client.refreshAccessToken();

  // Update tokens in database
  await db
    .update(users)
    .set({
      googleAccessToken: credentials.access_token!,
      googleTokenExpiresAt: new Date(credentials.expiry_date!),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return credentials.access_token!;
}

// Get an authenticated OAuth2 client for a user
export async function getAuthenticatedClient(userId: string) {
  const accessToken = await getValidAccessToken(userId);
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  return oauth2Client;
}

// Store tokens for a user (after OAuth callback)
export async function storeUserTokens(
  email: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  },
  userInfo: { name?: string }
) {
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingUser) {
    // Update existing user
    await db
      .update(users)
      .set({
        googleAccessToken: tokens.access_token || existingUser.googleAccessToken,
        googleRefreshToken: tokens.refresh_token || existingUser.googleRefreshToken,
        googleTokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : existingUser.googleTokenExpiresAt,
        name: userInfo.name || existingUser.name,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingUser.id));

    return existingUser.id;
  } else {
    // Create new user
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        name: userInfo.name,
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token,
        googleTokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : null,
      })
      .returning({ id: users.id });

    return newUser.id;
  }
}
