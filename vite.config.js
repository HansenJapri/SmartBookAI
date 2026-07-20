import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Pisahkan pustaka vendor yang jarang berubah ke chunk sendiri agar
        // (a) chunk aplikasi utama lebih ramping, (b) vendor bisa di-cache
        // browser lintas rilis. Pustaka berat yang sudah lazy (recharts, xlsx,
        // jspdf) dibiarkan pada pemisahan otomatis Vite via dynamic import.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react-router') || id.includes('/react-dom/') ||
              id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react'
          if (id.includes('/@supabase/')) return 'vendor-supabase'
        },
      },
    },
  },
  // Vitest hanya menjalankan unit/integration test di src/.
  // Test E2E Playwright (folder e2e/) dijalankan terpisah via `npm run test:e2e`.
  test: {
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
})
