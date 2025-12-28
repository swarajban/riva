/**
 * Seed script to create the initial user
 *
 * Usage:
 *   npx tsx scripts/seed-user.ts
 *
 * Before running:
 *   1. Set DATABASE_URL in .env.local
 *   2. Run migrations: npm run db:push
 *   3. Update the email and phone below
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { users } from '../src/lib/db/schema';

const EMAIL = 'your-email@example.com'; // Change this
const PHONE = '+1234567890'; // Change this to your phone number
const NAME = 'Your Name'; // Change this

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  console.log('Creating user...');

  try {
    const [user] = await db
      .insert(users)
      .values({
        email: EMAIL,
        name: NAME,
        phone: PHONE,
        settings: {
          defaultMeetingLengthMinutes: 30,
          zoomPersonalLink: null,
          workingHoursStart: '10:00',
          workingHoursEnd: '17:00',
          workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
          timezone: 'America/Los_Angeles',
          bufferMinutes: 15,
          lookaheadDays: 10,
          numOptionsToSuggest: 4,
          maxSlotsPerDay: 2,
          keywordRules: [],
        },
      })
      .returning();

    console.log('User created:', user.id);
    console.log('');
    console.log('Next steps:');
    console.log('1. Start the dev server: npm run dev');
    console.log('2. Visit http://localhost:3000/auth/login');
    console.log('3. Complete Google OAuth to link your account');
  } catch (error) {
    if ((error as Error).message.includes('duplicate key')) {
      console.log('User already exists');
    } else {
      throw error;
    }
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
