/**
 * Run the background job worker
 *
 * Usage:
 *   npx tsx scripts/run-worker.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const { startWorker } = await import('../src/lib/jobs/worker');

  console.log('Starting background job worker...');
  await startWorker();

  // Keep the process running
  console.log('Worker is running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  console.error('Worker error:', error);
  process.exit(1);
});
