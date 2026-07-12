// ============================================================
// FASE 2 KEUANGAN — helper murni untuk Piutang & Utang.
// Semua angka dihitung deterministik (tanpa AI, tanpa jaringan).
//   Piutang = transaksi 'in'  berstatus 'belum' (uang akan masuk)
//   Utang   = transaksi 'out' berstatus 'belum' (uang akan keluar)
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000

// Umur tagihan dalam hari sejak tanggal transaksi (dibulatkan ke bawah).
export function daysOutstanding(tx, today = new Date()) {
  const t0 = new Date(tx.occurred_at)
  if (Number.isNaN(t0.getTime())) return 0
  return Math.max(0, Math.floor((today.getTime() - t0.getTime()) / DAY_MS))
}

// Lewat jatuh tempo? (hanya bila due_date diisi; dibandingkan per-tanggal, bukan jam)
export function isOverdue(tx, today = new Date()) {
  if (!tx.due_date) return false
  const due = new Date(`${tx.due_date}T23:59:59`)
  return today.getTime() > due.getTime()
}

// Bucket umur standar akuntansi kecil: <=30 / 31-60 / 61-90 / >90 hari.
export const AGING_BUCKETS = [
  { key: 'b30', label: '≤ 30 hari', min: 0, max: 30 },
  { key: 'b60', label: '31–60 hari', min: 31, max: 60 },
  { key: 'b90', label: '61–90 hari', min: 61, max: 90 },
  { key: 'b90p', label: '> 90 hari', min: 91, max: Infinity },
]

export function agingBucketKey(days) {
  const b = AGING_BUCKETS.find((x) => days >= x.min && days <= x.max)
  return (b || AGING_BUCKETS[AGING_BUCKETS.length - 1]).key
}

// Ringkasan satu daftar tagihan: total, per-bucket, dan yang lewat jatuh tempo.
export function buildAgingSummary(txs, today = new Date()) {
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, { count: 0, total: 0 }]))
  let total = 0
  let overdueCount = 0
  let overdueTotal = 0
  for (const tx of txs || []) {
    const amt = Number(tx.amount) || 0
    total += amt
    const b = buckets[agingBucketKey(daysOutstanding(tx, today))]
    b.count++
    b.total += amt
    if (isOverdue(tx, today)) { overdueCount++; overdueTotal += amt }
  }
  return { count: (txs || []).length, total, buckets, overdueCount, overdueTotal }
}

// Normalisasi nomor WhatsApp Indonesia -> format internasional 62xxxxxxxx.
// '0812-3456 789' -> '62812345689'-style; sudah '62...' dibiarkan; '8...' diberi '62'.
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('62')) return digits
  if (digits.startsWith('0')) return '62' + digits.slice(1)
  if (digits.startsWith('8')) return '62' + digits
  return digits
}

// Tautan pengingat pembayaran via WhatsApp (wa.me) dengan pesan sopan siap kirim.
// Mengembalikan '' bila kontak tidak ada/tak valid.
export function waReminderLink(tx, businessName = '', fmtRupiah = (n) => `Rp ${n}`) {
  const phone = normalizePhone(tx.customer_contact)
  if (!phone) return ''
  const nama = tx.customer_name ? ` ${tx.customer_name}` : ''
  const tempo = tx.due_date ? ` (jatuh tempo ${tx.due_date})` : ''
  const msg =
    `Halo${nama}, mengingatkan pembayaran untuk "${tx.description}" ` +
    `sebesar ${fmtRupiah(Number(tx.amount) || 0)}${tempo}. Terima kasih 🙏` +
    (businessName ? ` — ${businessName}` : '')
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
}
