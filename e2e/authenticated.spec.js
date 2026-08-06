import { test, expect } from '@playwright/test'

// ============================================================
// E2E jalur TER-LOGIN.
//
// Sengaja READ-ONLY: hanya masuk, membuka halaman, dan membuka dialog —
// tidak pernah menyimpan/mengubah data. Dengan begitu test bisa diulang
// berkali-kali tanpa mengotori data usaha yang nyata.
//
// Sesi diambil dari auth.setup.js (login sekali, dipakai ulang) — lihat
// playwright.config.js. Bila kredensial belum diset, blok ini dilewati
// supaya suite tetap hijau di mesin/CI tanpa akun uji:
//   E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e
// ============================================================

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

test.describe('Jalur ter-login (read-only)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL & E2E_PASSWORD untuk menjalankan test ter-login.')

  // Dipindah dari smoke.spec.js: <ThemeToggle> hanya dirender di AppLayout,
  // jadi tombolnya memang tidak pernah ada di halaman publik.
  test('tombol tema membalik data-theme & menyimpan preferensi', async ({ page }) => {
    await page.goto('/app')
    await expect(page.locator('main#main-content')).toBeVisible()

    const sebelum = await page.evaluate(() => document.documentElement.dataset.theme || 'light')
    await page.getByRole('button', { name: /Ganti ke mode (terang|gelap)/i }).first().click()

    const sesudah = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(sesudah).not.toBe(sebelum)
    // Preferensi tersimpan agar bertahan saat reload.
    expect(await page.evaluate(() => localStorage.getItem('bp-theme'))).toBe(sesudah)
  })

  test('sesi tersimpan valid dan kerangka aplikasi termuat', async ({ page }) => {
    await page.goto('/app')
    // Landmark konten utama harus ada (hasil perbaikan aksesibilitas).
    await expect(page.locator('main#main-content')).toBeVisible()
    // Navigasi utama tersedia.
    await expect(page.getByRole('link', { name: /Transaksi/i }).first()).toBeVisible()
  })

  test('skip-link memindahkan fokus ke konten utama', async ({ page }) => {
    await page.goto('/app')
    const link = page.locator('a.skip-link')
    await link.focus()
    // Saat difokus, skip-link harus tampil di layar (tidak lagi tersembunyi).
    const top = await link.evaluate((el) => {
      el.style.transition = 'none'
      return Math.round(el.getBoundingClientRect().top)
    })
    expect(top).toBeGreaterThanOrEqual(0)
    // Mengaktifkannya memindahkan fokus ke <main>.
    await link.press('Enter')
    const onMain = await page.evaluate(() => document.activeElement?.id === 'main-content')
    expect(onMain).toBe(true)
  })

  test('dialog transaksi: semantik, jebakan fokus, dan Escape', async ({ page }) => {
    await page.goto('/app/transaksi')
    const trigger = page.getByRole('button', { name: /\+ Tambah/i }).first()
    await trigger.click()

    const dialog = page.locator('.modal[role="dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    // Judul dialog benar-benar tertaut lewat aria-labelledby.
    const titled = await dialog.evaluate((d) => {
      const id = d.getAttribute('aria-labelledby')
      return Boolean(id && document.getElementById(id)?.textContent?.trim())
    })
    expect(titled).toBe(true)

    // Fokus awal berada DI DALAM dialog.
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)

    // Escape menutup dialog dan mengembalikan fokus ke tombol pemicu.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    const backOnTrigger = await page.evaluate(() => /Tambah/.test(document.activeElement?.textContent || ''))
    expect(backOnTrigger).toBe(true)
  })

  // Penjaga regresi untuk pekerjaan aksesibilitas: setiap kontrol formulir
  // wajib punya nama aksesibel, dan tidak boleh ada id ganda / label menggantung.
  const ROUTES = [
    '/app', '/app/transaksi', '/app/stok', '/app/po', '/app/karyawan',
    '/app/absensi', '/app/kpi', '/app/gaji', '/app/pengaturan', '/app/audit',
  ]
  for (const route of ROUTES) {
    test(`kontrol formulir punya nama aksesibel: ${route}`, async ({ page }) => {
      await page.goto(route)
      await page.locator('main#main-content').waitFor()
      // Tunggu data selesai dimuat: selama masih ada spinner, halaman belum
      // menampilkan formulirnya. Tanpa ini audit bisa lulus HAMPA — memeriksa
      // halaman kosong dan menyimpulkan "tidak ada masalah".
      await page.locator('.spinner').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(400)

      const report = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
        const duplicateIds = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))]
        const danglingFor = [...document.querySelectorAll('label[for]')]
          .filter((l) => !document.getElementById(l.htmlFor)).map((l) => l.htmlFor)
        const unnamed = [...document.querySelectorAll(
          'input:not([type=hidden]):not([type=file]), select, textarea')]
          .filter((el) => {
            if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false
            if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false
            if (el.closest('label')) return false
            return true
          }).map((el) => el.outerHTML.slice(0, 80))
        const checked = document.querySelectorAll(
          'input:not([type=hidden]), select, textarea, button').length
        return { duplicateIds, danglingFor, unnamed, checked }
      })

      // Jaga agar test tidak lulus HAMPA: bila halaman gagal merender apa pun,
      // audit di atas otomatis "bersih" dan menyembunyikan masalah.
      expect(report.checked, `${route} tidak merender kontrol apa pun`).toBeGreaterThan(0)
      expect(report.duplicateIds, 'id ganda').toEqual([])
      expect(report.danglingFor, 'label[for] tanpa kontrol').toEqual([])
      expect(report.unnamed, 'kontrol tanpa nama aksesibel').toEqual([])
    })
  }
})
