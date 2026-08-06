import { supabase } from './supabase'
import { MODULES } from './rbac'
import { normalizePhone } from './aging'

// RPC pengerasan undangan (migration_rbac_invite_hardening.sql) mungkin belum
// terpasang di database saat build klien ini dirilis. Semua pemanggilnya punya
// jalur mundur ke query tabel langsung, sehingga urutan deploy tidak penting.
// Deteksi ini HANYA untuk "fungsi belum ada" — error lain tetap dilempar.
function isMissingRpc(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === 'PGRST202' || code === '42883') return true
  return /could not find the function|does not exist/i.test(String(error.message || ''))
}

// ---------- RBAC: pemilik data efektif (workspace aktif) ----------
// ATURAN DASAR: setiap pengguna SELALU memiliki workspace-nya sendiri.
// Keanggotaan sebagai staf di usaha orang lain bersifat TAMBAHAN dan hanya
// aktif bila pengguna MEMILIHNYA sendiri lewat pengalih workspace.
//
// Ini memperbaiki bug lama: pengguna baru yang emailnya pernah diundang jadi
// staf langsung "diserap" ke workspace pengundang tanpa pemberitahuan, sehingga
// tidak pernah bisa punya usaha sendiri. Default sekarang selalu milik sendiri.
const WS_KEY = 'bp-active-workspace'

export function getSelectedWorkspace() {
  try { return localStorage.getItem(WS_KEY) || '' } catch { return '' }
}

export function setSelectedWorkspace(ownerId) {
  try {
    if (ownerId) localStorage.setItem(WS_KEY, ownerId)
    else localStorage.removeItem(WS_KEY)
  } catch { /* private mode */ }
  _ownerCache = null
}

let _ownerCache = null
export async function effectiveOwnerId() {
  if (_ownerCache) return _ownerCache
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const selected = getSelectedWorkspace()
  // Tanpa pilihan eksplisit -> workspace sendiri. Ini jalur default & teraman.
  if (!selected || selected === user.id) {
    _ownerCache = user.id
    return _ownerCache
  }

  // Ada pilihan: verifikasi dulu keanggotaannya masih sah (bisa dicabut owner).
  // Pakai limit(1) — BUKAN maybeSingle() — karena satu pengguna sah menjadi
  // staf di lebih dari satu workspace; maybeSingle() akan error pada 2+ baris.
  //
  // GAGAL TERTUTUP. Dulu baris ini berbunyi `data?.[0]?.owner_id || user.id`:
  // saat verifikasi gagal (akses dicabut, jaringan putus, RLS berubah), pemilik
  // efektif diam-diam berpindah ke workspace pengguna sendiri sementara UI masih
  // menampilkan workspace orang lain — sehingga tulisan mendarat di tempat yang
  // salah tanpa satu pun peringatan. Sekarang kesalahan dilempar dan pemilihan
  // workspace dibersihkan supaya pengguna kembali ke keadaan yang jelas.
  const { data, error } = await supabase
    .from('staff_members')
    .select('owner_id')
    .eq('member_id', user.id)
    .eq('status', 'active')
    .eq('owner_id', selected)
    .limit(1)
  if (error) throw error
  const verified = data?.[0]?.owner_id
  if (!verified) {
    setSelectedWorkspace('')
    throw new Error('Akses Anda ke usaha itu sudah tidak berlaku. Anda dikembalikan ke usaha sendiri.')
  }
  _ownerCache = verified
  return _ownerCache
}
// Reset cache saat sesi berubah. Optional-chaining penting: saat env Supabase
// belum diisi (mis. di Vercel tanpa env var), `supabase` bernilai null dan
// aplikasi harus tetap hidup untuk menampilkan halaman /setup — bukan blank.
supabase?.auth?.onAuthStateChange(() => { _ownerCache = null })

// ============================================================
// ISOLASI WORKSPACE — WAJIB DIPAKAI UNTUK SETIAP TABEL BER-user_id
//
// RLS di database berbunyi `auth.uid() = user_id OR has_access(user_id, modul)`.
// `has_access` TIDAK tahu workspace mana yang sedang dibuka klien, jadi begitu
// seseorang menjadi staf aktif di usaha lain, `select('*')` tanpa filter akan
// mengembalikan GABUNGAN baris miliknya sendiri dan baris usaha itu — di kedua
// tampilan workspace. Itulah yang membuat data usaha owner tampak "ter-copy"
// ke usaha staf. Hal yang sama berlaku untuk update/delete yang hanya
// memfilter `id`: baris workspace lain ikut bisa diubah/dihapus.
//
// Karena itu RLS diperlakukan sebagai batas luar (apa yang BOLEH dilihat),
// sementara helper di bawah menetapkan batas dalam (apa yang HARUS dilihat
// sekarang). Semua akses tabel per-workspace lewat sini — jangan panggil
// supabase.from(<tabel ber-user_id>) langsung.
// ============================================================

export async function wsOwner() {
  const ownerId = await effectiveOwnerId()
  if (!ownerId) throw new Error('Sesi tidak valid. Silakan masuk kembali.')
  return ownerId
}

// Ketiga helper ini SINKRON dan menerima owner sebagai argumen pertama —
// sengaja, bukan kebetulan. Builder PostgREST bersifat *thenable*, jadi kalau
// helper-nya `async` dan mengembalikan builder, `await helper(...)` akan ikut
// me-resolve builder itu dan menghasilkan `{data, error}` — bukan builder yang
// masih bisa di-chain `.order()`/`.eq()`. Pola pemakaiannya:
//     const owner = await wsOwner()
//     wsSelect(owner, 'transactions').order(...)

// SELECT terikat workspace aktif.
function wsSelect(owner, table, columns = '*', opts) {
  return supabase.from(table).select(columns, opts).eq('user_id', owner)
}
// UPDATE terikat workspace aktif — `id` saja tidak cukup.
// `opts` diteruskan ke PostgREST, mis. { count: 'exact' } bila pemanggil perlu
// tahu berapa baris yang benar-benar terkena (0 = target di luar workspace).
function wsUpdate(owner, table, patch, opts) {
  return supabase.from(table).update(patch, opts).eq('user_id', owner)
}
// DELETE terikat workspace aktif.
function wsDelete(owner, table) {
  return supabase.from(table).delete().eq('user_id', owner)
}

// ---------- TRANSAKSI ----------
// Plafon pengambilan transaksi ke klien. Untuk volume sangat tinggi, ringkasan
// akurat dihitung di server via RPC my_monthly_summary; UI menampilkan peringatan
// bila data yang dimuat terpotong oleh plafon ini.
export const TX_FETCH_LIMIT = 5000

