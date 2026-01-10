import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth, startImpersonation, handleAdminAuthError } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdminAuth();

    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await startImpersonation(userId);

    return NextResponse.json({
      success: true,
      impersonating: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
      },
    });
  } catch (error) {
    return handleAdminAuthError(error);
  }
}
