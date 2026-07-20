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
    // Login sekali, sesinya dipakai ulang oleh proyek ter-login di bawah.
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    // Test publik: TANPA sesi (menguji guard rute saat belum masuk).
    {
      name: 'chromium',
      testIgnore: /authenticated\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Test ter-login: memakai sesi hasil setup.
    {
      name: 'chromium-auth',
      testMatch: /authenticated\.spec\.js/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
})
