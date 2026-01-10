import { NextResponse } from 'next/server';
import { requireAdminAuth, handleAdminAuthError } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdminAuth();

    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
      })
      .from(users);

    return NextResponse.json({ users: allUsers });
  } catch (error) {
    return handleAdminAuthError(error);
  }
}
