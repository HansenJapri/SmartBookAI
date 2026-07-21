import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ============================================================
// E2E alur MUTASI — satu-satunya test yang benar-benar menulis ke database.
//
// Karena itu ia dijaga berlapis:
//  1. Wajib opt-in eksplisit lewat E2E_ALLOW_MUTATION=1. Tanpa itu dilewati,
//     supaya suite tidak pernah menulis ke database secara tidak sengaja.
//  2. Setiap data uji diberi PENANDA UNIK per-run (E2E-<timestamp>-<acak>),
//     sehingga tidak mungkin bersinggungan dengan data usaha yang asli.
//  3. Test menghapus sendiri apa yang dibuatnya lewat antarmuka, dan ada
//     pembersih cadangan lewat API bila test gagal di tengah jalan.
//
// Jalankan:
//   E2E_EMAIL=... E2E_PASSWORD=... E2E_ALLOW_MUTATION=1 npm run test:e2e
// ============================================================

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
const ALLOWED = process.env.E2E_ALLOW_MUTATION === '1'

// Penanda unik: semua yang dibuat run ini bisa dikenali dan dibersihkan.
const MARKER = `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

function supabaseEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim()
    }
  } catch { /* boleh tidak ada bila ENV sudah lengkap */ }
  return env
}

// Pembersih cadangan: menghapus HANYA baris milik run ini (cocok penanda).
// Tidak pernah menghapus massal.
async function sweepLeftovers() {
  const env = supabaseEnv()
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) return { swept: 0 }
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (authErr) return { swept: 0, error: authErr.message }
  const { data, error } = await sb.from('transactions').delete().like('description', `${MARKER}%`).select('id')
  if (error) return { swept: 0, error: error.message }
  return { swept: (data || []).length }
}

test.describe('Alur mutasi: buat lalu hapus transaksi', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL & E2E_PASSWORD.')
  test.skip(!ALLOWED, 'Test menulis ke database — aktifkan dengan E2E_ALLOW_MUTATION=1.')

  // Jalankan berurutan: satu alur utuh, bukan test paralel yang saling adu data.
  test.describe.configure({ mode: 'serial' })

  test.afterAll(async () => {
    const res = await sweepLeftovers()
    if (res.swept > 0) console.warn(`[bersih-bersih] ${res.swept} sisa data uji dihapus lewat API.`)
    if (res.error) console.warn(`[bersih-bersih] gagal: ${res.error}`)
  })

  test('transaksi baru tersimpan, tampil di daftar, lalu terhapus', async ({ page }) => {
    const description = `${MARKER} penjualan uji`
    const amount = '12345'

    // Konfirmasi hapus memakai confirm() bawaan browser.
    page.on('dialog', (d) => d.accept())

    await page.goto('/app/transaksi')
    await page.locator('main#main-content').waitFor()

    // ---- BUAT ----
    await page.getByRole('button', { name: /\+ Tambah/i }).first().click()
    const dialog = page.locator('.modal[role="dialog"]')
    await expect(dialog).toBeVisible()

    await page.locator('#tx-description').fill(description)
    await page.locator('#tx-amount').fill(amount)
    // Tunggu katalog kategori BENAR-BENAR terisi. Sekadar menghitung <option>
    // tidak cukup: saat katalog kosong tetap ada satu opsi placeholder bernilai
    // kosong, dan menyimpan dengan kategori kosong akan ditolak.
    const kategori = page.locator('#tx-category')
    await expect.poll(async () => kategori.inputValue(), {
      message: 'katalog kategori tidak pernah terisi', timeout: 15_000,
    }).not.toBe('')

    await dialog.getByRole('button', { name: /^Simpan$/ }).click()

    // Dialog menutup sendiri bila simpan berhasil. Bila tidak, tampilkan pesan
    // galat aslinya supaya kegagalan bisa dibaca tanpa menebak-nebak.
    try {
      await expect(dialog).toHaveCount(0, { timeout: 20_000 })
    } catch {
      const galat = await dialog.locator('.alert-err').first().textContent().catch(() => null)
      throw new Error(`Dialog tidak tertutup setelah Simpan. Pesan galat: ${galat || '(tidak ada pesan)'}`)
    }

    // ---- VERIFIKASI TERSIMPAN ----
    // Saring lewat pencarian agar hanya baris milik run ini yang tersisa.
    await page.getByRole('textbox', { name: /Cari/i }).fill(MARKER)
    const row = page.locator('tbody tr', { hasText: MARKER })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('12.345')

    // ---- HAPUS ----
    await row.getByRole('button', { name: /Hapus/i }).click()
    await expect(page.locator('tbody tr', { hasText: MARKER })).toHaveCount(0)

    // ---- VERIFIKASI BENAR-BENAR HILANG (bukan sekadar hilang dari tampilan) ----
    await page.reload()
    await page.getByRole('textbox', { name: /Cari/i }).fill(MARKER)
    await expect(page.locator('tbody tr', { hasText: MARKER })).toHaveCount(0)
  })
})
