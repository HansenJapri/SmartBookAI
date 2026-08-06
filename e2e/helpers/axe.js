import AxeBuilder from '@axe-core/playwright'

// Helper axe bersama untuk seluruh spec aksesibilitas.
// Sengaja BUKAN berkas *.spec.js: Playwright melarang satu berkas test
// mengimpor berkas test lain.
//
// Batas jujur (§1.2 dokumen strategi): axe menangkap sekitar sepertiga masalah
// aksesibilitas nyata. Suite hijau BUKAN berarti lulus WCAG — urutan fokus yang
// masuk akal, teks alternatif yang bermakna, dan label yang benar secara
// semantik tetap harus diuji manual.

export const TAGS = ['wcag2a', 'wcag2aa']

/**
 * Bekukan animasi & transisi sebelum axe berjalan.
 *
 * Tanpa ini, axe memotret elemen DI TENGAH fade-in: teks putih yang sedang
 * beropacity 0.6 terbaca sebagai "#f3f2fc di atas #a8afea, rasio 1,89" padahal
 * keadaan akhirnya putih di atas biru tua dan lolos jauh. Hasilnya laporan
 * berubah-ubah tiap run dan pelanggaran sungguhan tenggelam di antara derau.
 *
 * WCAG menilai keadaan yang MENGENDAP, jadi inilah yang diperiksa. Keterbacaan
 * selama animasi berlangsung adalah pertanyaan terpisah — dan itu ranah uji
 * manual, bukan axe.
 */
export async function bekukanAnimasi(page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`,
  })
  // Satu frame agar gaya baru benar-benar terpakai sebelum axe membaca warna.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
}

/**
 * Jalankan axe lalu ringkas pelanggarannya jadi bentuk yang bisa dibaca manusia
 * saat test gagal — daftar node axe mentah terlalu panjang untuk log CI.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ hanyaSerius?: boolean }} opsi
 */
export async function periksaA11y(page, { hanyaSerius = true } = {}) {
  await bekukanAnimasi(page)
  const hasil = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const relevan = hanyaSerius
    ? hasil.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
    : hasil.violations
  const ringkas = relevan.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    jumlahElemen: v.nodes.length,
    contoh: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }))
  return { hasil, relevan, ringkas }
}
