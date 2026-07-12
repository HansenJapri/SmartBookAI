// ============================================================
// FASE 3 — helper murni RBAC (tanpa jaringan, mudah diuji).
// membership = baris staff_members milik user login (null = owner).
// ============================================================

// Modul yang bisa diberikan owner kepada staf.
export const MODULES = [
  { key: 'operasional', label: 'Operasional', desc: 'Papan tugas harian & jadwal produksi/layanan' },
  { key: 'transaksi', label: 'Transaksi & Keuangan', desc: 'Transaksi, import, struk, rekonsiliasi, piutang & utang' },
  { key: 'produk', label: 'Gudang & Produk', desc: 'Stok, Purchase Order, opname, HPP, pemasok' },
  { key: 'hr', label: 'HR & Karyawan', desc: 'Data karyawan, absensi & cuti, penggajian' },
  { key: 'analisis', label: 'Analisis & Laporan', desc: 'Radar harga, kebocoran, laporan, target' },
]

// Grup menu (sec) -> modul yang dibutuhkan. null = tidak dibatasi modul.
export const SECTION_MODULE = {
  ringkasan: null,
  operasional: 'operasional',
  transaksi: 'transaksi',
  produk: 'produk',
  hr: 'hr',
  analisis: 'analisis',
  lainnya: null,
}

// Item menu yang hanya untuk owner (staf tidak melihatnya sama sekali).
export const OWNER_ONLY_KEYS = ['pengaturan', 'pengguna', 'audit']

// Boleh mengakses modul tertentu? Owner (membership null) selalu boleh.
export function canModule(membership, mod) {
  if (!membership) return true
  return (membership.modules || []).includes(mod)
}

// Saring grup navigasi sesuai hak akses:
// - owner: semua tampil apa adanya
// - staf : hanya grup modul yang diizinkan; grup "lainnya" tanpa item owner-only;
//          grup kosong dibuang seluruhnya (menu tersembunyi total, bukan disabled).
export function filterNav(nav, membership) {
  if (!membership) return nav
  return nav
    .map((g) => {
      const need = SECTION_MODULE[g.sec]
      if (need && !canModule(membership, need)) return null
      const items = g.items.filter((i) => !OWNER_ONLY_KEYS.includes(i.key))
      return items.length ? { ...g, items } : null
    })
    .filter(Boolean)
}

// Label status keanggotaan -> badge UI.
export const STAFF_STATUS = {
  invited: { label: 'Diundang', cls: 'badge-amber' },
  active: { label: 'Aktif', cls: 'badge-green' },
  revoked: { label: 'Dicabut', cls: 'badge-red' },
}
