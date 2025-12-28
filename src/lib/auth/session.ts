import { cookies } from 'next/headers';
import { config } from '../config';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

// Session cookie name
const SESSION_COOKIE = 'riva_session';

// Session data stored in cookie (simple approach for MVP)
export interface Session {
  userId: string;
}

// Simple base64 encoding with secret (not production-grade, but sufficient for MVP)
function encodeSession(session: Session): string {
  const payload = JSON.stringify(session);
  const signature = Buffer.from(
    `${payload}:${config.sessionSecret}`
  ).toString('base64');
  return Buffer.from(`${payload}|${signature}`).toString('base64');
}

function decodeSession(encoded: string): Session | null {
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

    return JSON.parse(payload) as Session;
  } catch {
    return null;
  }
}

// Create a session for a user
export async function createSession(userId: string): Promise<void> {
  const session: Session = { userId };
  const encoded = encodeSession(session);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
}

// Get the current session
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE);

  if (!sessionCookie) {
    return null;
  }

  return decodeSession(sessionCookie.value);
}

// Get the current user from session
export async function getCurrentUser() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  return user || null;
}

// Clear the session (logout)
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

// Require authentication - throws if not logged in
export async function requireAuth() {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return user;
}
