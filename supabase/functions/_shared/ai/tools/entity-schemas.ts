// ============================================================
// REGULASI INPUT PER FITUR — sumber kebenaran untuk CRUD via prompt & voice.
//
// Setiap entitas mendaftarkan field yang SAMA PERSIS dengan form manual di UI,
// lengkap dengan mana yang wajib dan mana yang opsional. AI hanya boleh mengisi
// field yang terdaftar di sini.
//
// Aturan slot-filling (permintaan pengguna):
//   - Field WAJIB yang kosong  -> harus ditanyakan ulang, tidak boleh ditebak.
//   - Field OPSIONAL yang kosong -> tetap DITANYAKAN SEKALI ("mau diisi atau
//     lewati?"), supaya data yang tersimpan selengkap input manual.
//   - Field finansial/destruktif -> wajib konfirmasi manual sebelum commit.
// ============================================================

export type FieldType = 'string' | 'text' | 'number' | 'money' | 'enum' | 'date' | 'ref' | 'boolean'

export interface FieldSpec {
  name: string
  label: string
  type: FieldType
  required: boolean
  /** Pertanyaan yang diajukan ke pengguna bila field ini kosong. */
  ask: string
  enumValues?: string[]
  /** Untuk type 'ref': tabel & kolom yang dipakai memvalidasi keberadaan data. */
  refTable?: string
  refLabelColumn?: string
  /** Nilai default bila pengguna memilih melewati field opsional. */
  fallback?: unknown
  /** true = perubahan bersifat finansial, wajib konfirmasi manual. */
  financial?: boolean
  /** Sumber pilihan dinamis (kategori/channel/produk milik pengguna). */
  optionsFrom?: 'categories_in' | 'categories_out' | 'channels' | 'products' | 'suppliers' | 'units' | 'product_categories' | 'employees'
  max?: number
  min?: number
}

export interface EntitySpec {
  entity: string
  label: string
  /** Modul RBAC yang dibutuhkan agar staf boleh melakukannya. */
  module: 'transaksi' | 'produk' | 'hr' | 'analisis' | 'operasional'
  table: string
  fields: FieldSpec[]
  /** Aksi yang diizinkan lewat AI untuk entitas ini. */
  allow: Array<'create' | 'update' | 'delete'>
  /** true = CREATE pun butuh konfirmasi (karena menyentuh uang/stok). */
  confirmOnCreate: boolean
}

// ---------- TRANSAKSI ----------
const TRANSACTION: EntitySpec = {
  entity: 'transaksi',
  label: 'Transaksi',
  module: 'transaksi',
  table: 'transactions',
  allow: ['create', 'update', 'delete'],
  confirmOnCreate: true, // menyentuh uang
  fields: [
    {
      name: 'direction', label: 'Jenis transaksi', type: 'enum', required: true,
      enumValues: ['in', 'out'],
      ask: 'Ini pemasukan (penjualan) atau pengeluaran (belanja)?',
    },
    {
      name: 'amount', label: 'Nominal (Rp)', type: 'money', required: true, financial: true,
      min: 1, max: 1_000_000_000_000,
      ask: 'Berapa nominalnya (dalam Rupiah)?',
    },
    {
      name: 'description', label: 'Keterangan', type: 'string', required: true, max: 200,
      ask: 'Keterangannya apa? Contoh: "Penjualan 5 nasi goreng".',
    },
    {
      name: 'category', label: 'Kategori', type: 'enum', required: true,
      optionsFrom: 'categories_in', // dipilih dinamis sesuai direction saat runtime
      ask: 'Masuk kategori apa?',
    },
    {
      name: 'channel', label: 'Channel / sumber', type: 'enum', required: false,
      optionsFrom: 'channels', fallback: 'manual',
      ask: 'Lewat channel apa (tunai, QRIS, transfer, GoFood, dll)? Boleh dilewati kalau tidak yakin.',
    },
    {
      name: 'occurred_at', label: 'Tanggal & waktu', type: 'date', required: false,
      fallback: 'today',
      ask: 'Kapan transaksinya terjadi? Kosongkan kalau hari ini.',
    },
    {
      name: 'payment_status', label: 'Status pembayaran', type: 'enum', required: false,
      enumValues: ['lunas', 'belum'], fallback: 'lunas',
      ask: 'Sudah lunas atau belum dibayar?',
    },
    {
      name: 'due_date', label: 'Jatuh tempo', type: 'date', required: false,
      ask: 'Kapan jatuh temponya? (hanya kalau belum lunas — boleh dilewati)',
    },
    {
      name: 'customer_name', label: 'Nama pelanggan', type: 'string', required: false, max: 120,
      ask: 'Atas nama pelanggan siapa? Boleh dilewati.',
    },
    {
      name: 'customer_contact', label: 'Kontak pelanggan', type: 'string', required: false, max: 60,
      ask: 'Nomor WhatsApp pelanggan? Berguna untuk pengingat tagihan. Boleh dilewati.',
    },
    {
      name: 'product_id', label: 'Produk dari stok', type: 'ref', required: false,
      refTable: 'products', refLabelColumn: 'name', optionsFrom: 'products',
      ask: 'Produk ini terhubung ke stok yang mana? Kalau dipilih, stok otomatis berkurang. Boleh dilewati.',
    },
    {
      name: 'qty', label: 'Jumlah', type: 'number', required: false, min: 0,
      ask: 'Berapa jumlah/qty produknya?',
    },
  ],
}

