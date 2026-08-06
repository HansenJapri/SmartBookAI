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
    // jsdom dibutuhkan component test (React Testing Library). Test logika murni
    // di src/lib/ tetap jalan normal di bawah jsdom — ia superset dari Node
    // untuk keperluan mereka.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    // Batas bawaan 5 detik terlalu ketat untuk component test jsdom saat suite
    // berjalan paralel: yang gagal bukan test yang salah, melainkan worker yang
    // kebetulan tersendat. Itu menghasilkan merah acak yang membuat orang
    // berhenti mempercayai suite. Test yang lulus tidak jadi lebih lambat
    // karenanya — angka ini hanya batas atas.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Ambang §1.4 dokumen strategi mengukur `src/lib/**` — bukan seluruh repo.
      // Edge Function (Deno) diuji terpisah lewat `deno test`, halaman .jsx lewat
      // E2E; memasukkan keduanya di sini hanya mengencerkan angka jadi tak berarti.
      include: ['src/lib/**/*.js'],
      exclude: ['src/lib/__tests__/**'],
    },
  },
})