export async function fetchTransactions({ limit = TX_FETCH_LIMIT } = {}) {
  const { data, error } = await wsSelect(await wsOwner(), 'transactions')
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// Jumlah total transaksi milik pengguna (untuk mendeteksi data terpotong).
export async function fetchTxCount() {
  const { count, error } = await wsSelect(await wsOwner(), 'transactions', 'id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

// Ringkasan per bulan dihitung di server (mencakup seluruh baris, tanpa plafon).
// p_owner dikirim eksplisit: versi lama fungsi ini memakai `auth.uid()`, sehingga
// staf yang membuka usaha owner justru melihat rekap angkanya sendiri.
export async function fetchMonthlySummary() {
  const p_owner = await wsOwner()
  let { data, error } = await supabase.rpc('my_monthly_summary', { p_owner })
  if (error && isMissingRpc(error)) ({ data, error } = await supabase.rpc('my_monthly_summary'))
  if (error) throw error
  return (data || []).map((r) => ({
    month: r.month, income: Number(r.income), expense: Number(r.expense),
    profit: Number(r.income) - Number(r.expense), count: Number(r.cnt),
  }))
}

export async function addTransaction(tx) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transactions')
    .insert({ ...tx, user_id: await wsOwner() })
    .select()
    .single()
  if (error) throw error
  track('transaction_added', { channel: tx.channel, direction: tx.direction })
  return data
}

export async function addTransactionsBulk(list) {
  const ownerId = await wsOwner()
  const payload = list.map((t) => ({ ...t, user_id: ownerId }))
  const { data, error } = await supabase.from('transactions').insert(payload).select()
  if (error) throw error
  track('import_completed', { count: payload.length })
  return data || []
}

export async function updateTransaction(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'transactions', patch)
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteTransaction(id) {
  const { error } = await wsDelete(await wsOwner(), 'transactions').eq('id', id)
  if (error) throw error
}

// ---------- ATURAN KATEGORI ----------
export async function fetchRules() {
  const { data, error } = await wsSelect(await wsOwner(), 'categorization_rules')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addRule(rule) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('categorization_rules').insert({ ...rule, user_id: await wsOwner() }).select().single()
  if (error) throw error
  return data
}

export async function deleteRule(id) {
  const { error } = await wsDelete(await wsOwner(), 'categorization_rules').eq('id', id)
  if (error) throw error
}

// ---------- KATEGORI (milik user) ----------
export async function fetchCategories() {
  const { data, error } = await wsSelect(await wsOwner(), 'categories').order('direction').order('name')
  if (error) throw error
  return data || []
}
export async function addCategory({ name, direction }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('categories').insert({ name: name.trim(), direction, user_id: await wsOwner() }).select().single()
  if (error) throw error
  return data
}
export async function updateCategory(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'categories', patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteCategory(id) {
  const { error } = await wsDelete(await wsOwner(), 'categories').eq('id', id)
  if (error) throw error
}

// ---------- CHANNEL (milik user) ----------
export async function fetchChannels() {
  const { data, error } = await wsSelect(await wsOwner(), 'channels').order('created_at')
  if (error) throw error
  return data || []
}
export async function addChannel({ value, label, icon }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('channels').insert({ value, label: label.trim(), icon: icon || '🏷️', user_id: await wsOwner() })
    .select().single()
  if (error) throw error
  return data
}
export async function updateChannel(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'channels', patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteChannel(id) {
  const { error } = await wsDelete(await wsOwner(), 'channels').eq('id', id)
  if (error) throw error
}

// Default yang di-seed saat pertama kali (semuanya bisa diedit/dihapus user)
const DEFAULT_CATS = {
  in: ['Penjualan', 'Penjualan QRIS', 'Penjualan Marketplace', 'Modal/Investasi', 'Pendapatan Lain'],
  out: ['Pembelian Stok', 'Biaya Admin & Transaksi', 'Operasional Listrik', 'Operasional Pulsa/Internet',
    'Sewa Tempat', 'Gaji Karyawan', 'Transportasi & Ongkir', 'Iklan & Promosi', 'Pajak', 'Pengeluaran Lain'],
}
const DEFAULT_CHANNELS = [
  { value: 'manual', label: 'Manual', icon: '✍️' },
  { value: 'qris', label: 'QRIS', icon: '📱' },
  { value: 'bank', label: 'Transfer Bank', icon: '🏦' },
  { value: 'wa', label: 'Notif WhatsApp', icon: '💬' },
  { value: 'marketplace', label: 'Marketplace', icon: '🏪' },
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'struk', label: 'Struk/Cash', icon: '🧾' },
  { value: 'asisten', label: 'Asisten AI', icon: '🎙️' },
]

// Isi default jika kosong (dipanggil sekali saat masuk app)
export async function ensureSeedData() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // Hitungan HARUS terikat workspace: tanpa filter, staf yang punya akses ke
  // usaha lain melihat hitungan gabungan dan seed default tidak pernah dibuat
  // untuk usahanya sendiri.
  const [{ count: catCount }, { count: chCount }] = await Promise.all([
    wsSelect(await wsOwner(), 'categories', 'id', { count: 'exact', head: true }),
    wsSelect(await wsOwner(), 'channels', 'id', { count: 'exact', head: true }),
  ])
  const ownerId = await wsOwner()
  if (catCount === 0) {
    const rows = [
      ...DEFAULT_CATS.in.map((name) => ({ name, direction: 'in', user_id: ownerId })),
      ...DEFAULT_CATS.out.map((name) => ({ name, direction: 'out', user_id: ownerId })),
    ]
    await supabase.from('categories').insert(rows)
  }
  if (chCount === 0) {
    await supabase.from('channels').insert(DEFAULT_CHANNELS.map((c) => ({ ...c, user_id: ownerId })))
  }
}

// ---------- STRUK (Supabase Storage) ----------
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']

export async function uploadReceipt(file) {
  // Batasi ukuran & jenis berkas (mencegah penyalahgunaan storage & unggahan berbahaya).
  if (file.size > RECEIPT_MAX_BYTES) throw new Error('Ukuran berkas maksimal 5 MB.')
  if (file.type && !RECEIPT_TYPES.includes(file.type)) {
    throw new Error('Hanya gambar (JPG, PNG, WebP) atau PDF yang diperbolehkan.')
  }
  const { data: { user } } = await supabase.auth.getUser()
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('receipts').upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || undefined,
  })
  if (error) throw error
  return path
}
export async function getReceiptUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

// ---------- PROFIL ----------
export async function fetchProfile() {
  // Staf membaca profil OWNER (nama usaha dipakai di sidebar & invoice).
  const ownerId = await wsOwner()
  if (!ownerId) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', ownerId).maybeSingle()
  if (error) throw error
  return data
}

export async function updateProfile(patch) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('profiles').update(patch).eq('id', user.id).select().single()
  if (error) throw error
  return data
}

// ---------- PERSETUJUAN (CONSENT) ----------
// Tidak ada fungsi pencatatan persetujuan dari dalam aplikasi. Persetujuan
// S&K + Kebijakan Privasi diminta SEKALI saat pembuatan akun (halaman Daftar)
// dan disalin trigger handle_new_user ke kolom persetujuan pada profil.
// RPC accept_terms() di database sengaja dibiarkan ada untuk keperluan
// perbaikan data manual, tetapi tidak lagi dipanggil oleh klien.

// ---------- HAK SUBJEK DATA (UU PDP): EKSPOR & HAPUS DATA ----------
// Mengumpulkan seluruh data milik pengguna untuk diunduh (portabilitas data).
export async function exportMyData() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Sesi tidak ditemukan.')
  const tables = ['transactions', 'categories', 'channels', 'categorization_rules',
    'products', 'suppliers', 'units', 'product_categories', 'feedback']
  const out = { exported_at: new Date().toISOString(), account: { id: user.id, email: user.email } }
  try {
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    out.profile = prof || null
  } catch { out.profile = null }
  // Ekspor SELALU dibatasi ke akun pemanggil. Tanpa filter ini, staf yang aktif
  // di usaha lain mengunduh data usaha itu ikut serta di dalam berkas ekspornya.
  for (const tbl of tables) {
    try {
      const { data } = await supabase.from(tbl).select('*').eq('user_id', user.id)
      out[tbl] = data || []
    } catch { out[tbl] = [] }
  }
  return out
}