// ---------- PRODUK / STOK ----------
const PRODUCT: EntitySpec = {
  entity: 'produk',
  label: 'Produk / Stok',
  module: 'produk',
  table: 'products',
  allow: ['create', 'update', 'delete'],
  confirmOnCreate: false, // membuat produk baru reversible & tidak langsung menyentuh uang
  fields: [
    {
      name: 'name', label: 'Nama produk', type: 'string', required: true, max: 120,
      ask: 'Nama produknya apa?',
    },
    {
      name: 'unit', label: 'Satuan', type: 'enum', required: true,
      optionsFrom: 'units', fallback: 'pcs',
      ask: 'Satuannya apa (pcs, kg, liter, dus)?',
    },
    {
      name: 'price', label: 'Harga jual (Rp)', type: 'money', required: true, financial: true, min: 0,
      ask: 'Harga jualnya berapa?',
    },
    {
      name: 'cost_price', label: 'Harga modal / HPP (Rp)', type: 'money', required: false, financial: true, min: 0,
      ask: 'Harga modal (HPP) per satuan berapa? Penting untuk hitung margin — boleh dilewati.',
    },
    {
      name: 'stock', label: 'Stok saat ini', type: 'number', required: true, min: 0,
      ask: 'Stok sekarang ada berapa?',
    },
    {
      name: 'min_stock', label: 'Stok minimum', type: 'number', required: false, min: 0, fallback: 0,
      ask: 'Stok minimum berapa? Dipakai untuk peringatan otomatis stok menipis. Boleh dilewati.',
    },
    {
      name: 'category', label: 'Kategori produk', type: 'enum', required: false,
      optionsFrom: 'product_categories',
      ask: 'Masuk kategori produk apa? Boleh dilewati.',
    },
    {
      name: 'supplier_id', label: 'Pemasok', type: 'ref', required: false,
      refTable: 'suppliers', refLabelColumn: 'name', optionsFrom: 'suppliers',
      ask: 'Pemasoknya siapa? Boleh dilewati.',
    },
  ],
}

// ---------- KARYAWAN ----------
const EMPLOYEE: EntitySpec = {
  entity: 'karyawan',
  label: 'Data Karyawan',
  module: 'hr',
  table: 'employees',
  allow: ['create', 'update', 'delete'],
  confirmOnCreate: true, // gaji = data finansial
  fields: [
    {
      name: 'name', label: 'Nama', type: 'string', required: true, max: 120,
      ask: 'Nama karyawannya siapa?',
    },
    {
      name: 'salary_type', label: 'Tipe gaji', type: 'enum', required: true,
      enumValues: ['bulanan', 'harian'],
      ask: 'Gajinya bulanan atau harian (per hari hadir)?',
    },
    {
      name: 'salary_amount', label: 'Nominal gaji (Rp)', type: 'money', required: true, financial: true, min: 1,
      ask: 'Nominal gajinya berapa?',
    },
    {
      name: 'role', label: 'Jabatan', type: 'string', required: false, max: 80,
      ask: 'Jabatannya apa (kasir, produksi, kurir)? Boleh dilewati.',
    },
    {
      name: 'phone', label: 'No. HP / WA', type: 'string', required: false, max: 30,
      ask: 'Nomor HP/WhatsApp-nya berapa? Boleh dilewati.',
    },
    {
      name: 'join_date', label: 'Tanggal bergabung', type: 'date', required: false,
      ask: 'Tanggal mulai bergabung kapan? Boleh dilewati.',
    },
    {
      name: 'note', label: 'Catatan', type: 'text', required: false, max: 300,
      ask: 'Ada catatan tambahan? Boleh dilewati.',
    },
  ],
}

