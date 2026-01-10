import { NextResponse } from 'next/server';
import { requireAdminAuth, stopImpersonation, handleAdminAuthError } from '@/lib/auth/session';

export async function POST(): Promise<NextResponse> {
  try {
    await requireAdminAuth();
    await stopImpersonation();
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminAuthError(error);
  }
}
