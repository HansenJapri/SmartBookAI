import { test, expect } from '@playwright/test'

// ============================================================
// Core Web Vitals halaman publik (Q-05 & Q-06).
//
// ⚠️  BATAS KLAIM — baca sebelum memakai angkanya.
//     Diukur terhadap `vite preview` di localhost: tanpa latensi jaringan,
//     tanpa TLS handshake, tanpa jarak ke CDN, dan pada mesin pengembang yang
//     biasanya jauh lebih kencang daripada HP pengguna UMKM.
//
//     Angka di sini adalah BATAS BAWAH — kondisi terbaik yang mungkin.
//     Produksi PASTI lebih lambat. Gunanya bukan memvalidasi pengalaman nyata,
//     melainkan menangkap REGRESI: kalau LCP di localhost saja sudah mendekati
//     ambang, di Vercel lewat 4G sudah pasti gagal.
//
//     Pengukuran sebenarnya tetap butuh Lighthouse/RUM di lingkungan produksi
//     dengan throttling — itu belum ada dan tidak digantikan berkas ini.
//
// ⚠️  WAJIB DIJALANKAN SENDIRIAN:  npm run test:perf
//     Bukan anjuran. Saat berkas ini ikut suite paralel (3 engine berebut CPU),
//     LCP Landing terbaca 3.388 ms; dijalankan sendirian dengan satu worker,
//     angkanya 620 ms. Selisih 5x itu murni beban mesin. Karena itu berkas ini
//     punya project Playwright sendiri dan dikeluarkan dari project lain.
//
// LCP & CLS hanya tersedia di Chromium. Firefox belum mengimplementasikan
// entry type-nya, jadi di sana test ini dilewati dengan sengaja.
// ============================================================

// Ambang publik Core Web Vitals dari Google — satu-satunya angka di dokumen
// strategi yang BUKAN [TARGET] internal.
const AMBANG = {
  lcp: 2500,   // ms — "Good"
  cls: 0.1,    // skor — "Good"
  fcp: 1800,   // ms — "Good"
  muatPenuh: 3000, // ms — QA.md §2 "waktu muat awal < 3 detik"
}

/** Pasang pengamat SEBELUM navigasi; LCP/CLS terjadi saat halaman dimuat. */
async function pasangPengamat(page) {
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0 }
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__perf.lcp = e.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })

      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          // Pergeseran yang disebabkan interaksi pengguna tidak dihitung —
          // itu memang diharapkan, bukan layout yang meloncat sendiri.
          if (!e.hadRecentInput) window.__perf.cls += e.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
    } catch {
      window.__perf.takTerdukung = true
    }
  })
}

async function ukur(page, path) {
  await page.goto(path, { waitUntil: 'load' })
  // Beri jeda agar LCP final dan pergeseran layout menyusul sempat tercatat.
  await page.waitForTimeout(1200)

  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    return {
      lcp: Math.round(window.__perf?.lcp || 0),
      cls: Number((window.__perf?.cls || 0).toFixed(4)),
      fcp: Math.round(fcp?.startTime || 0),
      ttfb: Math.round(nav.responseStart || 0),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      muatPenuh: Math.round(nav.loadEventEnd || 0),
      takTerdukung: Boolean(window.__perf?.takTerdukung),
    }
  })
}

const HALAMAN = [
  { nama: 'Landing', path: '/' },
  { nama: 'Login', path: '/masuk' },
]

test.describe('Core Web Vitals — halaman publik', () => {
  test.skip(({ browserName }) => browserName !== 'chromium',
    'LCP & CLS hanya tersedia di Chromium.')

  for (const { nama, path } of HALAMAN) {
    test(`${nama} (${path}) memenuhi ambang Core Web Vitals`, async ({ page }) => {
      await pasangPengamat(page)
      const m = await ukur(page, path)

      // Selalu dicetak — angkanya berguna sebagai tren, bukan hanya lulus/gagal.
      console.log(`  [perf] ${nama}: LCP ${m.lcp}ms · CLS ${m.cls} · FCP ${m.fcp}ms `
        + `· TTFB ${m.ttfb}ms · load ${m.muatPenuh}ms`)

      expect(m.takTerdukung, 'PerformanceObserver tidak didukung').toBe(false)
      expect(m.lcp, `LCP ${nama}`).toBeGreaterThan(0)
      expect(m.lcp, `LCP ${nama} (ambang Good Core Web Vitals)`).toBeLessThan(AMBANG.lcp)
      expect(m.cls, `CLS ${nama} (ambang Good Core Web Vitals)`).toBeLessThan(AMBANG.cls)
      expect(m.fcp, `FCP ${nama}`).toBeLessThan(AMBANG.fcp)
      expect(m.muatPenuh, `Waktu muat penuh ${nama} (QA.md §2)`).toBeLessThan(AMBANG.muatPenuh)
    })
  }

  test('Landing tidak menggeser layout saat font & gambar menyusul', async ({ page }) => {
    // CLS paling sering lahir dari font yang datang belakangan lalu mendorong
    // teks, atau gambar tanpa dimensi tetap. Landing memuat font Google, jadi
    // justru halaman ini yang paling rawan.
    await pasangPengamat(page)
    const m = await ukur(page, '/')
    expect(m.cls, 'CLS Landing setelah font & gambar selesai').toBeLessThan(AMBANG.cls)
  })
})

test.describe('Ukuran halaman', () => {
  test('muat pertama tidak mengunduh bundle berlebihan', async ({ page }) => {
    // Penjaga kasar di sisi browser; angka pastinya diukur
    // `node scripts/cek-bundle.mjs` yang menghitung ukuran gzip sebenarnya.
    const terunduh = []
    page.on('response', (res) => {
      const u = res.url()
      if (u.includes('/assets/') && /\.(js|css)$/.test(u)) terunduh.push(u)
    })

    await page.goto('/', { waitUntil: 'load' })
    await page.waitForTimeout(800)

    const berat = terunduh.filter((u) =>
      /recharts|xlsx|jspdf|html2canvas|generateCategoricalChart/i.test(u))
    expect(berat, `Pustaka berat ikut diunduh di Landing:\n${berat.join('\n')}`).toEqual([])
  })
})
