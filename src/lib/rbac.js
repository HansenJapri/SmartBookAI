// ============================================================
// FASE 3 — helper murni RBAC (tanpa jaringan, mudah diuji).
// membership = baris staff_members milik user login (null = owner).
// ============================================================

// Modul yang bisa diberikan owner kepada staf.
export const MODULES = [
  // Dashboard kini modul tersendiri supaya owner bisa mencabutnya lepas dari
  // modul lain — mis. staf gudang yang boleh mengelola stok tapi tidak boleh
  // melihat ringkasan omzet & laba di halaman depan.
  { key: 'dashboard', label: 'Dashboard', desc: 'Ringkasan omzet, laba, dan performa usaha di halaman depan' },
  { key: 'operasional', label: 'Operasional', desc: 'Papan tugas harian & jadwal produksi/layanan' },
  { key: 'transaksi', label: 'Transaksi & Keuangan', desc: 'Transaksi, import, struk, rekonsiliasi, piutang & utang' },
  { key: 'produk', label: 'Gudang & Produk', desc: 'Stok, Purchase Order, opname, HPP, pemasok' },
  { key: 'hr', label: 'HR & Karyawan', desc: 'Data karyawan, absensi & cuti, KPI, penggajian' },
  { key: 'analisis', label: 'Analisis & Laporan', desc: 'Radar harga, kebocoran, laporan, target' },
]

// Grup menu (sec) -> modul yang dibutuhkan. null = tidak dibatasi modul.
export const SECTION_MODULE = {
  ringkasan: 'dashboard',
  operasional: 'operasional',
  transaksi: 'transaksi',
  produk: 'produk',
  hr: 'hr',
  analisis: 'analisis',
  lainnya: null,
}

// Item menu yang hanya untuk owner (staf tidak melihatnya sama sekali).
// Seluruh seksi "lainnya" owner-only: pengelolaan staf, audit log, pengaturan
// usaha, dan forum feedback semuanya berbicara atas nama pemilik usaha.
export const OWNER_ONLY_KEYS = ['pengaturan', 'pengguna', 'audit', 'feedback']

// Rute yang butuh status owner. Dipakai penjaga rute di App.jsx supaya menu
// yang disembunyikan tidak bisa dibuka lewat mengetik URL langsung.
export const OWNER_ONLY_PATHS = ['/app/pengguna', '/app/audit', '/app/pengaturan', '/app/feedback']

// Rute -> modul yang dibutuhkan. Tidak terdaftar = bebas modul (mis. dashboard).
export const PATH_MODULE = {
  '/app': 'dashboard',
  '/app/tugas': 'operasional',
  '/app/transaksi': 'transaksi',
  '/app/struk': 'transaksi',
  '/app/import': 'transaksi',
  '/app/rekonsiliasi': 'transaksi',
  '/app/piutang': 'transaksi',
  '/app/stok': 'produk',
  '/app/stok/histori': 'produk',
  '/app/po': 'produk',
  '/app/opname': 'produk',
  '/app/hpp': 'produk',
  '/app/supplier': 'produk',
  '/app/karyawan': 'hr',
  '/app/absensi': 'hr',
  '/app/kpi': 'hr',
  '/app/gaji': 'hr',
  '/app/radar': 'analisis',
  '/app/reveal': 'analisis',
  '/app/laporan': 'analisis',
}

// Apakah pengguna sedang bertindak sebagai OWNER dari workspace yang dibuka?
//
// PENTING: jangan pakai `membership === null` sebagai proksi "owner". Selama
// undangan belum diterima, keanggotaan belum aktif sehingga membership bernilai
// null — dan itu dulu membuat calon staf dianggap owner: seluruh menu terbuka
// dan halaman Pengguna & Akses menampilkan tabel pengelolaan staf. Status owner
// ditentukan oleh workspace mana yang sedang dibuka, bukan oleh ada/tidaknya
// baris keanggotaan.
export function isOwnerView(userId, selectedWorkspace) {
  if (!userId) return false
  return !selectedWorkspace || selectedWorkspace === userId
}

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

// Boleh membuka rute ini? Dipakai penjaga rute sebagai lapis kedua di atas
// penyaringan menu — menyembunyikan tautan saja tidak menghentikan siapa pun
// yang mengetik URL-nya langsung.
export function canPath(pathname, { isOwner, membership }) {
  if (isOwner) return true
  if (OWNER_ONLY_PATHS.includes(pathname)) return false
  const need = PATH_MODULE[pathname]
  if (!need) return true
  return canModule(membership, need)
}

// Halaman pertama yang BOLEH dibuka pengguna ini.
//
// Dibutuhkan sejak dashboard menjadi modul yang bisa dicabut: mengalihkan staf
// tanpa akses dashboard ke '/app' akan memantul ke '/app' lagi tanpa henti.
// Owner selalu '/app'. Staf diarahkan ke rute pertama yang modulnya dia punya;
// kalau tidak ada satu pun, '/app/pengaturan-akses-kosong' tidak dibuat — kita
// kembalikan null dan pemanggil menampilkan pesan "belum ada modul".
export function firstAllowedPath({ isOwner, membership }) {
  if (isOwner) return '/app'
  if (canPath('/app', { isOwner, membership })) return '/app'
  for (const [path, mod] of Object.entries(PATH_MODULE)) {
    if (path !== '/app' && canModule(membership, mod)) return path
  }
  return null
}

// Label status keanggotaan -> badge UI.
export const STAFF_STATUS = {
  invited: { label: 'Diundang', cls: 'badge-amber' },
  active: { label: 'Aktif', cls: 'badge-green' },
  revoked: { label: 'Dicabut', cls: 'badge-red' },
}