// ---------- ABSENSI ----------
const ATTENDANCE: EntitySpec = {
  entity: 'absensi',
  label: 'Absensi & Cuti',
  module: 'hr',
  table: 'attendances',
  allow: ['create', 'update'],
  confirmOnCreate: false,
  fields: [
    {
      name: 'employee_id', label: 'Karyawan', type: 'ref', required: true,
      refTable: 'employees', refLabelColumn: 'name', optionsFrom: 'employees',
      ask: 'Absensi untuk karyawan siapa?',
    },
    {
      name: 'date', label: 'Tanggal', type: 'date', required: true, fallback: 'today',
      ask: 'Untuk tanggal berapa?',
    },
    {
      name: 'status', label: 'Status kehadiran', type: 'enum', required: true,
      enumValues: ['hadir', 'izin', 'sakit', 'cuti', 'alpa'],
      ask: 'Statusnya apa: hadir, izin, sakit, cuti, atau alpa?',
    },
    {
      name: 'note', label: 'Catatan', type: 'string', required: false, max: 200,
      ask: 'Ada keterangan tambahan? Boleh dilewati.',
    },
  ],
}

// ---------- KPI: KRITERIA ----------
const KPI_CRITERIA: EntitySpec = {
  entity: 'kpi_kriteria',
  label: 'Kriteria KPI',
  module: 'hr',
  table: 'kpi_criteria',
  allow: ['create', 'update', 'delete'],
  confirmOnCreate: false,
  fields: [
    {
      name: 'name', label: 'Nama kriteria', type: 'string', required: true, max: 120,
      ask: 'Nama kriteria penilaiannya apa (mis. Kedisiplinan)?',
    },
    {
      name: 'weight', label: 'Bobot (%)', type: 'number', required: true, min: 0, max: 100,
      ask: 'Bobotnya berapa persen (0-100)?',
    },
    {
      name: 'source', label: 'Sumber nilai', type: 'enum', required: true,
      enumValues: ['kehadiran', 'tugas', 'manual'],
      ask: 'Nilainya diambil otomatis dari kehadiran, dari papan tugas, atau diisi manual?',
    },
  ],
}

// ---------- KPI: SKOR ----------
const KPI_SCORE: EntitySpec = {
  entity: 'kpi_skor',
  label: 'Skor KPI',
  module: 'hr',
  table: 'kpi_scores',
  allow: ['create', 'update'],
  confirmOnCreate: false,
  fields: [
    {
      name: 'employee_id', label: 'Karyawan', type: 'ref', required: true,
      refTable: 'employees', refLabelColumn: 'name', optionsFrom: 'employees',
      ask: 'Skor KPI untuk karyawan siapa?',
    },
    {
      name: 'criteria_id', label: 'Kriteria', type: 'ref', required: true,
      refTable: 'kpi_criteria', refLabelColumn: 'name',
      ask: 'Untuk kriteria penilaian yang mana?',
    },
    {
      name: 'period', label: 'Periode (YYYY-MM)', type: 'string', required: true, max: 7,
      ask: 'Untuk periode bulan apa (format YYYY-MM)?',
    },
    {
      name: 'score', label: 'Nilai (0-100)', type: 'number', required: true, min: 0, max: 100,
      ask: 'Nilainya berapa (0 sampai 100)?',
    },
  ],
}

// ---------- SUPPLIER ----------
const SUPPLIER: EntitySpec = {
  entity: 'pemasok',
  label: 'Pemasok',
  module: 'produk',
  table: 'suppliers',
  allow: ['create', 'update', 'delete'],
  confirmOnCreate: false,
  fields: [
    { name: 'name', label: 'Nama pemasok', type: 'string', required: true, max: 120, ask: 'Nama pemasoknya apa?' },
    { name: 'phone', label: 'Telepon / WhatsApp', type: 'string', required: false, max: 30, ask: 'Nomor teleponnya berapa? Boleh dilewati.' },
    { name: 'email', label: 'Email', type: 'string', required: false, max: 120, ask: 'Emailnya apa? Boleh dilewati.' },
    { name: 'address', label: 'Alamat', type: 'text', required: false, max: 300, ask: 'Alamatnya di mana? Boleh dilewati.' },
    { name: 'note', label: 'Catatan', type: 'text', required: false, max: 300, ask: 'Ada catatan (mis. termin pembayaran)? Boleh dilewati.' },
  ],
}

