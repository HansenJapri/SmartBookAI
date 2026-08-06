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
  // Batas bawaan 30 detik terlalu mepet sejak suite berjalan di tiga engine:
  // test axe di Firefox terukur 21–26 detik saat mesin sibuk (axe disuntikkan
  // lalu menganalisis seluruh pohon DOM), sehingga sesekali merah tanpa ada
  // yang rusak. Ini batas atas — test yang lulus tidak jadi lebih lambat.
  timeout: 60_000,
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
      testIgnore: /(authenticated|mutation|performance)\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Test ter-login: memakai sesi hasil setup.
    {
      name: 'chromium-auth',
      testMatch: /(authenticated|mutation)\.spec\.js/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
    },
    // Mesin render kedua (Gecko) — menutup QA.md K-02 yang selama ini manual.
    {
      name: 'firefox',
      testIgnore: /(authenticated|mutation|performance)\.spec\.js/,
      use: { ...devices['Desktop Firefox'] },
    },
    // Viewport ponsel — menutup QA.md K-03. Sekaligus penjaga layout 360-412px
    // (overflow horizontal, target sentuh) yang tidak terlihat di desktop.
    {
      name: 'Mobile Chrome',
      testIgnore: /(authenticated|mutation|performance)\.spec\.js/,
      use: { ...devices['Pixel 5'] },
    },
    // Pengukuran performa DIPISAH dan WAJIB dijalankan sendirian:
    //   npm run test:perf
    //
    // Alasannya terukur: saat ikut suite paralel (3 engine berebut CPU),
    // LCP Landing terbaca 3.388 ms; dijalankan sendirian dengan satu worker,
    // angkanya 620 ms. Yang terukur di mode paralel adalah beban mesin, bukan
    // performa aplikasi — dan ambang Core Web Vitals jadi tidak berarti.
    {
      name: 'performance',
      testMatch: /performance\.spec\.js/,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
})
