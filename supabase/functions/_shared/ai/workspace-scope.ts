// ============================================================
// Batas workspace + modul untuk lapisan AI.
//
// Dipakai bersama oleh Edge Function `ai` dan `ai-crud`. Keduanya dulu
// membaca tabel ber-user_id TANPA filter dan bersandar penuh pada RLS —
// pola yang sudah terbukti bocor di sisi klien (lihat catatan panjang di
// src/lib/api.js di atas wsSelect).
//
// Aturannya sama seperti di klien:
//   RLS = batas LUAR  (apa yang boleh dilihat sama sekali)
//   modul + owner = batas DALAM (apa yang harus dilihat SEKARANG)
// ============================================================

export const ALL_MODULES = ['dashboard', 'operasional', 'transaksi', 'produk', 'hr', 'analisis'] as const
export type ModuleKey = (typeof ALL_MODULES)[number]

export interface WorkspaceScope {
  owner: string
  modules: ModuleKey[]
  isOwner: boolean
  can: (m: ModuleKey) => boolean
}

/**
 * Menentukan workspace yang sah dibuka pemanggil beserta modulnya.
 *
 * `p_owner` datang dari klien, jadi TIDAK dipercaya begitu saja: resolve_owner()
 * di database yang memverifikasi keanggotaan aktif dan melempar bila tidak sah.
 * Klien yang mengarang owner_id milik orang lain berhenti di sini.
 */
export async function resolveScope(supabase: any, requestedOwner?: string | null): Promise<WorkspaceScope> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Sesi tidak valid. Silakan masuk kembali.')

  const owner = requestedOwner && requestedOwner !== user.id ? requestedOwner : user.id

  // Owner sendiri: tidak perlu bolak-balik ke database.
  if (owner === user.id) {
    const modules = [...ALL_MODULES]
    return { owner, modules, isOwner: true, can: () => true }
  }

  const { data, error } = await supabase.rpc('my_modules', { p_owner: owner })
  // resolve_owner() melempar insufficient_privilege bila keanggotaan tidak
  // aktif. GAGAL TERTUTUP: jangan diam-diam mundur ke workspace sendiri —
  // itu membuat jawaban AI memakai angka usaha yang berbeda dari yang
  // sedang ditampilkan di layar.
  if (error) throw new Error('Anda tidak punya akses aktif ke usaha tersebut.')

  const modules = (Array.isArray(data) ? data : []).filter(
    (m: string): m is ModuleKey => (ALL_MODULES as readonly string[]).includes(m),
  )
  return {
    owner,
    modules,
    isOwner: false,
    can: (m: ModuleKey) => modules.includes(m),
  }
}

/**
 * SELECT yang terikat workspace aktif.
 * Semua pembacaan tabel ber-user_id di Edge Function AI harus lewat sini.
 */
/**
 * Tabel yang memakai kolom `status` dengan arti aktif/batal.
 *
 * Kalau nanti ada tabel lain yang ikut memakai pembatalan (misalnya
 * purchase_orders), tambahkan namanya DI SINI — bukan dengan menyalin
 * `.eq('status','aktif')` ke pemanggil baru, yang akan mengulang persis
 * kelalaian yang aturan ini cegah.
 */
const TABEL_BERSTATUS_BATAL = new Set(['transactions'])

export function scopedSelect(
  supabase: any,
  scope: WorkspaceScope,
  table: string,
  columns = '*',
  // Diteruskan apa adanya ke .select(). Dipakai lapisan RAG dengan
  // { count: 'exact' } untuk mengetahui JUMLAH SEBENARNYA baris, bukan hanya
  // berapa yang terbawa oleh limit. Tanpa angka itu, daftar 50 produk dari 137
  // disajikan model seolah daftar lengkap — jawaban salah yang tidak bisa
  // dideteksi pengguna. Opsional, jadi pemanggil lama tidak berubah.
  opsi?: Record<string, unknown>,
) {
  const q = opsi ? supabase.from(table).select(columns, opsi) : supabase.from(table).select(columns)
  const terikat = q.eq('user_id', scope.owner)

  // Transaksi yang DIBATALKAN tidak pernah sampai ke model.
  //
  // Ini disaring di sini, bukan di tiap pemanggil, karena scopedSelect adalah
  // SATU-SATUNYA pintu baca lapisan AI. Satu retriever yang lupa menyaring
  // akan membuat model menjumlahkan nota batal sebagai pendapatan nyata, lalu
  // menyatakannya dengan percaya diri di narasi pembukuan — kesalahan yang
  // jauh lebih sulit ditangkap daripada angka salah di layar, karena ia sampai
  // ke pengguna dalam bentuk kalimat yang terdengar meyakinkan.
  //
  // Daftarnya sengaja eksplisit, bukan "setiap tabel yang punya kolom status".
  // Kolom `status` di tabel lain berarti hal yang sama sekali berbeda —
  // tasks (antre/dikerjakan/selesai), staff_members (active), error_logs
  // (baru/ditangani) — dan menyaringnya jadi 'aktif' akan mengosongkan
  // konteks AI tanpa satu pun error.
  if (TABEL_BERSTATUS_BATAL.has(table)) return terikat.eq('status', 'aktif')
  return terikat
}

/**
 * Kalimat yang disisipkan ke prompt saat sebagian modul tidak boleh dibaca.
 *
 * Tanpa ini model melihat ringkasan yang sebagian kosong dan menyimpulkan
 * "usaha Anda belum punya transaksi" — padahal datanya ada, hanya tidak boleh
 * dilihat pengguna ini. Membedakan "tidak ada data" dari "tidak boleh dilihat"
 * penting supaya staf tidak diberi tahu angka lewat jalan memutar, dan juga
 * tidak disesatkan.
 */
export function restrictionNote(scope: WorkspaceScope): string {
  if (scope.isOwner) return ''
  const missing = ALL_MODULES.filter((m) => !scope.can(m))
  if (!missing.length) return ''
  return [
    `BATAS HAK AKSES: pengguna ini adalah STAF dengan akses modul: ${scope.modules.join(', ') || '(tidak ada)'}.`,
    `Modul yang TIDAK boleh dia lihat: ${missing.join(', ')}.`,
    'Ringkasan di bawah SENGAJA tidak memuat data modul terlarang itu.',
    'Bila pengguna menanyakan angka dari modul terlarang, JANGAN mengarang dan JANGAN bilang datanya kosong.',
    'Jawab persis: "Maaf, data itu di luar hak akses Anda. Silakan minta ke pemilik usaha."',
  ].join('\n')
}
