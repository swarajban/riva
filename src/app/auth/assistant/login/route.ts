import { NextResponse } from 'next/server';
import { getAssistantSetupAuthUrl } from '@/lib/auth/google-oauth';
import { getCurrentUser } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { logger } from '@/lib/utils/logger';

export async function GET() {
  try {
    // Require user to be logged in first
    const user = await getCurrentUser();

    if (!user) {
      // Redirect to user login first
      return NextResponse.redirect(new URL('/auth/user/login?error=login_first', config.appUrl));
    }

    // Generate OAuth URL with user ID in state
    const authUrl = getAssistantSetupAuthUrl(user.id);

    return NextResponse.redirect(authUrl);
  } catch (error) {
    logger.error('Assistant login error', error);
    return NextResponse.redirect(new URL('/dashboard/settings?error=assistant_login_failed', config.appUrl));
  }
}