// ---------- PURCHASE ORDER ----------
const PURCHASE_ORDER: EntitySpec = {
  entity: 'purchase_order',
  label: 'Purchase Order',
  module: 'produk',
  table: 'purchase_orders',
  allow: ['create', 'update'],
  confirmOnCreate: true, // menyentuh uang & stok
  fields: [
    {
      name: 'product_id', label: 'Produk', type: 'ref', required: true,
      refTable: 'products', refLabelColumn: 'name', optionsFrom: 'products',
      ask: 'Mau pesan produk yang mana?',
    },
    { name: 'qty', label: 'Jumlah', type: 'number', required: true, min: 1, ask: 'Berapa banyak yang dipesan?' },
    {
      name: 'unit_price', label: 'Harga satuan (Rp)', type: 'money', required: true, financial: true, min: 0,
      ask: 'Harga per satuannya berapa?',
    },
    {
      name: 'supplier_id', label: 'Pemasok', type: 'ref', required: false,
      refTable: 'suppliers', refLabelColumn: 'name', optionsFrom: 'suppliers',
      ask: 'Pesan ke pemasok yang mana? Boleh dilewati.',
    },
    { name: 'expected_date', label: 'Perkiraan tiba', type: 'date', required: false, ask: 'Perkiraan barang tiba kapan? Boleh dilewati.' },
    { name: 'note', label: 'Catatan', type: 'string', required: false, max: 200, ask: 'Ada catatan untuk pemasok? Boleh dilewati.' },
  ],
}

// ---------- TUGAS (papan tugas operasional) ----------
const TASK: EntitySpec = {
  entity: 'tugas',
  label: 'Papan Tugas',
  module: 'operasional',
  table: 'tasks',
  allow: ['create', 'update', 'delete'],
  confirmOnCreate: false,
  fields: [
    { name: 'title', label: 'Judul tugas', type: 'string', required: true, max: 160, ask: 'Tugasnya apa?' },
    {
      name: 'assignee_id', label: 'Penanggung jawab', type: 'ref', required: false,
      refTable: 'employees', refLabelColumn: 'name', optionsFrom: 'employees',
      ask: 'Ditugaskan ke siapa? Boleh dilewati.',
    },
    { name: 'due_date', label: 'Tenggat', type: 'date', required: false, ask: 'Tenggatnya kapan? Boleh dilewati.' },
    {
      name: 'status', label: 'Status', type: 'enum', required: false,
      enumValues: ['todo', 'progress', 'done'], fallback: 'todo',
      ask: 'Statusnya apa (belum, sedang dikerjakan, selesai)?',
    },
    { name: 'note', label: 'Catatan', type: 'text', required: false, max: 300, ask: 'Ada detail tambahan? Boleh dilewati.' },
  ],
}

// ---------- PENGINGAT ----------
const REMINDER: EntitySpec = {
  entity: 'pengingat',
  label: 'Pengingat',
  module: 'operasional',
  table: 'reminders',
  allow: ['create', 'delete'],
  confirmOnCreate: false,
  fields: [
    { name: 'title', label: 'Judul', type: 'string', required: true, max: 160, ask: 'Mau diingatkan tentang apa?' },
    { name: 'remind_at', label: 'Tanggal & jam', type: 'date', required: true, ask: 'Diingatkan kapan (tanggal dan jam)?' },
    { name: 'note', label: 'Catatan', type: 'string', required: false, max: 200, ask: 'Ada catatan tambahan? Boleh dilewati.' },
  ],
}

export const ENTITY_SPECS: Record<string, EntitySpec> = {
  transaksi: TRANSACTION,
  produk: PRODUCT,
  karyawan: EMPLOYEE,
  absensi: ATTENDANCE,
  kpi_kriteria: KPI_CRITERIA,
  kpi_skor: KPI_SCORE,
  pemasok: SUPPLIER,
  purchase_order: PURCHASE_ORDER,
  tugas: TASK,
  pengingat: REMINDER,
}

export const ENTITY_NAMES = Object.keys(ENTITY_SPECS)

export function getEntitySpec(entity: string): EntitySpec | null {
  return ENTITY_SPECS[String(entity || '').toLowerCase().trim()] ?? null
}
