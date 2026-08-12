import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // prompt 모드는 새 SW를 활성화시키려면 virtual:pwa-register를 임포트해
      // onNeedRefresh/updateSW(true)를 호출하는 UI가 있어야 하는데, 이 앱에는 없다.
      // 그 결과 새 SW가 waiting 상태에 머물러 앱이 스스로 갱신되지 못하고,
      // SCHEMA_VERSION이 올라가 서버가 426으로 막아도 캐시된 구버전 셸이 계속 내려간다.
      // autoUpdate는 새 SW가 즉시 skipWaiting으로 인계받게 해 다음 로드에서 새 셸을 받게 한다.
      registerType: 'autoUpdate',
      manifest: {
        name: 'Daily',
        short_name: 'Daily',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#111827',
      },
    }),
  ],
  server: {
    // 개발 중에는 프론트(5173)와 API(3001)가 분리되어 있으므로 프록시로 같은 출처를 만든다.
    // 이렇게 해야 리프레시 쿠키(SameSite=Strict)가 개발 환경에서도 동작한다.
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
})
