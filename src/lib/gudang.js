// ============================================================
// GUDANG FASE 1 — helper murni (tanpa jaringan) untuk
// Purchase Order & Stock Opname. Semua fungsi deterministik
// agar mudah diuji unit.
// ============================================================

// Nomor dokumen berurutan (PO-0001, SO-0007, ...).
// Memindai nomor yang sudah ada dan mengambil angka terbesar + 1,
// sehingga nomor tidak pernah terpakai dua kali walau ada dokumen terhapus.
export function nextDocNumber(prefix, existingNumbers = []) {
  let max = 0
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  for (const n of existingNumbers) {
    const m = re.exec(String(n || '').trim())
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

// Snapshot stok sistem menjadi baris item sesi opname.
export function buildOpnameItems(products) {
  return (products || []).map((p) => ({
    product_id: p.id,
    name: p.name,
    unit: p.unit || '',
    system_qty: Number(p.stock) || 0,
    counted_qty: null, // diisi hasil hitung fisik
  }))
}

// Selisih satu baris opname; null bila belum dihitung fisik.
export function opnameDiff(item) {
  const c = item?.counted_qty
  if (c === null || c === undefined || c === '') return null
  const d = Number(c) - (Number(item.system_qty) || 0)
  return Math.round(d * 10000) / 10000 // hindari residu floating point
}

// Ringkasan sesi opname untuk layar review sebelum posting.
export function opnameSummary(items) {
  const all = items || []
  let counted = 0
  const diffs = []
  for (const it of all) {
    const d = opnameDiff(it)
    if (d === null) continue
    counted++
    if (d !== 0) diffs.push({ ...it, diff: d })
  }
  return {
    total: all.length,
    counted,
    uncounted: all.length - counted,
    plus: diffs.filter((x) => x.diff > 0).length,
    minus: diffs.filter((x) => x.diff < 0).length,
    diffs,
  }
}

// Status PO -> label & kelas badge (satu sumber kebenaran untuk UI).
export const PO_STATUS = {
  draft: { label: 'Draf', cls: 'badge-indigo' },
  approved: { label: 'Disetujui', cls: 'badge-amber' },
  received: { label: 'Diterima', cls: 'badge-green' },
  cancelled: { label: 'Dibatalkan', cls: 'badge-red' },
}

// Status opname -> label & kelas badge.
export const SO_STATUS = {
  draft: { label: 'Draf', cls: 'badge-indigo' },
  posted: { label: 'Sudah Diposting', cls: 'badge-green' },
  cancelled: { label: 'Dibatalkan', cls: 'badge-red' },
}
