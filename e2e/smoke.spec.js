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
  // CATATAN: test "tombol tema membalik data-theme" DIPINDAH ke
  // authenticated.spec.js. <ThemeToggle> hanya dirender di AppLayout (dalam
  // /app), tidak pernah di Landing — test lama mencarinya di sini dan menunggu
  // sampai timeout 30 detik. Komentarnya ("tombol tema ada di nav Landing")
  // sudah usang sejak tombol itu dipindahkan ke dalam aplikasi.

  // Halaman publik SENGAJA selalu terang: Landing memaksanya lewat efek di
  // Landing.jsx, Login/Daftar/Ketentuan/Privasi lewat useForceLightTheme.
  // Ini yang dikunci di sini supaya perubahan tak sengaja langsung ketahuan.
  for (const path of ['/', '/masuk', '/daftar']) {
    test(`${path} selalu tampil mode terang walau preferensi tersimpan gelap`, async ({ page }) => {
      await page.goto(path)
      await page.evaluate(() => localStorage.setItem('bp-theme', 'dark'))
      await page.reload()
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe('light')
    })
  }
})
