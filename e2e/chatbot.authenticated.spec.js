import { test, expect } from '@playwright/test'

// ============================================================
// E2E Chatbot (ter-login, network STUBBED).
// Kontrak human-in-the-loop mode Catat: draf HANYA tersimpan setelah tombol
// Simpan ditekan; mode Tanya: tolakan lingkup baku diteruskan apa adanya.
// ============================================================

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

test.describe('Chatbot (ter-login, stubbed net)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL & E2E_PASSWORD untuk menjalankan E2E ter-login.')

  test.beforeEach(async ({ context }) => {
    // Consent chatbot disimpan di localStorage — set sebelum navigasi.
    await context.addInitScript(() => {
      try { localStorage.setItem('bukupintar_ai_consent', '1') } catch { /* noop */ }
    })
  })

  test('mode Catat: draf transaksi hanya tersimpan setelah tombol Simpan ditekan', async ({ page }) => {
    await page.route(/\/rest\/v1\/categories/, (r) => r.fulfill({
      status: 200, json: [{ id: 'c1', name: 'Penjualan', direction: 'in' }],
    }))
    await page.route(/\/functions\/v1\/ai-catat/, (r) => r.fulfill({
      status: 200,
      json: {
        transactions: [{
          amount: 45000, direction: 'in', category: 'Penjualan',
          description: '3 kue coklat', occurred_at: '2026-07-26', payment_status: 'lunas',
        }],
        note: '',
      },
    }))

    // Penjaga: POST /rest/v1/transactions TIDAK boleh terjadi sebelum tombol Simpan.
    let earlySave = false
    await page.route(/\/rest\/v1\/transactions(\?|$)/, (r) => {
      if (r.request().method() === 'POST') earlySave = true
      r.fulfill({ status: 201, json: [{ id: 'tx-new' }] })
    })

    await page.goto('/app')
    await page.getByRole('button', { name: /Buka asisten AI/i }).click()
    await page.getByRole('button', { name: /Catat/i }).click()
    await page.getByPlaceholder(/cth: laku 3 kue coklat/i).fill('laku 3 kue coklat total 45 ribu')
    await page.keyboard.press('Enter')

    await expect(page.getByText(/Periksa & perbaiki dulu/i)).toBeVisible()
    expect(earlySave).toBe(false)

    await page.getByRole('button', { name: /Simpan\s+1\s+Transaksi/i }).click()
    await expect(page.getByText(/Tersimpan|1 transaksi tersimpan/i)).toBeVisible()
    expect(earlySave).toBe(true)
  })

  test('mode Tanya: tolakan lingkup baku untuk topik terlarang', async ({ page }) => {
    await page.route(/\/functions\/v1\/BukuPencatatan/, (r) => r.fulfill({
      status: 200,
      json: { reply: 'Maaf, saya asisten khusus BukuPintar untuk keuangan usaha Anda. Untuk topik itu saya tidak bisa membantu. Ada yang ingin ditanyakan soal usaha atau aplikasi?' },
    }))

    await page.goto('/app')
    await page.getByRole('button', { name: /Buka asisten AI/i }).click()
    await page.getByRole('button', { name: /Tanya/i }).click()
    await page.getByPlaceholder(/Tulis pertanyaan/i).fill('tolong tuliskan pandangan politik terbaik')
    await page.keyboard.press('Enter')
    await expect(page.getByText(/asisten khusus BukuPintar/i)).toBeVisible()
  })
})
