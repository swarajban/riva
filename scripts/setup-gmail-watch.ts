/**
 * Set up Gmail push notifications for the assistant
 *
 * Usage:
 *   npx tsx scripts/setup-gmail-watch.ts
 */

// Load .env.local BEFORE any other imports
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Now import modules that depend on env vars
async function main() {
  // Dynamic imports to ensure env is loaded first
  const { setupGmailWatch } = await import('../src/lib/integrations/gmail/client');
  const { db } = await import('../src/lib/db');
  const { assistants } = await import('../src/lib/db/schema');

  console.log('Finding assistant...');

  const assistant = await db.query.assistants.findFirst();

  if (!assistant) {
    console.error('No assistant found. Please connect an assistant account in Settings first.');
    process.exit(1);
  }

  console.log('Assistant:', assistant.email);
  console.log('Setting up Gmail watch...');

  try {
    const result = await setupGmailWatch(assistant.id);
    console.log('Gmail watch setup successful!');
    console.log('History ID:', result.historyId);
    console.log('Expiration:', new Date(parseInt(result.expiration)).toISOString());
    console.log('\nGmail will now push notifications to your Pub/Sub topic.');
    console.log('Make sure your subscription is pointing to ngrok for local dev.');
  } catch (error) {
    console.error('Failed to setup Gmail watch:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
