import { test, expect } from '@playwright/test'

// ============================================================
// E2E Radar Harga (jalur ter-login, network STUBBED)
//   - Sesi login dari auth.setup.js (storageState) — konvensi repo.
//   - Panggilan Supabase/Edge di-stub via page.route() sehingga E2E
//     deterministik & bebas biaya API. Yang diuji: perilaku UI atas KONTRAK.
//   - Skip otomatis bila E2E_EMAIL/E2E_PASSWORD belum diset (agar CI hijau).
// ============================================================

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

const berasRow = {
  commodity_key: 'beras', commodity_label: 'Beras', variant_name: 'Beras', is_group: true,
  price: 14500, prev_price: 14000, price_date: '2026-07-25', unit: 'Rp/kg', province_id: 0,
  source_name: 'PIHPS Bank Indonesia', source_url: 'https://www.bi.go.id/hargapangan',
  run_date: '2026-07-26',
}
const berasSignal = {
  run_date: '2026-07-26', commodity_key: 'beras', commodity_label: 'Beras',
  direction: 'stabil', est_pct_min: 0, est_pct_max: 0, confidence: 'sedang',
  drivers: ['Stok Bulog aman menjelang HBKN (kontan.co.id)'],
  sources: [{ title: 'Stok Bulog aman', link: 'https://kontan.co.id/x', domain: 'kontan.co.id' }],
}

async function stubRadarNet(page, { prices = [berasRow], signals = [berasSignal] } = {}) {
  await page.route(/\/rest\/v1\/commodity_prices/, (r) => r.fulfill({ status: 200, json: prices }))
  await page.route(/\/rest\/v1\/macro_signals/,   (r) => r.fulfill({ status: 200, json: signals }))
  await page.route(/\/rest\/v1\/exchange_rates/,  (r) => r.fulfill({ status: 200, json: [] }))
  await page.route(/\/rest\/v1\/macro_config/,    (r) => r.fulfill({ status: 200, json: [] }))
  await page.route(/\/rest\/v1\/ingredients/,     (r) => r.fulfill({ status: 200, json: [] }))
}

test.describe('Radar Harga (ter-login, stubbed net)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL & E2E_PASSWORD untuk menjalankan E2E ter-login.')

  test('render harga PIHPS dengan lineage sumber (source grounding)', async ({ page }) => {
    await stubRadarNet(page)
    await page.goto('/app/radar')
    await expect(page.getByText(/Rp\s*14\.500/)).toBeVisible()
    await expect(page.getByRole('link', { name: /PIHPS Bank Indonesia/ })).toBeVisible()
  })

  test('provinsi tanpa data hari ini -> banner fallback nasional', async ({ page }) => {
    await stubRadarNet(page)
    await page.route(/\/functions\/v1\/harga-daerah/, (r) => r.fulfill({
      status: 200, json: { runDate: '2026-07-26', prices: [] },
    }))
    await page.goto('/app/radar')
    await page.getByLabel(/Provinsi:/).selectOption({ index: 1 })
    await expect(page.getByText(/belum tersedia hari ini/i)).toBeVisible()
  })

  test('Edge tumbang -> banner error, halaman tetap hidup (degradasi anggun)', async ({ page }) => {
    await stubRadarNet(page)
    await page.route(/\/functions\/v1\/makro-harian/, (r) => r.fulfill({ status: 502, json: { error: 'x' } }))
    await page.goto('/app/radar')
    await page.getByRole('button', { name: /Perbarui/ }).click()
    await expect(page.getByText(/Gagal memperbarui data makro/i)).toBeVisible()
    await expect(page.getByText(/Rp\s*14\.500/)).toBeVisible() // kartu tetap ada
  })

  test('anti race condition: ganti provinsi cepat -> hanya respons terakhir dipakai', async ({ page }) => {
    await stubRadarNet(page)
    await page.route(/\/functions\/v1\/harga-daerah/, async (r) => {
      const body = JSON.parse(r.request().postData() || '{}')
      const delay = body.province_id === 11 ? 800 : 50
      await new Promise((res) => setTimeout(res, delay))
      await r.fulfill({
        status: 200,
        json: {
          runDate: '2026-07-26',
          prices: [{ ...berasRow, price: body.province_id === 11 ? 15000 : 16000, province_id: body.province_id }],
        },
      })
    })
    await page.goto('/app/radar')
    const select = page.getByLabel(/Provinsi:/)
    await select.selectOption({ index: 11 })
    await select.selectOption({ index: 12 })
    await expect(page.getByText(/Rp\s*16\.000/)).toBeVisible()
    await expect(page.getByText(/Rp\s*15\.000/)).not.toBeVisible()
  })
})
