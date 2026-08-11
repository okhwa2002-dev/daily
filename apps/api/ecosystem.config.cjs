module.exports = {
  apps: [
    {
      name: 'daily-api',
      script: 'node_modules/.bin/tsx',
      args: 'src/main.ts',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
    },
  ],
}
