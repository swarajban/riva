/**
 * Seed script to create a user
 *
 * Usage:
 *   npx tsx scripts/seed-user.ts
 *
 * Before running:
 *   1. Set DATABASE_URL in .env.local
 *   2. Run migrations: npm run db:push
 *   3. Update the email, phone, and calendarId below
 *
 * Note: This creates a USER record (Swaraj, Anurati, etc.), not the assistant.
 * The assistant (Riva) is created when you complete OAuth.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { users } from "../src/lib/db/schema";

const EMAIL = "swaraj@semprehealth.com"; // The user's email address
const PHONE = "+18472074454"; // The user's phone number for SMS
const NAME = "Swaraj"; // The user's name
const CALENDAR_ID = "swaraj@semprehealth.com"; // The user's Google Calendar ID (usually same as email)

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  console.log("Creating user...");

  try {
    const [user] = await db
      .insert(users)
      .values({
        email: EMAIL,
        name: NAME,
        phone: PHONE,
        calendarId: CALENDAR_ID,
        settings: {
          defaultMeetingLengthMinutes: 30,
          zoomPersonalLink: null,
          workingHoursStart: "10:00",
          workingHoursEnd: "17:00",
          workingDays: ["mon", "tue", "wed", "thu", "fri"],
          timezone: "America/Los_Angeles",
          bufferMinutes: 15,
          lookaheadDays: 10,
          numOptionsToSuggest: 4,
          maxSlotsPerDay: 2,
          keywordRules: [],
        },
      })
      .returning();

    console.log("User created:", user.id);
    console.log("Email:", user.email);
    console.log("Calendar ID:", user.calendarId);
    console.log("");
    console.log("Next steps:");
    console.log("1. Log in at http://localhost:3000/auth/user/login");
    console.log("2. Go to Settings and connect an assistant Google account");
    console.log("3. Send a test email with the assistant CC'd");
  } catch (error) {
    if ((error as Error).message.includes("duplicate key")) {
      console.log("User already exists");
    } else {
      throw error;
    }
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
