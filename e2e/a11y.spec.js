import { test, expect } from '@playwright/test'
import { periksaA11y } from './helpers/axe.js'

// ============================================================
// Aksesibilitas otomatis (WCAG 2.1 A & AA) — halaman PUBLIK.
// Menutup Q-04 untuk halaman yang tidak butuh sesi. Halaman di dalam /app
// ada di a11y.authenticated.spec.js karena butuh login.
// ============================================================

const HALAMAN_PUBLIK = [
  { nama: 'Landing', path: '/' },
  { nama: 'Login', path: '/masuk' },
  { nama: 'Daftar', path: '/daftar' },
]

test.describe('Aksesibilitas WCAG 2.1 AA — halaman publik', () => {
  for (const { nama, path } of HALAMAN_PUBLIK) {
    test(`${nama} (${path}) tanpa pelanggaran critical/serious`, async ({ page }) => {
      await page.goto(path)
      await page.locator('h1, main').first().waitFor({ state: 'visible', timeout: 15_000 })
      // Landing punya elemen beranimasi; tanpa jeda mengendap, JUMLAH elemen
      // yang dilaporkan axe berubah-ubah antar-run walau pelanggarannya sama.
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(500)

      const { ringkas } = await periksaA11y(page)
      expect(ringkas, `Pelanggaran axe di ${nama}:\n${JSON.stringify(ringkas, null, 2)}`).toEqual([])
    })
  }

})

// CATATAN tema gelap: seluruh halaman publik di atas TIDAK punya varian gelap.
// Landing memaksa data-theme="light" selama aktif (Landing.jsx, didokumentasikan
// di landing.css), begitu pula Login/Daftar/Ketentuan/Privasi lewat
// useForceLightTheme. Karena itu pemeriksaan kontras tema gelap ada di
// a11y.authenticated.spec.js — permukaan gelap yang nyata hanya di dalam /app.
