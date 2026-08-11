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
      // 로그 파일은 앱이 LOG_DIR에 일자별로 직접 쓴다. PM2의 error_file/out_file을
      // 함께 켜면 형식이 다른 두 벌이 쌓여 어느 쪽을 봐야 할지 알 수 없게 된다.
    },
  ],
}
