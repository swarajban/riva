import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/auth/session';
import { config } from '@/lib/config';

export async function POST() {
  await clearSession();
  return NextResponse.redirect(new URL('/auth/login', config.appUrl));
}

export async function GET() {
  await clearSession();
  return NextResponse.redirect(new URL('/auth/login', config.appUrl));
}
