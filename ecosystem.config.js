module.exports = {
  apps: [
    {
      name: 'web',
      script: 'node_modules/.bin/next',
      args: 'start',
      exec_mode: 'fork',
      kill_timeout: 30000, // 30s for graceful shutdown
    },
    {
      name: 'worker',
      script: 'node_modules/.bin/tsx',
      args: 'src/lib/jobs/worker.ts',
      exec_mode: 'fork',
      restart_delay: 5000,
      kill_timeout: 30000, // 30s to allow current job to finish
      listen_timeout: 10000,
    },
  ],
};
