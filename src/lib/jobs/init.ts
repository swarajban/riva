import { startWorker } from './worker';

let initialized = false;

// Initialize job worker (called once on app startup)
export async function initializeJobWorker(): Promise<void> {
  if (initialized) {
    return;
  }

  // Only run worker in production or when explicitly enabled
  // In development, you might want to run it separately
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_JOB_WORKER === 'true') {
    try {
      await startWorker();
      initialized = true;
      console.log('Job worker initialized');
    } catch (error) {
      console.error('Failed to initialize job worker:', error);
    }
  }
}
