import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeAssistantCodeForTokens,
  getUserInfo,
  storeAssistantTokens,
  linkAssistantToUser,
} from '@/lib/auth/google-oauth';
import { config } from '@/lib/config';
import { setupGmailWatch } from '@/lib/integrations/gmail/client';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // This is the userId
  const error = searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error);
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=oauth_failed', config.appUrl)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=no_code', config.appUrl)
    );
  }

  if (!state) {
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=no_state', config.appUrl)
    );
  }

  const userId = state;

  try {
    // Verify the user exists
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      console.error('User not found:', userId);
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=user_not_found', config.appUrl)
      );
    }

    // Exchange code for tokens
    const tokens = await exchangeAssistantCodeForTokens(code);

    if (!tokens.access_token) {
      throw new Error('No access token received');
    }

    // Get assistant info (email, name from Google)
    const assistantInfo = await getUserInfo(tokens.access_token);

    // Make sure user isn't trying to use their own email as assistant
    if (assistantInfo.email.toLowerCase() === user.email.toLowerCase()) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=same_email', config.appUrl)
      );
    }

    // Store tokens and get/create assistant
    const assistantId = await storeAssistantTokens(
      assistantInfo.email,
      tokens,
      assistantInfo
    );

    // Link assistant to user
    await linkAssistantToUser(userId, assistantId);

    // Set up Gmail watch for push notifications
    try {
      await setupGmailWatch(assistantId);
      console.log('Gmail watch setup complete for assistant:', assistantId);
    } catch (watchError) {
      // Non-fatal - user can still use the app, just won't get push notifications
      console.error('Failed to setup Gmail watch:', watchError);
    }

    // Redirect to settings with success
    return NextResponse.redirect(
      new URL('/dashboard/settings?success=assistant_connected', config.appUrl)
    );
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=callback_failed', config.appUrl)
    );
  }
}