// Menghapus SELURUH data milik pengguna (transaksi, produk, kategori, dll) secara
// permanen. RLS memastikan hanya baris milik pengguna sendiri yang terhapus.
export async function deleteMyData() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Sesi tidak ditemukan.')
  const tables = ['transactions', 'categorization_rules', 'products', 'suppliers',
    'units', 'product_categories', 'channels', 'categories', 'feedback', 'app_events']
  for (const tbl of tables) {
    try { await supabase.from(tbl).delete().eq('user_id', user.id) } catch { /* abaikan tabel yang tidak ada */ }
  }
  // Hapus berkas struk milik sendiri dari penyimpanan.
  try {
    const { data: files } = await supabase.storage.from('receipts').list(user.id, { limit: 1000 })
    if (files && files.length) {
      await supabase.storage.from('receipts').remove(files.map((f) => `${user.id}/${f.name}`))
    }
  } catch { /* abaikan */ }
  track('data_deleted')
}

// ---------- PELACAKAN PEMAKAIAN (untuk metrik admin) ----------
// "Fire-and-forget": tidak pernah melempar error agar tak mengganggu UX.
// Aman bila tabel app_events belum dimigrasi (error diabaikan diam-diam).
export async function track(type, meta = null) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('app_events').insert({ user_id: user.id, type, meta })
  } catch { /* abaikan */ }
}

// ---------- FORUM FEEDBACK ----------
// Mengambil semua postingan (forum) - hanya berhasil untuk user yang login.
export async function fetchFeedback({ limit = 200 } = {}) {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// Membuat postingan baru. author_name disalin dari profil agar nama tampil
// di forum tanpa membuka akses ke profil user lain.
export async function addFeedback({ rating, category, message, helped }) {
  const { data: { user } } = await supabase.auth.getUser()
  let authorName = ''
  try {
    const { data: prof } = await supabase
      .from('profiles').select('business_name, owner_name').eq('id', user.id).maybeSingle()
    authorName = prof?.business_name || prof?.owner_name || ''
  } catch { /* abaikan */ }
  const { data, error } = await supabase
    .from('feedback')
    .insert({
      user_id: user.id,
      author_name: authorName,
      rating: rating || null,
      category: category || 'saran',
      message: message.trim(),
      helped: typeof helped === 'boolean' ? helped : null,
    })
    .select().single()
  if (error) throw error
  track('feedback_submitted', { category, rating, helped })
  return data
}

// Menghapus postingan milik sendiri. Filter user_id eksplisit: forum ini dibaca
// semua pengguna, jadi `id` saja tidak boleh menjadi satu-satunya kunci hapus.
export async function deleteFeedback(id) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Harus masuk (login).')
  const { error } = await supabase
    .from('feedback').delete().eq('id', id).eq('user_id', user.id)
  if (error) throw error
}

