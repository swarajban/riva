import { NextRequest, NextResponse } from 'next/server';
import { exchangeUserCodeForTokens, getUserInfo } from '@/lib/auth/google-oauth';
import { createUserSession } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/utils/logger';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    logger.error('OAuth error', undefined, { error });
    return NextResponse.redirect(new URL('/auth/user/login?error=oauth_failed', config.appUrl));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/auth/user/login?error=no_code', config.appUrl));
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeUserCodeForTokens(code);

    if (!tokens.access_token) {
      throw new Error('No access token received');
    }

    // Get user info
    const userInfo = await getUserInfo(tokens.access_token);

    // Check if user exists in our database
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, userInfo.email),
    });

    let user = existingUser;

    if (!user) {
      // Auto-create new user
      logger.info('Creating new user', { email: userInfo.email });
      const [newUser] = await db
        .insert(users)
        .values({
          email: userInfo.email,
          name: userInfo.name,
          calendarId: userInfo.email, // Google Calendar ID is typically the email
        })
        .returning();
      user = newUser;
    }

    // Create session for the user
    await createUserSession(user.id);

    // Redirect to dashboard
    return NextResponse.redirect(new URL('/dashboard', config.appUrl));
  } catch (error) {
    logger.error('OAuth callback error', error);
    return NextResponse.redirect(new URL('/auth/user/login?error=callback_failed', config.appUrl));
  }
}
