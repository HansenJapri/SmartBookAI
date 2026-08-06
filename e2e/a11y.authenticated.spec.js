import { test, expect } from '@playwright/test'
import { periksaA11y } from './helpers/axe.js'

// ============================================================
// Aksesibilitas otomatis (WCAG 2.1 A & AA) — halaman DI DALAM /app.
// Butuh sesi, jadi berjalan di project *-auth lewat storageState.
// Jaringan yang menyentuh AI di-stub: axe tidak butuh jawaban Gemini asli, dan
// memanggilnya akan membakar kuota 10/hari tanpa memberi informasi baru.
// ============================================================

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

const HALAMAN_APP = [
  { nama: 'Dashboard', path: '/app' },
  { nama: 'Transaksi', path: '/app/transaksi' },
  { nama: 'Stok', path: '/app/stok' },
  { nama: 'Laporan', path: '/app/laporan' },
]

test.describe('Aksesibilitas WCAG 2.1 AA — halaman ter-login', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL & E2E_PASSWORD untuk menjalankan E2E ter-login.')

  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript(() => {
      try { localStorage.setItem('bukupintar_ai_consent', '1') } catch { /* noop */ }
    })
    // Semua endpoint AI dimatikan — nol panggilan Gemini nyata selama E2E.
    await page.route(/\/functions\/v1\/(BukuPencatatan|ai-catat|ai-narasi|ai-stok-insight|ai-struk|ai-crud)/,
      (r) => r.fulfill({ status: 200, json: { reply: '', transactions: [], note: '' } }))
  })

  for (const { nama, path } of HALAMAN_APP) {
    test(`${nama} (${path}) tanpa pelanggaran critical/serious`, async ({ page }) => {
      await page.goto(path)
      await page.locator('main#main-content').waitFor({ state: 'visible', timeout: 20_000 })
      // Beri kesempatan data & skeleton selesai agar axe memeriksa layar akhir,
      // bukan placeholder yang memang belum punya label.
      await page.waitForLoadState('networkidle').catch(() => {})

      const { ringkas } = await periksaA11y(page)
      expect(ringkas, `Pelanggaran axe di ${nama}:\n${JSON.stringify(ringkas, null, 2)}`).toEqual([])
    })
  }

  // Satu-satunya permukaan bertema gelap yang nyata ada di dalam /app — halaman
  // publik semuanya dipaksa terang (lihat catatan di a11y.spec.js). Palet gelap
  // punya rasio kontras sendiri, jadi wajib diperiksa terpisah.
  test('Dashboard pada tema gelap tanpa pelanggaran kontras', async ({ page }) => {
    await page.goto('/app')
    await page.locator('main#main-content').waitFor({ state: 'visible', timeout: 20_000 })
    await page.evaluate(() => localStorage.setItem('bp-theme', 'dark'))
    await page.reload()
    await page.locator('main#main-content').waitFor({ state: 'visible', timeout: 20_000 })

    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark')

    const { ringkas } = await periksaA11y(page)
    expect(ringkas, `Pelanggaran axe (Dashboard tema gelap):\n${JSON.stringify(ringkas, null, 2)}`).toEqual([])
  })

  test('Chatbot (panel asisten AI terbuka) tanpa pelanggaran critical/serious', async ({ page }) => {
    await page.goto('/app')
    await page.locator('main#main-content').waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: /Buka asisten AI/i }).click()
    // Panel adalah dialog — tunggu sampai benar-benar tampil sebelum diperiksa.
    await page.getByPlaceholder(/Tulis pertanyaan|cth: laku 3 kue coklat/i).first()
      .waitFor({ state: 'visible', timeout: 15_000 })

    const { ringkas } = await periksaA11y(page)
    expect(ringkas, `Pelanggaran axe di Chatbot:\n${JSON.stringify(ringkas, null, 2)}`).toEqual([])
  })
})