// ---------- SUPPLIER (pemasok) ----------
export async function fetchSuppliers() {
  const { data, error } = await wsSelect(await wsOwner(), 'suppliers').order('name')
  if (error) throw error
  return data || []
}
export async function addSupplier(s) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('suppliers').insert({ ...s, user_id: await wsOwner() }).select().single()
  if (error) throw error
  return data
}
export async function updateSupplier(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'suppliers', patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteSupplier(id) {
  const { error } = await wsDelete(await wsOwner(), 'suppliers').eq('id', id)
  if (error) throw error
}

// ---------- PELANGGAN (CRM) ----------
// Nomor telepon SELALU disimpan ternormalisasi (62xxx) supaya pencarian dan
// unique index (user_id, phone) bekerja. Menyimpan apa adanya membuat
// "0812...", "+62812...", dan "812..." jadi tiga pelanggan berbeda.
export async function fetchCustomers() {
  const { data, error } = await wsSelect(await wsOwner(), 'customers').order('name')
  if (error) throw error
  return data || []
}
export async function addCustomer(c) {
  const row = { ...c, user_id: await wsOwner() }
  row.phone = normalizePhone(c?.phone) || null
  const { data, error } = await supabase.from('customers').insert(row).select().single()
  if (error) throw error
  return data
}
export async function updateCustomer(id, patch) {
  const row = { ...patch }
  if ('phone' in row) row.phone = normalizePhone(row.phone) || null
  const { data, error } = await wsUpdate(await wsOwner(), 'customers', row).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteCustomer(id) {
  const { error } = await wsDelete(await wsOwner(), 'customers').eq('id', id)
  if (error) throw error
}

/**
 * Cari-atau-buat pelanggan. Dipakai asisten AI dan (nanti) alur penjualan.
 *
 * Urutan pencocokan sengaja bertingkat dan BERHENTI meminta kepastian saat ragu:
 *   1. Ada telepon -> cocokkan nomor ternormalisasi (kunci paling dapat dipercaya).
 *   2. Tanpa telepon, nama cocok TEPAT SATU -> pakai baris itu.
 *   3. Tanpa telepon, nama cocok >1 -> kembalikan daftar kandidat, JANGAN menebak.
 *      Menebak "Budi" yang mana akan menempelkan penjualan ke riwayat orang yang
 *      salah — kesalahan yang baru ketahuan berbulan-bulan kemudian.
 *   4. Tidak ada yang cocok -> buat baru.
 *
 * @returns {Promise<{customer: object|null, created: boolean, candidates?: object[]}>}
 */
export async function resolveCustomer({ name, phone } = {}) {
  const nama = String(name || '').trim()
  const telp = normalizePhone(phone)
  if (!nama && !telp) return { customer: null, created: false }

  const owner = await wsOwner()

  if (telp) {
    const { data, error } = await wsSelect(owner, 'customers').eq('phone', telp).limit(1)
    if (error) throw error
    if (data?.length) return { customer: data[0], created: false }
    return { customer: await addCustomer({ name: nama || telp, phone: telp }), created: true }
  }

  const { data, error } = await wsSelect(owner, 'customers').ilike('name', nama)
  if (error) throw error
  if (data?.length === 1) return { customer: data[0], created: false }
  if (data?.length > 1) return { customer: null, created: false, candidates: data }

  return { customer: await addCustomer({ name: nama }), created: true }
}

// ---------- PRODUK / STOK ----------
export async function fetchProducts() {
  const { data, error } = await wsSelect(await wsOwner(), 'products').order('name')
  if (error) throw error
  return data || []
}
export async function addProduct(p) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('products').insert({ ...p, user_id: await wsOwner() }).select().single()
  if (error) throw error
  track('product_added')
  return data
}
export async function updateProduct(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'products', { ...patch, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteProduct(id) {
  const { error } = await wsDelete(await wsOwner(), 'products').eq('id', id)
  if (error) throw error
}

// Unggah foto produk ke bucket product-images. Path selalu diawali <user_id>/
// agar RLS di storage bisa membatasi akses per pemilik.
export async function uploadProductImage(file) {
  if (!file) throw new Error('Berkas foto belum dipilih.')
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
  if (!ALLOWED.includes(file.type)) throw new Error('Format foto harus JPG, PNG, atau WEBP.')
  if (file.size > 5 * 1024 * 1024) throw new Error('Ukuran foto maksimal 5 MB.')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Sesi tidak valid.')
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('product-images').upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type,
  })
  if (error) throw error
  const { data } = supabase.storage.from('product-images').getPublicUrl(path)
  return { path, publicUrl: data.publicUrl }
}

// Hapus foto produk dari bucket. Aman dipanggil dengan URL publik.
export async function deleteProductImage(urlOrPath) {
  if (!urlOrPath) return
  // Ambil path <user_id>/<file> dari URL publik.
  const marker = '/product-images/'
  const idx = urlOrPath.indexOf(marker)
  const path = idx >= 0 ? urlOrPath.slice(idx + marker.length) : urlOrPath
  await supabase.storage.from('product-images').remove([path]).catch(() => {})
}

// Simpan transaksi BARU + sesuaikan stok baris produknya dalam SATU transaksi
// database (RPC add_transaction_with_stock). Gagal di langkah mana pun =
// seluruh operasi dibatalkan otomatis — tidak ada transaksi tanpa stok
// atau stok tanpa transaksi. direction 'in' => stok berkurang; 'out' => bertambah.
// Dipanggil hanya untuk transaksi BARU (edit tidak menyentuh stok agar tidak dobel).
//
// p_owner WAJIB dikirim. Versi lama RPC ini memakai fungsi server
// `effective_owner()` yang berbunyi "owner_id keanggotaan aktif PERTAMA, kalau
// tidak ada baru auth.uid()" — tanpa tahu workspace mana yang dipilih klien.
// Akibatnya begitu seseorang menjadi staf aktif di usaha lain, SETIAP transaksi
// yang dia catat di usahanya SENDIRI justru tersimpan ke usaha itu.
export async function addTransactionWithStock(tx, lines = []) {
  const args = {
    p_tx: tx,
    p_lines: (lines || []).map((l) => ({ productId: l.productId, qty: l.qty })),
    p_owner: await wsOwner(),
  }
  let { data, error } = await supabase.rpc('add_transaction_with_stock', args)
  if (error && isMissingRpc(error)) {
    delete args.p_owner
    ;({ data, error } = await supabase.rpc('add_transaction_with_stock', args))
  }
  if (error) throw error
  track('transaction_added', { channel: tx.channel, direction: tx.direction })
  return { txn: data?.txn || null, changes: data?.changes || [] }
}

// ---------- PURCHASE ORDER (Gudang fase 1) ----------
// Aturan: satu PO = satu produk, sehingga penerimaan PO menghasilkan
// tepat satu transaksi pengeluaran (selaras aturan 1 transaksi = 1 produk).
export async function fetchPurchaseOrders() {
  const { data, error } = await wsSelect(await wsOwner(), 'purchase_orders')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addPurchaseOrder(po) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('purchase_orders').insert({ ...po, user_id: await wsOwner() }).select().single()
  if (error) throw error
  track('po_created')
  return data
}

export async function updatePurchaseOrder(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'purchase_orders', patch)
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deletePurchaseOrder(id) {
  const { error } = await wsDelete(await wsOwner(), 'purchase_orders').eq('id', id)
  if (error) throw error
}

// Menerima PO (status approved -> received) dalam SATU transaksi database
// (RPC receive_purchase_order): stok bertambah + opsional catat pengeluaran
// ('belum' = beli kredit -> UTANG di menu Piutang & Utang) + PO dikunci
// 'received'. Gagal di langkah mana pun = seluruhnya dibatalkan otomatis.
export async function receivePurchaseOrder(po, { createExpense = true, category = '', paymentStatus = 'lunas', dueDate = null } = {}) {
  const args = {
    p_po_id: po.id,
    p_create_expense: createExpense,
    p_category: category,
    p_payment_status: paymentStatus,
    p_due_date: paymentStatus === 'belum' && dueDate ? dueDate : null,
    p_owner: await wsOwner(),
  }
  let { data, error } = await supabase.rpc('receive_purchase_order', args)
  if (error && isMissingRpc(error)) {
    delete args.p_owner
    ;({ data, error } = await supabase.rpc('receive_purchase_order', args))
  }
  if (error) throw error
  track('po_received', { with_expense: Boolean(data?.txn) })
  return { po: data?.po, stock: data?.stock, txn: data?.txn || null }
}

// Sumber riwayat stok: PO yang disetujui/diterima + opname yang sudah diposting.
// Query ini tinggal di sini — bukan di dalam komponen halaman — supaya filter
// workspace tidak bisa terlewat. Sebelumnya halaman Riwayat Stok memanggil
// supabase.from(...) langsung tanpa filter dan ikut menampilkan PO & opname
// milik usaha lain.
export async function fetchStockHistorySources() {
  const owner = await wsOwner()
  const [po, op] = await Promise.all([
    wsSelect(owner, 'purchase_orders', 'id, po_number, product_id, qty, unit_price, status, received_at, created_at')
      .in('status', ['received', 'approved'])
      .order('received_at', { ascending: false, nullsFirst: false })
      .limit(500),
    wsSelect(owner, 'stock_opnames', 'id, opname_number, items, status, posted_at, created_at')
      .eq('status', 'posted')
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(200),
  ])
  if (po.error) throw po.error
  if (op.error) throw op.error
  return { purchaseOrders: po.data || [], opnames: op.data || [] }
}

// ---------- STOCK OPNAME (Gudang fase 1) ----------
export async function fetchOpnames() {
  const { data, error } = await wsSelect(await wsOwner(), 'stock_opnames')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addOpname(payload) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('stock_opnames').insert({ ...payload, user_id: await wsOwner() }).select().single()
  if (error) throw error
  track('opname_created')
  return data
}

export async function updateOpname(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'stock_opnames', patch)
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteOpname(id) {
  const { error } = await wsDelete(await wsOwner(), 'stock_opnames').eq('id', id)
  if (error) throw error
}

// Posting opname dalam SATU transaksi database (RPC post_stock_opname):
// stok tiap produk DISET sama dengan hasil hitung fisik (hitung fisik =
// kebenaran; baris tanpa hasil hitung dilewati) + sesi dikunci 'posted'.
// Gagal di langkah mana pun = seluruhnya dibatalkan otomatis.
export async function postOpname(opname) {
  const args = {
    p_opname_id: opname.id,
    p_items: opname.items || [],
    p_owner: await wsOwner(),
  }
  let { data, error } = await supabase.rpc('post_stock_opname', args)
  if (error && isMissingRpc(error)) {
    delete args.p_owner
    ;({ data, error } = await supabase.rpc('post_stock_opname', args))
  }
  if (error) throw error
  const changes = data?.changes || []
  track('opname_posted', { changes: changes.length })
  return { opname: data?.opname, changes }
}

// ---------- RBAC: PENGGUNA & HAK AKSES (fase 3) ----------

// Penjaga tunggal untuk seluruh CRUD data pengguna: hanya boleh dijalankan
// oleh pemilik workspace YANG SEDANG DIBUKA.
//
// Tanpa ini, fungsi-fungsi di bawah memakai auth.uid() sebagai owner_id dan
// mengabaikan workspace aktif sepenuhnya. Akibatnya staf yang sedang membuka
// usaha orang lain lalu memanggil addStaff()/deleteStaff() — lewat konsol,
// tombol yang bocor, atau bug routing — tidak ditolak: perintahnya BERHASIL
// tapi mendarat di workspace-nya sendiri. RLS `owner_id = auth.uid()` tidak
// menangkapnya karena orang itu memang pemilik usahanya sendiri. Diam-diam
// menulis ke workspace yang salah lebih buruk daripada gagal terang-terangan.
async function assertOwnerView() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Harus masuk (login).')
  const selected = getSelectedWorkspace()
  if (selected && selected !== user.id) {
    throw new Error('Hanya pemilik usaha yang boleh mengelola pengguna. Kembali ke usaha Anda sendiri untuk mengubah data ini.')
  }
  return user
}

