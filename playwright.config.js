import { defineConfig, devices } from '@playwright/test'

// E2E dijalankan terhadap BUILD PRODUKSI (vite preview) agar setara dengan yang
// dilihat pengguna di Vercel. Server dinyalakan otomatis oleh Playwright.
// Skenario sengaja dipilih yang DETERMINISTIK & tanpa mutasi backend
// (render halaman, guard routing, render form, tema) sehingga bisa diulang
// kapan saja tanpa akun/koneksi khusus.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
})
