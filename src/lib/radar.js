// ============================================================
// Helper murni untuk fitur Radar Harga.
// Diekstrak dari logika inline di src/pages/Radar.jsx agar dapat diuji unit
// tanpa DOM/network. TIDAK menambah perilaku baru — hanya memindahkan
// aturan yang sudah ada ke fungsi yang dapat dipanggil test.
// ============================================================

// Zona waktu WIB (UTC+7). Kunci "hari data" berpindah pada 06.00 WIB —
// sebelum jam 6 pagi, data terbaru = tarikan hari kemarin.
const WIB_OFFSET_MS = 7 * 3600 * 1000

// Kunci hari data (YYYY-MM-DD) sesuai batas 06.00 WIB.
// Cerminan `expectedRunKey` di Radar.jsx dan `runKeyWIB` di edge makro-harian.
export function expectedRunKey(now = new Date()) {
  const shifted = new Date(now.getTime() + WIB_OFFSET_MS - 6 * 3600 * 1000)
  return shifted.toISOString().slice(0, 10)
}

// Freshness: apakah price_date masih dalam toleransi maxAgeDays (relatif WIB).
// Return { isFresh, ageDays }. price_date tidak valid / kosong -> stale.
export function priceFreshness({ priceDate, now = new Date(), maxAgeDays = 1 }) {
  if (!priceDate) return { isFresh: false, ageDays: Infinity }
  const t = Date.parse(priceDate + 'T00:00:00+07:00')
  if (!Number.isFinite(t)) return { isFresh: false, ageDays: Infinity }
  const ageDays = Math.floor((now.getTime() - t) / 86400000)
  return { isFresh: ageDays <= maxAgeDays, ageDays }
}

// Delta % harga vs prev_price. Return null bila tak ada pembanding sah —
// UI wajib tidak menampilkan persentase palsu ketika baseline tak ada.
export function priceDelta({ price, prevPrice }) {
  const p = Number(price)
  const pp = Number(prevPrice)
  if (!Number.isFinite(p) || !Number.isFinite(pp) || pp <= 0) return null
  return ((p - pp) / pp) * 100
}

// Batas atas headline per komoditas yang dikirim ke Gemini
// (cerminan `f.headlines.slice(0, 5)` di makro-harian).
export const MAX_HEADLINES_PER_COMMODITY = 5

// Builder input sinyal — memastikan payload ke LLM tidak membengkak.
// Input: array feed { key, label, headlines: [{ title, snippet, domain, link }] }
export function buildSignalInput(feeds) {
  return (feeds || []).map((f) => ({
    key: f.key,
    label: f.label,
    berita: (f.headlines || []).slice(0, MAX_HEADLINES_PER_COMMODITY).map((h) => ({
      judul: String(h.title || '').slice(0, 200),
      ringkasan: String(h.snippet || '').slice(0, 200),
      sumber: String(h.domain || ''),
    })),
  }))
}

// Normalisasi output sinyal dari LLM sesuai aturan keras `makro-harian`:
// clamp -30..+30, kelipatan 0.5, direction & confidence terbatas enum,
// drivers max 3 @ max 140 char.
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const half = (n) => Math.round(n * 2) / 2
export function normalizeSignal(s = {}) {
  let min = half(clamp(Number(s.est_pct_min) || 0, -30, 30))
  let max = half(clamp(Number(s.est_pct_max) || 0, -30, 30))
  if (min > max) { const t = min; min = max; max = t }
  return {
    direction: ['naik', 'turun', 'stabil'].includes(s.direction) ? s.direction : 'stabil',
    est_pct_min: min,
    est_pct_max: max,
    confidence: ['rendah', 'sedang', 'tinggi'].includes(s.confidence) ? s.confidence : 'rendah',
    drivers: Array.isArray(s.drivers) ? s.drivers.slice(0, 3).map((d) => String(d).slice(0, 140)) : [],
  }
}