// Daftar staf DI WORKSPACE SENDIRI. Filter owner_id wajib eksplisit di sini:
// mengandalkan RLS saja pernah membuat baris undangan milik workspace orang
// lain (yang terbaca karena email penerima cocok) muncul di tabel pengelolaan
// staf si penerima, lengkap dengan tombol Cabut/Ubah/Hapus.
export async function fetchStaff() {
  const user = await assertOwnerView()
  const { data, error } = await supabase
    .from('staff_members').select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Kirim email undangan lewat Edge Function `invite-staff`. Sengaja
// best-effort: undangan sudah sah begitu barisnya tersimpan, dan sebelum ini
// tidak ada email sama sekali — staf hanya tahu kalau kebetulan login. Jadi
// kegagalan kirim tidak boleh menggagalkan pengundangan.
async function notifyInvite(inviteId) {
  if (!inviteId) return
  try { await supabase.functions.invoke('invite-staff', { body: { invite_id: inviteId } }) }
  catch { /* email opsional; undangan tetap muncul di aplikasi staf */ }
}

const MODULE_KEYS = MODULES.map((m) => m.key)
const STAFF_ROLES = ['staf']
const STAFF_STATUSES = ['invited', 'active', 'revoked']

// Hanya menerima kunci modul yang dikenal — mencegah modul karangan tersimpan
// ke database dan lolos pemeriksaan has_access() di kemudian hari.
function sanitizeModules(modules) {
  const clean = [...new Set((modules || []).filter((m) => MODULE_KEYS.includes(m)))]
  if (clean.length === 0) throw new Error('Pilih minimal satu modul akses yang sah.')
  return clean
}

// Nama pengguna ditulis owner, jadi diperlakukan sebagai teks bebas: rapikan
// spasi dan batasi panjang supaya tabel tidak rusak. Nama kosong sah — tabel
// jatuh kembali ke bagian lokal email (lihat staffDisplayName di rbac.js).
export const STAFF_NAME_MAX = 60
function sanitizeStaffName(name) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length > STAFF_NAME_MAX) {
    throw new Error(`Nama pengguna maksimal ${STAFF_NAME_MAX} karakter.`)
  }
  return clean
}

export async function addStaff(email, modules, role = 'staf', name = '') {
  const user = await assertOwnerView()
  const clean = email.trim().toLowerCase()
  // Mengundang diri sendiri menghasilkan baris rancu (owner sekaligus staf);
  // database juga menolaknya, ini sekadar pesan yang lebih jelas.
  if (clean === String(user.email || '').toLowerCase()) {
    throw new Error('Tidak bisa mengundang email Anda sendiri sebagai staf.')
  }
  const { data, error } = await supabase
    .from('staff_members')
    .insert({
      owner_id: user.id,
      email: clean,
      name: sanitizeStaffName(name),
      modules: sanitizeModules(modules),
      // Peran dibatasi ke daftar putih di klien DAN oleh CHECK di database —
      // 'owner' tidak boleh bisa ditulis lewat jalur ini dengan cara apa pun.
      role: STAFF_ROLES.includes(role) ? role : 'staf',
    })
    .select().single()
  if (error) throw error
  track('staff_invited')
  // Email undangan bersifat best-effort: undangannya sudah sah tanpa email.
  notifyInvite(data?.id).catch(() => {})
  return data
}

// Owner-only. Dua lapis pertahanan: `.eq('owner_id', ...)` di klien plus policy
// `sm_owner_all` di database. Patch di-whitelist supaya tombol yang bocor atau
// pemanggil yang salah tidak bisa menulis owner_id / member_id / email.
export async function updateStaff(id, patch) {
  const user = await assertOwnerView()
  const safe = {}
  if (patch.modules !== undefined) safe.modules = sanitizeModules(patch.modules)
  if (patch.name !== undefined) safe.name = sanitizeStaffName(patch.name)
  if (patch.status !== undefined) {
    if (!STAFF_STATUSES.includes(patch.status)) throw new Error('Status tidak dikenal.')
    safe.status = patch.status
  }
  if (patch.declined_at !== undefined) safe.declined_at = patch.declined_at
  if (Object.keys(safe).length === 0) throw new Error('Tidak ada perubahan yang sah.')
  const { data, error } = await supabase
    .from('staff_members').update(safe)
    .eq('id', id).eq('owner_id', user.id)
    .select().single()
  if (error) throw error
  return data
}

export async function deleteStaff(id) {
  const user = await assertOwnerView()
  const { error } = await supabase
    .from('staff_members').delete().eq('id', id).eq('owner_id', user.id)
  if (error) throw error
}

// Mengundang ulang staf yang menolak undangan sebelumnya.
export async function reinviteStaff(id) {
  const row = await updateStaff(id, { status: 'invited', declined_at: null })
  notifyInvite(id).catch(() => {})
  return row
}

// SEMUA keanggotaan staf saya yang aktif (bisa lebih dari satu workspace).
// Sengaja mengembalikan array: satu pengguna sah menjadi staf di banyak usaha.
// RPC my_workspaces() ikut membawa nama usaha, supaya pengalih workspace bisa
// menyebut "Warung Bu Sari" alih-alih "usaha orang lain".
export async function fetchMyMemberships() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase.rpc('my_workspaces')
  if (!error) return data || []
  if (!isMissingRpc(error)) throw error
  const { data: rows } = await supabase
    .from('staff_members').select('*')
    .eq('member_id', user.id).eq('status', 'active')
  return rows || []
}

// Keanggotaan untuk workspace yang SEDANG dilihat.
// null = sedang melihat workspace sendiri (akses penuh sebagai owner).
export async function fetchMyMembership() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const selected = getSelectedWorkspace()
  if (!selected || selected === user.id) return null
  const list = await fetchMyMemberships()
  return list.find((m) => m.owner_id === selected) || null
}

// Undangan yang MENUNGGU persetujuan (belum diklaim).
// Ditampilkan sebagai tawaran; pengguna yang memutuskan menerima atau tidak.
// Lewat RPC my_pending_invitations(): hanya kolom aman yang dipaparkan (id,
// pengundang, nama usaha, modul yang ditawarkan) — bukan select('*') pada
// tabel, yang dulu membocorkan baris workspace orang lain ke halaman staf.
export async function fetchPendingInvitations() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return []
  const { data, error } = await supabase.rpc('my_pending_invitations')
  if (!error) return data || []
  if (!isMissingRpc(error)) throw error
  // Jalur mundur pra-migrasi. Penyaringan email PERSIS di klien tetap ada
  // sebagai pertahanan berlapis (bukan pola LIKE).
  const { data: rows } = await supabase
    .from('staff_members').select('id, owner_id, email, modules, created_at')
    .is('member_id', null).eq('status', 'invited')
  const mine = String(user.email).toLowerCase()
  return (rows || []).filter((r) => String(r.email || '').toLowerCase() === mine)
}

