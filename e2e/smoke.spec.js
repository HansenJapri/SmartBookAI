import { test, expect } from '@playwright/test'

// ============================================================
// E2E smoke — permukaan publik & guard keamanan rute.
// Tidak menyentuh backend (tanpa login sungguhan), jadi 100% repeatable.
// ============================================================

test.describe('Halaman publik', () => {
  test('Landing termuat dengan judul & tautan masuk', async ({ page }) => {
    await page.goto('/')
    // Judul utama hero harus ada.
    await expect(page.locator('h1').first()).toBeVisible()
    // Ada jalan menuju halaman masuk.
    await expect(page.locator('a[href="/masuk"]').first()).toBeVisible()
    // Judul dokumen menyebut brand.
    await expect(page).toHaveTitle(/SmartBook/i)
  })

  test('Halaman masuk menampilkan form kredensial', async ({ page }) => {
    await page.goto('/masuk')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /Masuk|Sign in/i })).toBeVisible()
  })
})

test.describe('Guard keamanan rute (isolasi akses)', () => {
  // Tanpa sesi login, seluruh rute /app WAJIB memantul ke /masuk.
  for (const path of ['/app', '/app/transaksi', '/app/laporan', '/app/pengguna']) {
    test(`akses ${path} tanpa login → dialihkan ke /masuk`, async ({ page }) => {
      await page.goto(path)
      await page.waitForURL('**/masuk', { timeout: 15_000 })
      expect(new URL(page.url()).pathname).toBe('/masuk')
    })
  }
})

test.describe('Tema terang/gelap', () => {
  test('tombol tema membalik data-theme & menyimpan preferensi', async ({ page }) => {
    // Tombol tema ada di nav Landing (di /masuk tidak ada).
    await page.goto('/')
    const before = await page.evaluate(() => document.documentElement.dataset.theme || 'light')
    await page.getByRole('button', { name: /Ganti ke mode (terang|gelap)/i }).first().click()
    const after = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(after).not.toBe(before)
    // Preferensi tersimpan agar bertahan saat reload.
    const stored = await page.evaluate(() => localStorage.getItem('bp-theme'))
    expect(stored).toBe(after)
  })
})
