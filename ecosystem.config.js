module.exports = {
  apps: [
    {
      name: 'web',
      script: 'node_modules/.bin/next',
      args: 'start',
      exec_mode: 'fork',
    },
    {
      name: 'worker',
      script: 'node_modules/.bin/tsx',
      args: 'src/lib/jobs/worker.ts',
      exec_mode: 'fork',
      restart_delay: 5000,
    },
  ],
};
