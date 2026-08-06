// ============================================================
// Anggaran ukuran bundle awal (Q-05 / §1.6 STRATEGI-QA-SMARTBOOKAI.md).
//
// Yang diukur adalah berkas yang BENAR-BENAR diunduh saat halaman pertama
// dibuka — dibaca dari dist/index.html, bukan dijumlahkan dari seluruh isi
// dist/. Chunk yang lazy (recharts, xlsx, jspdf) tidak ikut dihitung karena
// memang tidak diunduh sampai fiturnya dibuka; menjumlahkan semuanya akan
// membuat angka ini terlihat buruk tanpa alasan dan lama-lama diabaikan.
//
// Ukuran dilaporkan setelah gzip: itu yang melintas kabel, dan itu yang
// menentukan waktu muat di jaringan seluler.
//
// Pakai:
//   npm run build && node scripts/cek-bundle.mjs
//   node scripts/cek-bundle.mjs --json     # untuk CI / arsip
// ============================================================
import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const DIST = 'dist'

// Ambang [TARGET] internal dari §1.6. Bukan benchmark industri —
// silakan sesuaikan, tapi tetapkan SEBELUM mengukur, bukan sesudah.
const ANGGARAN = {
  jsAwalGzip: 250 * 1024,   // seluruh JS yang diunduh saat muat pertama
  cssAwalGzip: 60 * 1024,
  totalAwalGzip: 300 * 1024,
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

/** Berkas yang dirujuk langsung oleh index.html = set muat pertama. */
function asetAwal() {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  const aset = new Set()

  // <script type="module" src="..."> — entry point
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) aset.add(m[1])
  // <link rel="modulepreload" href="..."> — dependensi statis entry
  for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) aset.add(m[1])
  // <link rel="stylesheet" href="..."> — CSS render-blocking
  for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) aset.add(m[1])

  // Hanya berkas lokal; font Google dsb. di luar kendali kita.
  return [...aset].filter((p) => p.startsWith('/'))
}

function ukur(path) {
  const fisik = join(DIST, path.replace(/^\//, ''))
  const isi = readFileSync(fisik)
  return {
    path,
    mentah: statSync(fisik).size,
    gzip: gzipSync(isi, { level: 9 }).length,
    jenis: path.endsWith('.css') ? 'css' : 'js',
  }
}

function main() {
  let berkas
  try {
    berkas = asetAwal().map(ukur)
  } catch (e) {
    console.error(`✗ Gagal membaca dist/. Jalankan "npm run build" dulu.\n  ${e.message}`)
    process.exit(2)
  }

  const js = berkas.filter((b) => b.jenis === 'js')
  const css = berkas.filter((b) => b.jenis === 'css')
  const jumlah = (arr, k) => arr.reduce((s, b) => s + b[k], 0)

  const total = {
    jsGzip: jumlah(js, 'gzip'),
    cssGzip: jumlah(css, 'gzip'),
    jsMentah: jumlah(js, 'mentah'),
    cssMentah: jumlah(css, 'mentah'),
  }
  total.semuaGzip = total.jsGzip + total.cssGzip

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ berkas, total, anggaran: ANGGARAN }, null, 2))
  } else {
    console.log('\n▶ Bundle yang diunduh saat MUAT PERTAMA (dari dist/index.html)\n')
    console.log('  Berkas                                  Mentah      Gzip')
    console.log('  ──────────────────────────────────────  ────────  ────────')
    for (const b of [...js, ...css].sort((a, b2) => b2.gzip - a.gzip)) {
      console.log(`  ${b.path.replace('/assets/', '').padEnd(38)}  ${kb(b.mentah).padStart(8)}  ${kb(b.gzip).padStart(8)}`)
    }
    console.log('  ──────────────────────────────────────  ────────  ────────')
    console.log(`  ${'JS total'.padEnd(38)}  ${kb(total.jsMentah).padStart(8)}  ${kb(total.jsGzip).padStart(8)}`)
    console.log(`  ${'CSS total'.padEnd(38)}  ${kb(total.cssMentah).padStart(8)}  ${kb(total.cssGzip).padStart(8)}`)
    console.log(`  ${'SEMUA'.padEnd(38)}  ${''.padStart(8)}  ${kb(total.semuaGzip).padStart(8)}`)
  }

  const periksa = [
    ['JS awal (gzip)', total.jsGzip, ANGGARAN.jsAwalGzip],
    ['CSS awal (gzip)', total.cssGzip, ANGGARAN.cssAwalGzip],
    ['Total awal (gzip)', total.semuaGzip, ANGGARAN.totalAwalGzip],
  ]

  console.log('\n  Anggaran')
  console.log('  ──────────────────────────────────────────────────────────')
  let lewat = false
  for (const [nama, nilai, batas] of periksa) {
    const ok = nilai <= batas
    if (!ok) lewat = true
    const sisa = batas - nilai
    console.log(
      `  ${ok ? '✓' : '✗'} ${nama.padEnd(20)} ${kb(nilai).padStart(9)} / ${kb(batas).padStart(9)}  `
      + (ok ? `(sisa ${kb(sisa)})` : `(LEBIH ${kb(-sisa)})`),
    )
  }

  // Penjaga terpisah: pustaka berat WAJIB tetap lazy. Kalau salah satunya
  // masuk set muat pertama, itu bukan sekadar anggaran terlampaui — ada
  // import statis yang tak sengaja ditambahkan dan menghapus manfaat
  // code-splitting yang sudah dirancang di vite.config.js.
  const BERAT = ['recharts', 'xlsx', 'jspdf', 'html2canvas', 'generateCategoricalChart']
  const bocor = berkas.filter((b) => BERAT.some((p) => b.path.toLowerCase().includes(p.toLowerCase())))
  if (bocor.length) {
    lewat = true
    console.log('\n  ✗ Pustaka berat ikut terunduh di awal (seharusnya lazy):')
    for (const b of bocor) console.log(`      ${b.path} (${kb(b.gzip)} gzip)`)
  } else {
    console.log('\n  ✓ Pustaka berat (recharts, xlsx, jspdf, html2canvas) tetap lazy')
  }

  console.log('')
  process.exit(lewat ? 1 : 0)
}

main()
