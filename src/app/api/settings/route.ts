import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Get settings for the current user
export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    user,
    settings: user.settings,
    notificationPreference: user.notificationPreference || 'sms',
    telegramChatId: user.telegramChatId || '',
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
    console.error('Settings update error:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
