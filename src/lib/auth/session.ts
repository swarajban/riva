import { cookies } from 'next/headers';
import { config } from '../config';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

// Session cookie name
const USER_SESSION_COOKIE = 'riva_user_session';

// Session data type
export interface UserSession {
  userId: string;
}

// Simple base64 encoding with secret (not production-grade, but sufficient for MVP)
function encodeSession<T>(session: T): string {
  const payload = JSON.stringify(session);
  const signature = Buffer.from(
    `${payload}:${config.sessionSecret}`
  ).toString('base64');
  return Buffer.from(`${payload}|${signature}`).toString('base64');
}

function decodeSession<T>(encoded: string): T | null {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const [payload, signature] = decoded.split('|');

    // Verify signature
    const expectedSignature = Buffer.from(
      `${payload}:${config.sessionSecret}`
    ).toString('base64');

    if (signature !== expectedSignature) {
      return null;
    }

    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

// Create a session for a user
export async function createUserSession(userId: string): Promise<void> {
  const session: UserSession = { userId };
  const encoded = encodeSession(session);

  const cookieStore = await cookies();
  cookieStore.set(USER_SESSION_COOKIE, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
}

// Get the current user session
export async function getUserSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(USER_SESSION_COOKIE);

  if (!sessionCookie) {
    return null;
  }

  return decodeSession<UserSession>(sessionCookie.value);
}

// Get the current user from session
export async function getCurrentUser() {
  const session = await getUserSession();

  if (!session) {
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  return user || null;
}

// Clear the user session (logout)
export async function clearUserSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(USER_SESSION_COOKIE);
}

// Require user authentication - throws if not logged in
export async function requireUserAuth() {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return user;
}