// Menerima undangan SECARA EKSPLISIT. Tidak lagi dipanggil otomatis saat login,
// supaya akun baru tidak pernah "diserap" ke workspace orang lain tanpa sadar.
// RPC accept_invitation() hanya menulis member_id + status: `modules` dan `role`
// tidak bisa disentuh penerima undangan (dulu bisa, lewat policy sm_member_claim).
export async function acceptInvitation(id) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Harus masuk (login).')
  const { data, error } = await supabase.rpc('accept_invitation', { p_invite_id: id })
  if (!error) {
    _ownerCache = null
    return data?.[0] || null
  }
  if (!isMissingRpc(error)) throw error
  const { data: rows, error: e2 } = await supabase
    .from('staff_members')
    .update({ member_id: user.id, status: 'active' })
    .eq('id', id)
    .is('member_id', null)
    .eq('status', 'invited')
    .select()
  if (e2) throw e2
  _ownerCache = null
  return rows?.[0] || null
}

// Menolak undangan. Dicatat di SERVER (declined_at), bukan localStorage:
// penolakan lokal dulu membuat undangan hilang selamanya dari browser itu tanpa
// satu pun cara memunculkannya kembali, dan owner tidak tahu apa-apa.
// Owner bisa mengundang ulang lewat reinviteStaff().
export async function declineInvitation(id) {
  const { error } = await supabase.rpc('decline_invitation', { p_invite_id: id })
  if (error && !isMissingRpc(error)) throw error
}

