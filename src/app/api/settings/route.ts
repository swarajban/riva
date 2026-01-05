import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/utils/logger';

// Get settings for the current user
export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get user with assistant relation
  const userWithAssistant = await db.query.users.findFirst({
    where: eq(users.id, user.id),
    with: { assistant: true },
  });

  return NextResponse.json({
    user,
    settings: user.settings,
    notificationPreference: user.notificationPreference || 'sms',
    telegramChatId: user.telegramChatId || '',
    assistant: userWithAssistant?.assistant
      ? {
          email: userWithAssistant.assistant.email,
          name: userWithAssistant.assistant.name,
        }
      : null,
  });
}

// Update settings for the current user
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { settings, notificationPreference, telegramChatId, phone } = body;

    // Validate settings
    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings' }, { status: 400 });
    }

    // Validate notification preference if provided
    if (notificationPreference && !['sms', 'telegram'].includes(notificationPreference)) {
      return NextResponse.json({ error: 'Invalid notification preference' }, { status: 400 });
    }

    // Update user settings
    await db
      .update(users)
      .set({
        settings,
        notificationPreference: notificationPreference || 'sms',
        telegramChatId: telegramChatId || null,
        phone: phone || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Settings update error', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
