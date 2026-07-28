// ============================================================
// Helper murni untuk pipeline RAG harga komoditas (Radar Harga).
// Ekstraksi dari edge function `makro-harian` (verifikasi grounding,
// allowlist domain, parsing rupiah, seleksi kandidat harga).
//
// Sifat: pure functions — tak menyentuh jaringan / DB. Aman untuk unit test
// dan tidak mengubah perilaku pipeline server (edge tidak di-redeploy).
// ============================================================

// Daftar domain tepercaya (SATU titik kendali — sinkron dengan edge function).
// DIPANGKAS agresif ke inti paling berdampak: sumber resmi pemerintah + kantor
// berita + media ekonomi papan atas + acuan komoditas global. Menyempitkan
// allowlist menaikkan presisi grounding & memangkas noise.
export const TRUSTED_DOMAINS = [
  // Resmi pemerintah / lembaga (paling otoritatif untuk harga pangan)
  'bi.go.id', 'bps.go.id', 'kemendag.go.id', 'badanpangan.go.id',
  // Kantor berita & media ekonomi papan atas Indonesia
  'antaranews.com', 'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com',
  // Global (komoditas dunia: CPO, gandum, kakao, kurs)
  'reuters.com', 'tradingeconomics.com',
]

// Ambil hostname bersih (tanpa "www."). Return '' bila URL invalid.
export function domainOf(link) {
  try { return new URL(link).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

// Cek domain (atau subdomainnya) termasuk dalam allowlist.
export function isTrusted(domain) {
  const d = String(domain || '').toLowerCase()
  if (!d) return false
  return TRUSTED_DOMAINS.some((t) => d === t || d.endsWith('.' + t))
}

// Bing News RSS memberi link redirect (bing.com/news/apiclick.aspx?...&url=<asli>).
// Kembalikan URL akhir artikel; '' bila tak dapat direkonstruksi.
export function finalUrl(link) {
  try {
    const u = new URL(link)
    if (u.hostname.endsWith('bing.com')) {
      const real = u.searchParams.get('url')
      if (real) return decodeURIComponent(real)
      return ''
    }
    return link
  } catch { return '' }
}

// Verifikasi deterministik: harga (angka) benar-benar tertulis di teks dalam
// salah satu format lazim Indonesia (18.500 / 18500 / 18 ribu / 1,2 juta).
export function numberAppearsIn(text, price) {
  const s = ' ' + String(text || '').toLowerCase() + ' '
  const cands = new Set()
  cands.add(String(price))
  cands.add(price.toLocaleString('id-ID'))     // 18.500
  cands.add(price.toLocaleString('en-US'))     // 18,500
  if (price % 1000 === 0) {
    const rb = price / 1000
    for (const r of [`${rb} ribu`, `${rb}ribu`, `${rb} rb`, `${rb}rb`, `${rb}.000`, `${rb},000`]) cands.add(r)
    if (rb >= 1000 && rb % 100 === 0) {
      const jt = price / 1_000_000
      const jtStr = String(jt).replace('.', ',')
      for (const j of [`${jt} juta`, `${jtStr} juta`, `${jt}jt`, `${jtStr}jt`]) cands.add(j)
    }
  }
  if (price % 100 === 0 && price >= 1000) {
    const rbF = price / 1000
    if (!Number.isInteger(rbF)) {
      const rbStr = String(rbF).replace('.', ',')
      cands.add(`${rbStr} ribu`); cands.add(`${rbStr}rb`)
    }
  }
  for (const c of cands) if (s.includes(String(c).toLowerCase())) return true
  return false
}

// Gali sebutan "Rp <angka>" beserta kalimat sekitarnya dari teks. Dibatasi 8
// kandidat per teks (anti-bloat). Setiap kandidat menyertakan `pre` = 55
// karakter sebelum "Rp" — dipakai aturan "nama terdekat menang".
export function parseRupiahMentions(text) {
  const out = []
  const s = String(text || '')
  const re = /Rp\s?\.?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(ribu|rb|juta|jt)?/gi
  let m
  while ((m = re.exec(s)) && out.length < 8) {
    const numStr = m[1].trim()
    const suf = (m[2] || '').toLowerCase()
    let val = 0
    if (suf === 'juta' || suf === 'jt') val = Math.round(parseFloat(numStr.replace(/\./g, '').replace(',', '.')) * 1e6)
    else if (suf === 'ribu' || suf === 'rb') val = Math.round(parseFloat(numStr.replace(',', '.')) * 1000)
    else val = Math.round(Number(numStr.replace(/[.,]/g, '')))
    if (!Number.isFinite(val) || val <= 0) continue
    out.push({
      harga: val,
      kalimat: s.slice(Math.max(0, m.index - 90), m.index + 90).trim(),
      pre: s.slice(Math.max(0, m.index - 55), m.index).toLowerCase(),
    })
  }
  return out
}

// Pilih SATU kandidat harga terbaik dari sebuah teks berita untuk komoditas
// tertentu. Aturan grounding (identik dengan edge function):
//   - kalimat WAJIB menyebut nama komoditasnya (`kws` — kata kunci target);
//   - bila nama produk tetangga (`negs`) berada LEBIH DEKAT ke angka daripada
//     kata kunci target -> buang ("nearest name wins");
//   - skor = 2 (kata kunci tepat sebelum angka = strong) + 1 (satuan cocok);
//   - kandidat harus berada di rentang [min..max] harga masuk akal (`cfg`).
//
// Return: pick terbaik { harga, kalimat, strong, hasUnit, score } atau null.
export function pickCommodityPrice(newsItem, cfg, kws = [], hints = [], negs = []) {
  const texts = []
  if (newsItem?.title || newsItem?.snippet) {
    texts.push(`${newsItem.title || ''}. ${newsItem.snippet || ''}`)
  }
  if (Array.isArray(newsItem?.excerpts)) texts.push(...newsItem.excerpts)
  let best = null
  for (const t of texts) {
    for (const m of parseRupiahMentions(t)) {
      if (m.harga < cfg.min || m.harga > cfg.max) continue
      const kal = m.kalimat.toLowerCase()
      if (!kws.some((k) => kal.includes(k))) continue
      const preKw = Math.max(...kws.map((k) => m.pre.lastIndexOf(k)), -1)
      const preNeg = Math.max(...negs.map((n) => m.pre.lastIndexOf(n)), -1)
      if (preNeg > preKw) continue // nama produk tetangga menang -> buang
      const strong = preKw >= 0
      const hasUnit = hints.some((u) => kal.includes(u))
      const score = (strong ? 2 : 0) + (hasUnit ? 1 : 0)
      const cand = { harga: m.harga, kalimat: m.kalimat, strong, hasUnit, score }
      if (!best || cand.score > best.score) best = cand
    }
  }
  return best
}

// Strategi seleksi baris harga RAG untuk disimpan:
//   - confirmOk = true  -> pakai daftar `confirmed[key] === true` dari AI;
//   - confirmOk = false -> AI-down; hanya kandidat mekanis paling ketat
//     yang lolos (strong && hasUnit).
export function selectRagPrices(picks, { confirmOk, confirmed = {} } = {}) {
  return (picks || []).filter((p) => {
    if (confirmOk) return confirmed[p.key] === true
    return p.strong === true && p.hasUnit === true
  })
}
