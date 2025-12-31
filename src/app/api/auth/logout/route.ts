import { NextResponse } from 'next/server';
import { clearUserSession } from '@/lib/auth/session';
import { config } from '@/lib/config';

export async function POST() {
  await clearUserSession();
  return NextResponse.redirect(new URL('/auth/user/login', config.appUrl));
}

export async function GET() {
  await clearUserSession();
  return NextResponse.redirect(new URL('/auth/user/login', config.appUrl));
}
