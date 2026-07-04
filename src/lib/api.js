import { supabase } from './supabase'

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
    .insert({ ...tx, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  track('transaction_added', { channel: tx.channel, direction: tx.direction })
  return data
}

export async function addTransactionsBulk(list) {
  const { data: { user } } = await supabase.auth.getUser()
  const payload = list.map((t) => ({ ...t, user_id: user.id }))
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
    .from('categorization_rules').insert({ ...rule, user_id: user.id }).select().single()
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
    .from('categories').insert({ name: name.trim(), direction, user_id: user.id }).select().single()
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
    .from('channels').insert({ value, label: label.trim(), icon: icon || '🏷️', user_id: user.id })
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
]

// Isi default jika kosong (dipanggil sekali saat masuk app)
export async function ensureSeedData() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const [{ count: catCount }, { count: chCount }] = await Promise.all([
    supabase.from('categories').select('id', { count: 'exact', head: true }),
    supabase.from('channels').select('id', { count: 'exact', head: true }),
  ])
  if (catCount === 0) {
    const rows = [
      ...DEFAULT_CATS.in.map((name) => ({ name, direction: 'in', user_id: user.id })),
      ...DEFAULT_CATS.out.map((name) => ({ name, direction: 'out', user_id: user.id })),
    ]
    await supabase.from('categories').insert(rows)
  }
  if (chCount === 0) {
    await supabase.from('channels').insert(DEFAULT_CHANNELS.map((c) => ({ ...c, user_id: user.id })))
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
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
  const { data, error } = await supabase.from('suppliers').insert({ ...s, user_id: user.id }).select().single()
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
  const { data, error } = await supabase.from('products').insert({ ...p, user_id: user.id }).select().single()
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

// ---------- SATUAN PRODUK (CRUD) ----------
export async function fetchUnits() {
  const { data, error } = await supabase.from('units').select('*').order('name')
  if (error) throw error
  return data || []
}
export async function addUnit(name) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('units').insert({ name: name.trim(), user_id: user.id }).select().single()
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
  const { data, error } = await supabase.from('product_categories').insert({ name: name.trim(), user_id: user.id }).select().single()
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
  if (uCount === 0) {
    await supabase.from('units').insert(DEFAULT_UNITS.map((name) => ({ name, user_id: user.id })))
  }
  if (pcCount === 0) {
    await supabase.from('product_categories').insert(DEFAULT_PRODUCT_CATS.map((name) => ({ name, user_id: user.id })))
  }
}

// Daftar produk dengan stok menipis (stock <= min_stock, dan min_stock > 0).
export async function fetchLowStock() {
  const { data, error } = await supabase.from('products').select('*')
  if (error) throw error
  return (data || []).filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))
}
