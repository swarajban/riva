module.exports = {
  apps: [
    {
      name: 'web',
      script: 'npm',
      args: 'start',
      instances: 1,
    },
    {
      name: 'worker',
      script: 'npx',
      args: 'tsx src/lib/jobs/worker.ts',
      instances: 1,
      restart_delay: 5000,
    },
  ],
};
