import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
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
