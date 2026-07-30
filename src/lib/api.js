import { supabase } from './supabase'

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
  try {
    const { data } = await supabase
      .from('staff_members')
      .select('owner_id')
      .eq('member_id', user.id)
      .eq('status', 'active')
      .eq('owner_id', selected)
      .limit(1)
    _ownerCache = data?.[0]?.owner_id || user.id
  } catch { _ownerCache = user.id }
  return _ownerCache
}
// Reset cache saat sesi berubah. Optional-chaining penting: saat env Supabase
// belum diisi (mis. di Vercel tanpa env var), `supabase` bernilai null dan
// aplikasi harus tetap hidup untuk menampilkan halaman /setup — bukan blank.
supabase?.auth?.onAuthStateChange(() => { _ownerCache = null })

// ---------- TRANSAKSI ----------
// Plafon pengambilan transaksi ke klien. Untuk volume sangat tinggi, ringkasan
// akurat dihitung di server via RPC my_monthly_summary; UI menampilkan peringatan
// bila data yang dimuat terpotong oleh plafon ini.
export const TX_FETCH_LIMIT = 5000

export async function fetchTransactions({ limit = TX_FETCH_LIMIT } = {}) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// Jumlah total transaksi milik pengguna (untuk mendeteksi data terpotong).
export async function fetchTxCount() {
  const { count, error } = await supabase
    .from('transactions').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

// Ringkasan per bulan dihitung di server (mencakup seluruh baris, tanpa plafon).
export async function fetchMonthlySummary() {
  const { data, error } = await supabase.rpc('my_monthly_summary')
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
    .insert({ ...tx, user_id: await effectiveOwnerId() })
    .select()
    .single()
  if (error) throw error
  track('transaction_added', { channel: tx.channel, direction: tx.direction })
  return data
}

export async function addTransactionsBulk(list) {
  const ownerId = await effectiveOwnerId()
  const payload = list.map((t) => ({ ...t, user_id: ownerId }))
  const { data, error } = await supabase.from('transactions').insert(payload).select()
  if (error) throw error
  track('import_completed', { count: payload.length })
  return data || []
}

export async function updateTransaction(id, patch) {
  const { data, error } = await supabase
    .from('transactions').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
}

// ---------- ATURAN KATEGORI ----------
export async function fetchRules() {
  const { data, error } = await supabase
    .from('categorization_rules').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addRule(rule) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('categorization_rules').insert({ ...rule, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  return data
}

export async function deleteRule(id) {
  const { error } = await supabase.from('categorization_rules').delete().eq('id', id)
  if (error) throw error
}

// ---------- KATEGORI (milik user) ----------
export async function fetchCategories() {
  const { data, error } = await supabase
    .from('categories').select('*').order('direction').order('name')
  if (error) throw error
  return data || []
}
export async function addCategory({ name, direction }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('categories').insert({ name: name.trim(), direction, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  return data
}
export async function updateCategory(id, patch) {
  const { data, error } = await supabase
    .from('categories').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

// ---------- CHANNEL (milik user) ----------
export async function fetchChannels() {
  const { data, error } = await supabase.from('channels').select('*').order('created_at')
  if (error) throw error
  return data || []
}
export async function addChannel({ value, label, icon }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('channels').insert({ value, label: label.trim(), icon: icon || '🏷️', user_id: await effectiveOwnerId() })
    .select().single()
  if (error) throw error
  return data
}
export async function updateChannel(id, patch) {
  const { data, error } = await supabase
    .from('channels').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteChannel(id) {
  const { error } = await supabase.from('channels').delete().eq('id', id)
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
  const [{ count: catCount }, { count: chCount }] = await Promise.all([
    supabase.from('categories').select('id', { count: 'exact', head: true }),
    supabase.from('channels').select('id', { count: 'exact', head: true }),
  ])
  const ownerId = await effectiveOwnerId()
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
  const ownerId = await effectiveOwnerId()
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
// Mencatat persetujuan Syarat & Ketentuan + Kebijakan Privasi melalui RPC,
// agar stempel waktu diambil dari server (tidak bisa dipalsukan dari perangkat).
export async function acceptTerms(version) {
  const { error } = await supabase.rpc('accept_terms', { p_version: version })
  if (error) throw error
}

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
  for (const tbl of tables) {
    try { const { data } = await supabase.from(tbl).select('*'); out[tbl] = data || [] }
    catch { out[tbl] = [] }
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

// Menghapus postingan milik sendiri.
export async function deleteFeedback(id) {
  const { error } = await supabase.from('feedback').delete().eq('id', id)
  if (error) throw error
}

// ---------- SUPPLIER (pemasok) ----------
export async function fetchSuppliers() {
  const { data, error } = await supabase.from('suppliers').select('*').order('name')
  if (error) throw error
  return data || []
}
export async function addSupplier(s) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('suppliers').insert({ ...s, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  return data
}
export async function updateSupplier(id, patch) {
  const { data, error } = await supabase.from('suppliers').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteSupplier(id) {
  const { error } = await supabase.from('suppliers').delete().eq('id', id)
  if (error) throw error
}

// ---------- PRODUK / STOK ----------
export async function fetchProducts() {
  const { data, error } = await supabase.from('products').select('*').order('name')
  if (error) throw error
  return data || []
}
export async function addProduct(p) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('products').insert({ ...p, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  track('product_added')
  return data
}
export async function updateProduct(id, patch) {
  const { data, error } = await supabase
    .from('products').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id)
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
export async function addTransactionWithStock(tx, lines = []) {
  const { data, error } = await supabase.rpc('add_transaction_with_stock', {
    p_tx: tx,
    p_lines: (lines || []).map((l) => ({ productId: l.productId, qty: l.qty })),
  })
  if (error) throw error
  track('transaction_added', { channel: tx.channel, direction: tx.direction })
  return { txn: data?.txn || null, changes: data?.changes || [] }
}

// ---------- PURCHASE ORDER (Gudang fase 1) ----------
// Aturan: satu PO = satu produk, sehingga penerimaan PO menghasilkan
// tepat satu transaksi pengeluaran (selaras aturan 1 transaksi = 1 produk).
export async function fetchPurchaseOrders() {
  const { data, error } = await supabase
    .from('purchase_orders').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addPurchaseOrder(po) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('purchase_orders').insert({ ...po, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  track('po_created')
  return data
}

export async function updatePurchaseOrder(id, patch) {
  const { data, error } = await supabase
    .from('purchase_orders').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deletePurchaseOrder(id) {
  const { error } = await supabase.from('purchase_orders').delete().eq('id', id)
  if (error) throw error
}

// Menerima PO (status approved -> received) dalam SATU transaksi database
// (RPC receive_purchase_order): stok bertambah + opsional catat pengeluaran
// ('belum' = beli kredit -> UTANG di menu Piutang & Utang) + PO dikunci
// 'received'. Gagal di langkah mana pun = seluruhnya dibatalkan otomatis.
export async function receivePurchaseOrder(po, { createExpense = true, category = '', paymentStatus = 'lunas', dueDate = null } = {}) {
  const { data, error } = await supabase.rpc('receive_purchase_order', {
    p_po_id: po.id,
    p_create_expense: createExpense,
    p_category: category,
    p_payment_status: paymentStatus,
    p_due_date: paymentStatus === 'belum' && dueDate ? dueDate : null,
  })
  if (error) throw error
  track('po_received', { with_expense: Boolean(data?.txn) })
  return { po: data?.po, stock: data?.stock, txn: data?.txn || null }
}

// ---------- STOCK OPNAME (Gudang fase 1) ----------
export async function fetchOpnames() {
  const { data, error } = await supabase
    .from('stock_opnames').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addOpname(payload) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('stock_opnames').insert({ ...payload, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  track('opname_created')
  return data
}

export async function updateOpname(id, patch) {
  const { data, error } = await supabase
    .from('stock_opnames').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteOpname(id) {
  const { error } = await supabase.from('stock_opnames').delete().eq('id', id)
  if (error) throw error
}

// Posting opname dalam SATU transaksi database (RPC post_stock_opname):
// stok tiap produk DISET sama dengan hasil hitung fisik (hitung fisik =
// kebenaran; baris tanpa hasil hitung dilewati) + sesi dikunci 'posted'.
// Gagal di langkah mana pun = seluruhnya dibatalkan otomatis.
export async function postOpname(opname) {
  const { data, error } = await supabase.rpc('post_stock_opname', {
    p_opname_id: opname.id,
    p_items: opname.items || [],
  })
  if (error) throw error
  const changes = data?.changes || []
  track('opname_posted', { changes: changes.length })
  return { opname: data?.opname, changes }
}

// ---------- RBAC: PENGGUNA & HAK AKSES (fase 3) ----------
export async function fetchStaff() {
  const { data, error } = await supabase
    .from('staff_members').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addStaff(email, modules, role = 'staf') {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('staff_members')
    .insert({ owner_id: user.id, email: email.trim().toLowerCase(), modules, role })
    .select().single()
  if (error) throw error
  track('staff_invited')
  return data
}

export async function updateStaff(id, patch) {
  const { data, error } = await supabase
    .from('staff_members').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteStaff(id) {
  const { error } = await supabase.from('staff_members').delete().eq('id', id)
  if (error) throw error
}

// SEMUA keanggotaan staf saya yang aktif (bisa lebih dari satu workspace).
// Sengaja mengembalikan array: satu pengguna sah menjadi staf di banyak usaha.
export async function fetchMyMemberships() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('staff_members').select('*')
    .eq('member_id', user.id).eq('status', 'active')
  return data || []
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
export async function fetchPendingInvitations() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return []
  const { data } = await supabase
    .from('staff_members').select('*')
    .is('member_id', null).eq('status', 'invited')
  // RLS sudah menyaring ke email kita; disaring ulang di klien sebagai
  // pertahanan berlapis (perbandingan PERSIS, bukan pola LIKE).
  const mine = String(user.email).toLowerCase()
  return (data || []).filter((r) => String(r.email || '').toLowerCase() === mine)
}

// Menerima undangan SECARA EKSPLISIT. Tidak lagi dipanggil otomatis saat login,
// supaya akun baru tidak pernah "diserap" ke workspace orang lain tanpa sadar.
export async function acceptInvitation(id) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Harus masuk (login).')
  const { data, error } = await supabase
    .from('staff_members')
    .update({ member_id: user.id, status: 'active' })
    .eq('id', id)
    .is('member_id', null)
    .eq('status', 'invited')
    .select()
  if (error) throw error
  _ownerCache = null
  return data?.[0] || null
}

// Menolak undangan: cukup diabaikan dari sisi pengguna (baris tetap milik owner,
// yang bisa mencabutnya sendiri). Disimpan lokal agar tidak ditawarkan lagi.
const DISMISSED_KEY = 'bp-dismissed-invites'
export function dismissInvitation(id) {
  try {
    const cur = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')
    if (!cur.includes(id)) localStorage.setItem(DISMISSED_KEY, JSON.stringify([...cur, id]))
  } catch { /* private mode */ }
}
export function isInvitationDismissed(id) {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]').includes(id)
  } catch { return false }
}

// ---------- AUDIT LOG (baca-saja; ditulis trigger database) ----------
export async function fetchAuditLogs({ table = '', action = '', limit = 200 } = {}) {
  let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (table) q = q.eq('table_name', table)
  if (action) q = q.eq('action', action)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// ---------- OPERASIONAL: PAPAN TUGAS (fase 5) ----------
export async function fetchTasks() {
  const { data, error } = await supabase
    .from('tasks').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
export async function addTask(t) {
  const { data, error } = await supabase
    .from('tasks').insert({ ...t, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  track('task_added')
  return data
}
export async function updateTask(id, patch) {
  const { data, error } = await supabase
    .from('tasks').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

// ---------- HR: KARYAWAN / ABSENSI / PENGGAJIAN (fase 4) ----------
export async function fetchEmployees() {
  const { data, error } = await supabase.from('employees').select('*').order('name')
  if (error) throw error
  return data || []
}
export async function addEmployee(e) {
  const { data, error } = await supabase
    .from('employees').insert({ ...e, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  track('employee_added')
  return data
}
export async function updateEmployee(id, patch) {
  const { data, error } = await supabase
    .from('employees').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteEmployee(id) {
  const { error } = await supabase.from('employees').delete().eq('id', id)
  if (error) throw error
}

// Absensi satu tanggal (semua karyawan).
export async function fetchAttendanceByDate(date) {
  const { data, error } = await supabase.from('attendance').select('*').eq('date', date)
  if (error) throw error
  return data || []
}
// Absensi rentang tanggal (untuk rekap & hitung gaji harian).
export async function fetchAttendanceRange(from, to) {
  const { data, error } = await supabase
    .from('attendance').select('*').gte('date', from).lte('date', to)
  if (error) throw error
  return data || []
}
// Set status absensi karyawan pada tanggal tertentu (upsert: sekali klik ganti status).
export async function setAttendance(employeeId, date, status, note) {
  const row = { user_id: await effectiveOwnerId(), employee_id: employeeId, date, status }
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
  const { error } = await supabase
    .from('attendance').delete().eq('employee_id', employeeId).eq('date', date)
  if (error) throw error
}

// ---------- ATURAN BONUS/POTONGAN PER STATUS ABSENSI ----------
export async function fetchAttendanceRules() {
  const { data, error } = await supabase.from('attendance_rules').select('*')
  if (error) throw error
  return data || []
}
export async function upsertAttendanceRule(status, patch) {
  const { data, error } = await supabase
    .from('attendance_rules')
    .upsert(
      { user_id: await effectiveOwnerId(), status, ...patch },
      { onConflict: 'user_id,status' },
    )
    .select().single()
  if (error) throw error
  return data
}

// ---------- KPI KARYAWAN ----------
export async function fetchKpiCriteria() {
  const { data, error } = await supabase
    .from('kpi_criteria').select('*').order('created_at')
  if (error) throw error
  return data || []
}
export async function addKpiCriteria(row) {
  const { data, error } = await supabase
    .from('kpi_criteria').insert({ ...row, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  return data
}
export async function updateKpiCriteria(id, patch) {
  const { data, error } = await supabase
    .from('kpi_criteria').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteKpiCriteria(id) {
  const { error } = await supabase.from('kpi_criteria').delete().eq('id', id)
  if (error) throw error
}

export async function fetchKpiScores(period) {
  const { data, error } = await supabase.from('kpi_scores').select('*').eq('period', period)
  if (error) throw error
  return data || []
}
// Simpan banyak skor sekaligus (upsert per karyawan+kriteria+periode).
export async function saveKpiScores(rows) {
  if (!rows?.length) return []
  const uid = await effectiveOwnerId()
  const { data, error } = await supabase
    .from('kpi_scores')
    .upsert(rows.map((r) => ({ ...r, user_id: uid })), { onConflict: 'employee_id,criteria_id,period' })
    .select()
  if (error) throw error
  return data || []
}

export async function fetchKpiBonusRules() {
  const { data, error } = await supabase
    .from('kpi_bonus_rules').select('*').order('min_score', { ascending: false })
  if (error) throw error
  return data || []
}
export async function addKpiBonusRule(row) {
  const { data, error } = await supabase
    .from('kpi_bonus_rules').insert({ ...row, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  return data
}
export async function updateKpiBonusRule(id, patch) {
  const { data, error } = await supabase
    .from('kpi_bonus_rules').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteKpiBonusRule(id) {
  const { error } = await supabase.from('kpi_bonus_rules').delete().eq('id', id)
  if (error) throw error
}

// Penggajian per periode 'YYYY-MM'.
export async function fetchPayrolls(period) {
  const { data, error } = await supabase.from('payrolls').select('*').eq('period', period)
  if (error) throw error
  return data || []
}
export async function addPayroll(row) {
  const { data, error } = await supabase
    .from('payrolls').insert({ ...row, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  return data
}
export async function updatePayroll(id, patch) {
  const { data, error } = await supabase
    .from('payrolls').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deletePayroll(id) {
  const { error } = await supabase.from('payrolls').delete().eq('id', id)
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
  const { data, error } = await supabase
    .from('payrolls')
    .update({ status: 'paid', paid_at: new Date().toISOString(), txn_id: txn.id })
    .eq('id', p.id).select().single()
  if (error) throw error
  track('payroll_paid')
  return { payroll: data, txn }
}

// ---------- PENGINGAT (notifikasi Dashboard sampai ditutup pengguna) ----------
export async function fetchReminders() {
  const { data, error } = await supabase
    .from('reminders').select('*').eq('status', 'aktif').order('remind_at')
  if (error) throw error
  return data || []
}
export async function addReminder(row) {
  const { data, error } = await supabase
    .from('reminders').insert({ ...row, user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  return data
}
export async function updateReminder(id, patch) {
  const { data, error } = await supabase
    .from('reminders').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteReminder(id) {
  const { error } = await supabase.from('reminders').delete().eq('id', id)
  if (error) throw error
}

// ---------- SATUAN PRODUK (CRUD) ----------
export async function fetchUnits() {
  const { data, error } = await supabase.from('units').select('*').order('name')
  if (error) throw error
  return data || []
}
export async function addUnit(name) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('units').insert({ name: name.trim(), user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  return data
}
export async function updateUnit(id, name) {
  const { data, error } = await supabase.from('units').update({ name: name.trim() }).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteUnit(id) {
  const { error } = await supabase.from('units').delete().eq('id', id)
  if (error) throw error
}

// ---------- KATEGORI PRODUK (CRUD) ----------
export async function fetchProductCategories() {
  const { data, error } = await supabase.from('product_categories').select('*').order('name')
  if (error) throw error
  return data || []
}
export async function addProductCategory(name) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('product_categories').insert({ name: name.trim(), user_id: await effectiveOwnerId() }).select().single()
  if (error) throw error
  return data
}
export async function updateProductCategory(id, name) {
  const { data, error } = await supabase.from('product_categories').update({ name: name.trim() }).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteProductCategory(id) {
  const { error } = await supabase.from('product_categories').delete().eq('id', id)
  if (error) throw error
}

// Satuan & kategori produk default (dibuat sekali bila masih kosong).
const DEFAULT_UNITS = ['pcs', 'dus', 'pack', 'kg', 'gram', 'liter', 'lusin', 'botol']
const DEFAULT_PRODUCT_CATS = ['Makanan', 'Minuman', 'Sembako', 'Rokok', 'Alat Tulis', 'Lainnya']

export async function ensureInventorySeed() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const [{ count: uCount }, { count: pcCount }] = await Promise.all([
    supabase.from('units').select('id', { count: 'exact', head: true }),
    supabase.from('product_categories').select('id', { count: 'exact', head: true }),
  ])
  const ownerId = await effectiveOwnerId()
  if (uCount === 0) {
    await supabase.from('units').insert(DEFAULT_UNITS.map((name) => ({ name, user_id: ownerId })))
  }
  if (pcCount === 0) {
    await supabase.from('product_categories').insert(DEFAULT_PRODUCT_CATS.map((name) => ({ name, user_id: ownerId })))
  }
}

// Daftar produk dengan stok menipis (stock <= min_stock, dan min_stock > 0).
export async function fetchLowStock() {
  const { data, error } = await supabase.from('products').select('*')
  if (error) throw error
  return (data || []).filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))
}

// ---------- RINGKASAN HARI INI (rekap deterministik untuk asisten) ----------
export async function fetchTodayTotals() {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('transactions').select('direction, amount')
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
export async function fetchActiveTarget() {
  const { data, error } = await supabase
    .from('sales_targets').select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data && data[0]) || null
}

// Target penjualan: nama, rentang (start_date..deadline), dan target omset
// (revenue_target) dan/atau laba bersih (profit_target). `amount` tetap diisi
// (= revenue_target ?? profit_target) demi kcompat kode/insight lama.
export async function addTarget({ name, start_date, deadline, revenue_target = null, profit_target = null }) {
  const rev = revenue_target != null && revenue_target !== '' ? Number(revenue_target) : null
  const prof = profit_target != null && profit_target !== '' ? Number(profit_target) : null
  // Hanya satu target aktif: nonaktifkan yang lama dulu.
  await supabase.from('sales_targets').update({ is_active: false }).eq('is_active', true)
  const { data, error } = await supabase
    .from('sales_targets')
    .insert({
      name: (name || '').trim() || 'Target penjualan',
      revenue_target: rev, profit_target: prof,
      amount: rev ?? prof ?? 0,
      start_date, deadline: deadline || null,
      user_id: await effectiveOwnerId(),
    })
    .select().single()
  if (error) throw error
  track('target_added')
  return data
}

export async function deactivateTarget(id) {
  const { error } = await supabase.from('sales_targets').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

// ---------- BAHAN / KOMPONEN BIAYA (untuk HPP) ----------
export async function fetchIngredients() {
  const { data, error } = await supabase.from('ingredients').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function updateIngredient(id, patch) {
  const { data, error } = await supabase
    .from('ingredients').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteIngredient(id) {
  const { error } = await supabase.from('ingredients').delete().eq('id', id)
  if (error) throw error
}

// ---------- KOMPOSISI PRODUK / BoM ----------
export async function fetchBom(productId) {
  const { data, error } = await supabase
    .from('product_boms').select('*').eq('product_id', productId)
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
      const { data, error } = await supabase
        .from('ingredients').update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', ing.id).select().single()
      if (error) throw error
      ing = data
    } else {
      const { data, error } = await supabase
        .from('ingredients').insert({ ...fields, user_id: await effectiveOwnerId() }).select().single()
      if (error) throw error
      ing = data
      byName.set(ing.name.trim().toLowerCase(), ing)
    }
    bomRows.push({
      user_id: await effectiveOwnerId(), product_id: productId, ingredient_id: ing.id,
      qty_per_unit: qty, is_ai_estimated: Boolean(r.is_ai_estimated),
    })
  }
  const { error: delErr } = await supabase.from('product_boms').delete().eq('product_id', productId)
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
