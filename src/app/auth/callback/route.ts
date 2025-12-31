import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeCodeForTokens,
  getUserInfo,
  storeAssistantTokens,
} from '@/lib/auth/google-oauth';
import { createSession } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { setupGmailWatch } from '@/lib/integrations/gmail/client';
import { scheduleGmailWatchRenewal } from '@/lib/jobs/scheduler';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error);
    return NextResponse.redirect(
      new URL('/auth/login?error=oauth_failed', config.appUrl)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/auth/login?error=no_code', config.appUrl)
    );
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.access_token) {
      throw new Error('No access token received');
    }

    // Get user info
    const userInfo = await getUserInfo(tokens.access_token);

    // Store tokens and get/create assistant
    const assistantId = await storeAssistantTokens(userInfo.email, tokens, userInfo);

    // Create session
    await createSession(assistantId);

    // Set up Gmail watch for push notifications
    try {
      await setupGmailWatch(assistantId);
      await scheduleGmailWatchRenewal(assistantId);
      console.log('Gmail watch setup complete for assistant:', assistantId);
    } catch (watchError) {
      // Non-fatal - user can still use the app, just won't get push notifications
      console.error('Failed to setup Gmail watch:', watchError);
    }

    // Redirect to success page
    return NextResponse.redirect(new URL('/auth/success', config.appUrl));
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(
      new URL('/auth/login?error=callback_failed', config.appUrl)
    );
  }
}
