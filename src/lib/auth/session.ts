import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { config } from '../config';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

const USER_SESSION_COOKIE = 'riva_user_session';

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 30, // 30 days
  path: '/',
};

export interface UserSession {
  userId: string;
  impersonatingUserId?: string;
}

// Simple base64 encoding with secret (not production-grade, but sufficient for MVP)
function encodeSession<T>(session: T): string {
  const payload = JSON.stringify(session);
  const signature = Buffer.from(`${payload}:${config.sessionSecret}`).toString('base64');
  return Buffer.from(`${payload}|${signature}`).toString('base64');
}

function decodeSession<T>(encoded: string): T | null {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const [payload, signature] = decoded.split('|');

    // Verify signature
    const expectedSignature = Buffer.from(`${payload}:${config.sessionSecret}`).toString('base64');

    if (signature !== expectedSignature) {
      return null;
    }

    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

async function setSessionCookie(session: UserSession): Promise<void> {
  const encoded = encodeSession(session);
  const cookieStore = await cookies();
  cookieStore.set(USER_SESSION_COOKIE, encoded, SESSION_COOKIE_OPTIONS);
}

export async function createUserSession(userId: string): Promise<void> {
  await setSessionCookie({ userId });
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

// Get the current user from session (returns impersonated user if impersonating)
export async function getCurrentUser() {
  const session = await getUserSession();

  if (!session) {
    return null;
  }

  // If impersonating, return the impersonated user
  const targetUserId = session.impersonatingUserId || session.userId;

  const user = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
  });

  return user || null;
}

// Get the actual logged-in user (ignores impersonation)
export async function getActualUser() {
  const session = await getUserSession();

  if (!session) {
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  return user || null;
}

export async function getImpersonationInfo() {
  const session = await getUserSession();
  if (!session) {
    return null;
  }

  const actualUser = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!actualUser || !session.impersonatingUserId) {
    return { actualUser, impersonatedUser: null, isImpersonating: false };
  }

  const impersonatedUser = await db.query.users.findFirst({
    where: eq(users.id, session.impersonatingUserId),
  });

  return { actualUser, impersonatedUser, isImpersonating: true };
}

async function requireSession(): Promise<UserSession> {
  const session = await getUserSession();
  if (!session) {
    throw new Error('No session');
  }
  return session;
}

export async function startImpersonation(targetUserId: string): Promise<void> {
  const session = await requireSession();
  await setSessionCookie({ userId: session.userId, impersonatingUserId: targetUserId });
}

export async function stopImpersonation(): Promise<void> {
  const session = await requireSession();
  await setSessionCookie({ userId: session.userId });
}

export async function requireAdminAuth() {
  const actualUser = await getActualUser();

  if (!actualUser) {
    throw new Error('Unauthorized');
  }

  if (!actualUser.isAdmin) {
    throw new Error('Forbidden: Admin access required');
  }

  return actualUser;
}

export function handleAdminAuthError(error: unknown): NextResponse {
  if (error instanceof Error) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