// ---------- AUDIT LOG (baca-saja; ditulis trigger database) ----------
// audit_logs memakai kolom owner_id (bukan user_id), jadi filternya eksplisit.
export async function fetchAuditLogs({ table = '', action = '', limit = 200 } = {}) {
  // Owner di-resolve LEBIH DULU, sebelum builder dibuat: `await` di tengah
  // rantai membuat urutan panggilan jaringan sulit ditelusuri.
  const owner = await wsOwner()
  let q = supabase.from('audit_logs').select('*')
    .eq('owner_id', owner)
    .order('created_at', { ascending: false }).limit(limit)
  if (table) q = q.eq('table_name', table)
  if (action) q = q.eq('action', action)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// ---------- OPERASIONAL: PAPAN TUGAS (fase 5) ----------
export async function fetchTasks() {
  const { data, error } = await wsSelect(await wsOwner(), 'tasks').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
export async function addTask(t) {
  const { data, error } = await supabase
    .from('tasks').insert({ ...t, user_id: await wsOwner() }).select().single()
  if (error) throw error
  track('task_added')
  return data
}
export async function updateTask(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'tasks', patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteTask(id) {
  const { error } = await wsDelete(await wsOwner(), 'tasks').eq('id', id)
  if (error) throw error
}

// ---------- HR: KARYAWAN / ABSENSI / PENGGAJIAN (fase 4) ----------
export async function fetchEmployees() {
  const { data, error } = await wsSelect(await wsOwner(), 'employees').order('name')
  if (error) throw error
  return data || []
}
export async function addEmployee(e) {
  const { data, error } = await supabase
    .from('employees').insert({ ...e, user_id: await wsOwner() }).select().single()
  if (error) throw error
  track('employee_added')
  return data
}
export async function updateEmployee(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'employees', patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteEmployee(id) {
  const { error } = await wsDelete(await wsOwner(), 'employees').eq('id', id)
  if (error) throw error
}

// Absensi satu tanggal (semua karyawan).
export async function fetchAttendanceByDate(date) {
  const { data, error } = await wsSelect(await wsOwner(), 'attendance').eq('date', date)
  if (error) throw error
  return data || []
}
// Absensi rentang tanggal (untuk rekap & hitung gaji harian).
export async function fetchAttendanceRange(from, to) {
  const { data, error } = await wsSelect(await wsOwner(), 'attendance').gte('date', from).lte('date', to)
  if (error) throw error
  return data || []
}
// Set status absensi karyawan pada tanggal tertentu (upsert: sekali klik ganti status).
export async function setAttendance(employeeId, date, status, note) {
  const row = { user_id: await wsOwner(), employee_id: employeeId, date, status }
  if (note !== undefined) row.note = note || null
  const { data, error } = await supabase
    .from('attendance')
    .upsert(row, { onConflict: 'employee_id,date' })
    .select().single()
  if (error) throw error
  return data
}
// Kosongkan absensi (salah input): hapus baris karyawan+tanggal tsb.
export async function deleteAttendance(employeeId, date) {
  const { error } = await wsDelete(await wsOwner(), 'attendance')
    .eq('employee_id', employeeId).eq('date', date)
  if (error) throw error
}

// ---------- ATURAN BONUS/POTONGAN PER STATUS ABSENSI ----------
export async function fetchAttendanceRules() {
  const { data, error } = await wsSelect(await wsOwner(), 'attendance_rules')
  if (error) throw error
  return data || []
}
export async function upsertAttendanceRule(status, patch) {
  const { data, error } = await supabase
    .from('attendance_rules')
    .upsert(
      { user_id: await wsOwner(), status, ...patch },
      { onConflict: 'user_id,status' },
    )
    .select().single()
  if (error) throw error
  return data
}

// ---------- KPI KARYAWAN ----------
export async function fetchKpiCriteria() {
  const { data, error } = await wsSelect(await wsOwner(), 'kpi_criteria').order('created_at')
  if (error) throw error
  return data || []
}
export async function addKpiCriteria(row) {
  const { data, error } = await supabase
    .from('kpi_criteria').insert({ ...row, user_id: await wsOwner() }).select().single()
  if (error) throw error
  return data
}
export async function updateKpiCriteria(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'kpi_criteria', patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteKpiCriteria(id) {
  const { error } = await wsDelete(await wsOwner(), 'kpi_criteria').eq('id', id)
  if (error) throw error
}

export async function fetchKpiScores(period) {
  const { data, error } = await wsSelect(await wsOwner(), 'kpi_scores').eq('period', period)
  if (error) throw error
  return data || []
}
// Simpan banyak skor sekaligus (upsert per karyawan+kriteria+periode).
export async function saveKpiScores(rows) {
  if (!rows?.length) return []
  const uid = await wsOwner()
  const { data, error } = await supabase
    .from('kpi_scores')
    .upsert(rows.map((r) => ({ ...r, user_id: uid })), { onConflict: 'employee_id,criteria_id,period' })
    .select()
  if (error) throw error
  return data || []
}

export async function fetchKpiBonusRules() {
  const { data, error } = await wsSelect(await wsOwner(), 'kpi_bonus_rules')
    .order('min_score', { ascending: false })
  if (error) throw error
  return data || []
}
export async function addKpiBonusRule(row) {
  const { data, error } = await supabase
    .from('kpi_bonus_rules').insert({ ...row, user_id: await wsOwner() }).select().single()
  if (error) throw error
  return data
}
export async function updateKpiBonusRule(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'kpi_bonus_rules', patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteKpiBonusRule(id) {
  const { error } = await wsDelete(await wsOwner(), 'kpi_bonus_rules').eq('id', id)
  if (error) throw error
}

// Penggajian per periode 'YYYY-MM'.
export async function fetchPayrolls(period) {
  const { data, error } = await wsSelect(await wsOwner(), 'payrolls').eq('period', period)
  if (error) throw error
  return data || []
}
export async function addPayroll(row) {
  const { data, error } = await supabase
    .from('payrolls').insert({ ...row, user_id: await wsOwner() }).select().single()
  if (error) throw error
  return data
}
export async function updatePayroll(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'payrolls', patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deletePayroll(id) {
  const { error } = await wsDelete(await wsOwner(), 'payrolls').eq('id', id)
  if (error) throw error
}

// Bayar gaji: catat transaksi pengeluaran (masuk cashflow & Laba Rugi otomatis)
// lalu kunci baris payroll sebagai 'paid'.
export async function payPayroll(p, { employeeName = '', category = 'Gaji Karyawan', periodText = '' } = {}) {
  const txn = await addTransaction({
    description: `Gaji ${periodText || p.period}: ${employeeName}`.trim(),
    amount: Number(p.total) || 0,
    direction: 'out',
    category,
    channel: 'manual',
    occurred_at: new Date().toISOString(),
    payment_status: 'lunas',
  })
  const { data, error } = await wsUpdate(await wsOwner(), 'payrolls',
    { status: 'paid', paid_at: new Date().toISOString(), txn_id: txn.id })
    .eq('id', p.id).select().single()
  if (error) throw error
  track('payroll_paid')
  return { payroll: data, txn }
}

// ---------- PENGINGAT (notifikasi Dashboard sampai ditutup pengguna) ----------
export async function fetchReminders() {
  const { data, error } = await wsSelect(await wsOwner(), 'reminders')
    .eq('status', 'aktif').order('remind_at')
  if (error) throw error
  return data || []
}
export async function addReminder(row) {
  const { data, error } = await supabase
    .from('reminders').insert({ ...row, user_id: await wsOwner() }).select().single()
  if (error) throw error
  return data
}
export async function updateReminder(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'reminders', patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteReminder(id) {
  const { error } = await wsDelete(await wsOwner(), 'reminders').eq('id', id)
  if (error) throw error
}

// ---------- SATUAN PRODUK (CRUD) ----------
export async function fetchUnits() {
  const { data, error } = await wsSelect(await wsOwner(), 'units').order('name')
  if (error) throw error
  return data || []
}
export async function addUnit(name) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('units').insert({ name: name.trim(), user_id: await wsOwner() }).select().single()
  if (error) throw error
  return data
}
export async function updateUnit(id, name) {
  const { data, error } = await wsUpdate(await wsOwner(), 'units', { name: name.trim() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteUnit(id) {
  const { error } = await wsDelete(await wsOwner(), 'units').eq('id', id)
  if (error) throw error
}

// ---------- KATEGORI PRODUK (CRUD) ----------
export async function fetchProductCategories() {
  const { data, error } = await wsSelect(await wsOwner(), 'product_categories').order('name')
  if (error) throw error
  return data || []
}
export async function addProductCategory(name) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('product_categories').insert({ name: name.trim(), user_id: await wsOwner() }).select().single()
  if (error) throw error
  return data
}
export async function updateProductCategory(id, name) {
  const { data, error } = await wsUpdate(await wsOwner(), 'product_categories', { name: name.trim() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteProductCategory(id) {
  const { error } = await wsDelete(await wsOwner(), 'product_categories').eq('id', id)
  if (error) throw error
}

// Satuan & kategori produk default (dibuat sekali bila masih kosong).
const DEFAULT_UNITS = ['pcs', 'dus', 'pack', 'kg', 'gram', 'liter', 'lusin', 'botol']
const DEFAULT_PRODUCT_CATS = ['Makanan', 'Minuman', 'Sembako', 'Rokok', 'Alat Tulis', 'Lainnya']

export async function ensureInventorySeed() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const [{ count: uCount }, { count: pcCount }] = await Promise.all([
    wsSelect(await wsOwner(), 'units', 'id', { count: 'exact', head: true }),
    wsSelect(await wsOwner(), 'product_categories', 'id', { count: 'exact', head: true }),
  ])
  const ownerId = await wsOwner()
  if (uCount === 0) {
    await supabase.from('units').insert(DEFAULT_UNITS.map((name) => ({ name, user_id: ownerId })))
  }
  if (pcCount === 0) {
    await supabase.from('product_categories').insert(DEFAULT_PRODUCT_CATS.map((name) => ({ name, user_id: ownerId })))
  }
}

// Daftar produk dengan stok menipis (stock <= min_stock, dan min_stock > 0).
export async function fetchLowStock() {
  const { data, error } = await wsSelect(await wsOwner(), 'products')
  if (error) throw error
  return (data || []).filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))
}

// ---------- RINGKASAN HARI INI (rekap deterministik untuk asisten) ----------
export async function fetchTodayTotals() {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const { data, error } = await wsSelect(await wsOwner(), 'transactions', 'direction, amount')
    .gte('occurred_at', start.toISOString())
  if (error) throw error
  let income = 0, expense = 0
  for (const t of data || []) {
    if (t.direction === 'in') income += Number(t.amount) || 0
    else expense += Number(t.amount) || 0
  }
  return { income, expense, profit: income - expense, count: (data || []).length }
}

// ---------- TARGET PENJUALAN (untuk prediksi 3 skenario) ----------
// ---------- BASELINE "MARGIN YANG KAMU KIRA" (task C2) ----------
// Tebakan pengguna direkam SEKALI, sebelum mereka melihat angka aslinya di
// Reveal. Sesudah itu jawabannya sudah terkontaminasi dan selisihnya — yang
// justru menjadi nilai produk — tidak bisa direkonstruksi lagi.
export async function fetchBaseline() {
  const { data, error } = await wsSelect(await wsOwner(), 'user_baseline').limit(1)
  if (error) throw error
  return (data && data[0]) || null
}

// Upsert, bukan insert: pengguna bisa menekan simpan dua kali, dan indeks unik
// pada user_id yang menjaga agar tetap satu baris per pengguna.
export async function saveBaseline(jawaban) {
  const owner = await wsOwner()
  const { error } = await supabase
    .from('user_baseline')
    .upsert({ user_id: owner, ...jawaban }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function fetchActiveTarget() {
  const { data, error } = await wsSelect(await wsOwner(), 'sales_targets')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data && data[0]) || null
}

// Transaksi DALAM rentang target, diambil langsung dari server.
//
// Dashboard memuat transaksi lewat `fetchTransactions()` yang dibatasi
// TX_FETCH_LIMIT baris TERBARU. Untuk usaha ramai, target yang rentangnya
// lebih tua dari plafon itu kehilangan sebagian transaksinya — progres
// tampil terlalu kecil tanpa error apa pun. Rentangnya difilter di server
// supaya capaian tidak bergantung pada apa yang kebetulan termuat di layar.
export async function fetchTargetTransactions(target) {
  if (!target) return []
  const startStr = target.start_date || new Date().toISOString().slice(0, 10)
  let q = wsSelect(await wsOwner(), 'transactions', 'direction, amount, occurred_at')
    .gte('occurred_at', new Date(startStr + 'T00:00:00').toISOString())
  if (target.deadline) {
    q = q.lte('occurred_at', new Date(target.deadline + 'T23:59:59').toISOString())
  }
  const { data, error } = await q.limit(TX_FETCH_LIMIT)
  if (error) throw error
  return data || []
}

// Angka target dari form selalu berupa string. `Number('')` = 0 dan
// `Number('abc')` = NaN — dua-duanya lolos kalau hanya dicek `!= null`, lalu
// gagal jauh di dalam PostgREST dengan pesan SQL mentah. Normalisasi di sini:
// kembalikan null untuk "tidak diisi", dan lempar untuk nilai yang tidak masuk akal.
function normTargetAmount(v, label) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${label} harus berupa angka.`)
  if (n <= 0) return null
  // Kolom numeric(14,2) → maksimum 12 digit sebelum koma.
  if (n >= 1e12) throw new Error(`${label} terlalu besar (maksimum 999.999.999.999).`)
  return Math.round(n * 100) / 100
}

// Target penjualan: nama, rentang (start_date..deadline), dan target omset
// (revenue_target) dan/atau laba bersih (profit_target). `amount` tetap diisi
// (= revenue_target ?? profit_target) demi kcompat kode/insight lama; kolom itu
// masih memikul CHECK (amount > 0) dari migrasi awal, jadi tidak boleh 0/null.
export async function addTarget({ name, start_date, deadline, revenue_target = null, profit_target = null }) {
  const rev = normTargetAmount(revenue_target, 'Target omset')
  const prof = normTargetAmount(profit_target, 'Target profit')
  if (rev == null && prof == null) throw new Error('Isi minimal salah satu: target omset atau target profit.')

  const owner = await wsOwner()
  // Hanya satu target aktif: nonaktifkan yang lama dulu. Terikat workspace —
  // tanpa filter ini, staf yang aktif di usaha lain ikut mematikan target usaha itu.
  // Error di langkah ini WAJIB dilempar: kalau ditelan, insert di bawah tetap
  // jalan dan workspace berakhir dengan dua target aktif — `fetchActiveTarget`
  // lalu memilih salah satunya secara sewenang-wenang.
  const { error: deacErr } = await wsUpdate(owner, 'sales_targets', { is_active: false }).eq('is_active', true)
  if (deacErr) throw deacErr

  const { data, error } = await supabase
    .from('sales_targets')
    .insert({
      name: (name || '').trim() || 'Target penjualan',
      revenue_target: rev, profit_target: prof,
      amount: rev ?? prof,
      start_date, deadline: deadline || null,
      user_id: owner,
    })
    .select().single()
  if (error) throw error
  track('target_added')
  return data
}

export async function deactivateTarget(id) {
  const { error, count } = await wsUpdate(await wsOwner(), 'sales_targets', { is_active: false }, { count: 'exact' })
    .eq('id', id)
  if (error) throw error
  // 0 baris terkena = id itu bukan milik workspace aktif (atau sudah hilang).
  // Tanpa cek ini pemanggil menganggap target sudah mati padahal masih aktif.
  if (count === 0) throw new Error('Target tidak ditemukan di usaha yang sedang dibuka.')
}

// ---------- BAHAN / KOMPONEN BIAYA (untuk HPP) ----------
export async function fetchIngredients() {
  const { data, error } = await wsSelect(await wsOwner(), 'ingredients').order('name')
  if (error) throw error
  return data || []
}

export async function updateIngredient(id, patch) {
  const { data, error } = await wsUpdate(await wsOwner(), 'ingredients', { ...patch, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteIngredient(id) {
  const { error } = await wsDelete(await wsOwner(), 'ingredients').eq('id', id)
  if (error) throw error
}

// ---------- KOMPOSISI PRODUK / BoM ----------
export async function fetchBom(productId) {
  const { data, error } = await wsSelect(await wsOwner(), 'product_boms').eq('product_id', productId)
  if (error) throw error
  return data || []
}

// Simpan komposisi 1 produk sekaligus. rows: hasil editor BoM
// [{ ingredient_id?, name, type, unit, price_per_unit, commodity_key,
//    import_exposure, qty_per_unit, is_ai_estimated, price_source? }]
// Bahan baru dibuat otomatis; bahan lama diperbarui dari isi editor
// (editor = sumber kebenaran karena pengguna baru saja meninjaunya).
export async function saveBom(productId, rows) {
  const { data: { user } } = await supabase.auth.getUser()
  const existing = await fetchIngredients()
  const byName = new Map(existing.map((i) => [i.name.trim().toLowerCase(), i]))
  const bomRows = []
  for (const r of rows) {
    const qty = Number(r.qty_per_unit) || 0
    if (!r.name?.trim() || qty <= 0) continue
    let ing = r.ingredient_id ? existing.find((i) => i.id === r.ingredient_id) : byName.get(r.name.trim().toLowerCase())
    const fields = {
      name: r.name.trim(),
      type: r.type || 'bahan',
      unit: r.unit || 'pcs',
      price_per_unit: Number(r.price_per_unit) || 0,
      commodity_key: r.commodity_key || null,
      import_exposure: r.import_exposure || 'rendah',
      price_source: r.price_source || 'manual',
    }
    if (ing) {
      const { data, error } = await wsUpdate(await wsOwner(), 'ingredients', { ...fields, updated_at: new Date().toISOString() })
        .eq('id', ing.id).select().single()
      if (error) throw error
      ing = data
    } else {
      const { data, error } = await supabase
        .from('ingredients').insert({ ...fields, user_id: await wsOwner() }).select().single()
      if (error) throw error
      ing = data
      byName.set(ing.name.trim().toLowerCase(), ing)
    }
    bomRows.push({
      user_id: await wsOwner(), product_id: productId, ingredient_id: ing.id,
      qty_per_unit: qty, is_ai_estimated: Boolean(r.is_ai_estimated),
    })
  }
  const { error: delErr } = await wsDelete(await wsOwner(), 'product_boms').eq('product_id', productId)
  if (delErr) throw delErr
  if (bomRows.length) {
    const { error } = await supabase.from('product_boms').insert(bomRows)
    if (error) throw error
  }
  track('bom_saved', { rows: bomRows.length })
  return bomRows.length
}

// ---------- DATA MAKRO BERSAMA (cache dari Edge Function makro-harian) ----------
// Sinyal harga komoditas dari run terakhir.
export async function fetchMacroSignals() {
  const { data, error } = await supabase
    .from('macro_signals').select('*')
    .order('run_date', { ascending: false })
    .limit(42) // 2 hari x ~21 komoditas
  if (error) throw error
  const rows = data || []
  if (!rows.length) return { runDate: null, signals: [] }
  const latest = rows[0].run_date
  return { runDate: latest, signals: rows.filter((r) => r.run_date === latest) }
}

// Harga bahan pokok RESMI (PIHPS Bank Indonesia) dari run terakhir.
export async function fetchCommodityPrices() {
  const { data, error } = await supabase
    .from('commodity_prices').select('*')
    .eq('province_id', 0) // tampilan bawaan = rata-rata nasional
    .order('run_date', { ascending: false })
    .limit(160) // 2-3 hari x ~50 baris (kelompok + varian + harga RAG)
  if (error) throw error
  const rows = data || []
  if (!rows.length) return { runDate: null, prices: [] }
  const latest = rows[0].run_date
  return { runDate: latest, prices: rows.filter((r) => r.run_date === latest) }
}

export async function fetchExchangeRates(days = 90) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('exchange_rates').select('*')
    .gte('rate_date', since)
    .order('rate_date', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchMacroConfigLatest() {
  const { data, error } = await supabase
    .from('macro_config').select('*')
    .order('month', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data && data[0]) || null
}
