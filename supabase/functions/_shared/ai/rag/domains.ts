// ============================================================
// PETA DOMAIN — tabel, kolom, hak akses, dan jatah baris.
//
// Berkas ini adalah DAFTAR-IZIN. Tidak ada satu pun select('*') di lapisan RAG;
// setiap kolom yang boleh sampai ke Gemini disebut satu per satu di sini.
// Konsekuensinya disengaja: kolom baru yang ditambahkan ke tabel di masa depan
// TIDAK otomatis ikut terkirim. Seseorang harus menuliskannya, dan tulisan itu
// terlihat di code review.
//
// Semua nama kolom di bawah sudah dicocokkan dengan supabase/migration_*.sql,
// termasuk yang ditambahkan migrasi belakangan (transactions.payment_status
// dari migration_invoice.sql, products.cost_price, staff_members.name).
//
// GERBANG HAK AKSES ada di sini juga, dan letaknya penting: ia berjalan SEBELUM
// satu query pun dieksekusi. Data yang tidak boleh dilihat tidak pernah dibaca,
// jadi injeksi prompt yang berhasil membelokkan model sekalipun tidak punya
// baris untuk dibocorkan.
// ============================================================

import type { ModuleKey, WorkspaceScope } from '../workspace-scope.ts'
import type { DomainKey } from './intent-router.ts'
import { SEMUA_DOMAIN } from './intent-router.ts'

export interface SpesTabel {
  /** Nama tabel di database. */
  tabel: string
  /** Judul blok di prompt, mis. "PRODUK". */
  label: string
  /** Daftar-izin kolom. Tidak pernah '*'. */
  kolom: string[]
  /** Kolom pengurut + arahnya. Tanpa ini, "50 baris pertama" tidak bermakna. */
  urut?: { kolom: string; naik: boolean }
  /** Tabel inti domain — dapat jatah baris terbesar saat domainnya jadi fokus. */
  utama?: boolean
  /** Jatah khusus saat fokus, menimpa JATAH.FOKUS_UTAMA. */
  jatahFokus?: number
  /**
   * Tabel milik bersama, tanpa kolom user_id (harga komoditas, kurs, sinyal
   * makro). TIDAK boleh lewat scopedSelect — filter .eq('user_id', ...) akan
   * mencari kolom yang tidak ada dan query-nya gagal.
   */
  global?: boolean
}

export interface SpesDomain {
  /** Modul yang harus dimiliki pengguna. null = tidak dibatasi modul. */
  modul: ModuleKey | null
  /** Hanya pemilik usaha. Staf ditolak berapa pun modulnya. */
  ownerOnly?: boolean
  tabel: SpesTabel[]
}

// ------------------------------------------------------------
// Jatah baris
// ------------------------------------------------------------

export const JATAH = {
  /** Tabel inti dari domain yang sedang ditanyakan. */
  FOKUS_UTAMA: 50,
  /** Tabel pelengkap di dalam domain fokus. */
  FOKUS_SEKUNDER: 10,
  /** Seluruh tabel di domain pendukung. */
  PENDUKUNG: 10,
} as const

export type Tingkat = 'fokus' | 'pendukung'

export function jatahBaris(spes: SpesTabel, tingkat: Tingkat): number {
  if (tingkat === 'pendukung') return JATAH.PENDUKUNG
  if (!spes.utama) return JATAH.FOKUS_SEKUNDER
  return spes.jatahFokus ?? JATAH.FOKUS_UTAMA
}

// ------------------------------------------------------------
// Peta domain
// ------------------------------------------------------------

export const DOMAIN: Record<DomainKey, SpesDomain> = {
  ringkasan: {
    modul: 'dashboard',
    tabel: [
      {
        tabel: 'sales_targets',
        label: 'TARGET PENJUALAN',
        kolom: ['name', 'amount', 'start_date', 'deadline', 'is_active'],
        urut: { kolom: 'created_at', naik: false },
      },
    ],
  },

  operasional: {
    modul: 'operasional',
    tabel: [
      {
        tabel: 'tasks',
        label: 'PAPAN TUGAS',
        // assignee_id ikut supaya retriever bisa menukarnya jadi nama karyawan
        // — TAPI hanya bila pengguna juga punya modul hr. Lihat retrievers.ts.
        kolom: ['title', 'status', 'priority', 'due_date', 'assignee_id'],
        urut: { kolom: 'due_date', naik: true },
        utama: true,
      },
      {
        tabel: 'reminders',
        label: 'PENGINGAT',
        // wa_number sengaja TIDAK ada di sini: nomor WhatsApp pribadi.
        kolom: ['title', 'remind_at', 'status'],
        urut: { kolom: 'remind_at', naik: true },
      },
    ],
  },

  transaksi: {
    modul: 'transaksi',
    tabel: [
      {
        tabel: 'transactions',
        label: 'TRANSAKSI TERBARU',
        // TIDAK ada: raw (baris mutasi bank mentah, bisa memuat nomor
        // rekening), customer_contact (nomor HP pelanggan), source_ref,
        // receipt_url. customer_name ikut tapi disamarkan di retriever.
        kolom: [
          'occurred_at', 'direction', 'amount', 'category',
          'description', 'channel', 'payment_status', 'due_date', 'customer_name',
        ],
        urut: { kolom: 'occurred_at', naik: false },
        utama: true,
        // Lebih kecil dari 50: transaksi sudah terwakili agregat di domain
        // ringkasan, dan barisnya paling banyak memakan token karena ada
        // deskripsi teks bebas.
        jatahFokus: 30,
      },
    ],
  },

  produk: {
    modul: 'produk',
    tabel: [
      {
        tabel: 'products',
        label: 'PRODUK',
        kolom: ['name', 'sku', 'category', 'unit', 'stock', 'min_stock', 'price', 'cost_price'],
        // Diurut nama, bukan tanggal buat: pemilik mencari "indomie", bukan
        // "produk yang saya tambahkan Selasa lalu".
        urut: { kolom: 'name', naik: true },
        utama: true,
      },
      {
        tabel: 'purchase_orders',
        label: 'PURCHASE ORDER',
        kolom: ['po_number', 'status', 'qty', 'unit_price', 'expected_date', 'product_id', 'supplier_id'],
        urut: { kolom: 'created_at', naik: false },
      },
      {
        tabel: 'stock_opnames',
        label: 'STOCK OPNAME',
        kolom: ['opname_number', 'status', 'posted_at'],
        urut: { kolom: 'created_at', naik: false },
      },
      {
        tabel: 'suppliers',
        label: 'PEMASOK',
        // phone/email/address sengaja tidak ada — nama saja cukup untuk PO.
        kolom: ['name'],
        urut: { kolom: 'name', naik: true },
      },
      {
        tabel: 'ingredients',
        label: 'BAHAN BAKU',
        kolom: ['name', 'type', 'unit', 'price_per_unit'],
        urut: { kolom: 'name', naik: true },
      },
    ],
  },

  hr: {
    modul: 'hr',
    tabel: [
      {
        tabel: 'employees',
        label: 'KARYAWAN',
        // phone TIDAK ikut. salary_amount ikut — ini memang modul gaji, dan
        // staf tanpa modul hr tidak pernah sampai ke sini.
        kolom: ['name', 'role', 'salary_type', 'salary_amount', 'join_date', 'status'],
        urut: { kolom: 'name', naik: true },
        utama: true,
      },
      {
        tabel: 'attendance',
        label: 'ABSENSI',
        kolom: ['date', 'status', 'employee_id'],
        urut: { kolom: 'date', naik: false },
      },
      {
        tabel: 'payrolls',
        label: 'PENGGAJIAN',
        kolom: ['period', 'base_amount', 'bonus', 'deduction', 'total', 'employee_id'],
        urut: { kolom: 'period', naik: false },
      },
      {
        tabel: 'kpi_scores',
        label: 'SKOR KPI',
        kolom: ['period', 'score', 'employee_id'],
        urut: { kolom: 'period', naik: false },
      },
    ],
  },

  analisis: {
    modul: 'analisis',
    tabel: [
      {
        tabel: 'commodity_prices',
        label: 'HARGA BAHAN POKOK',
        kolom: ['commodity_key', 'variant_name', 'price', 'prev_price', 'price_date', 'unit', 'source_name'],
        urut: { kolom: 'price_date', naik: false },
        utama: true,
        global: true,
      },
      {
        tabel: 'macro_signals',
        label: 'SINYAL ARAH HARGA',
        kolom: ['commodity_label', 'direction', 'est_pct_min', 'est_pct_max', 'confidence'],
        urut: { kolom: 'run_date', naik: false },
        global: true,
      },
      {
        tabel: 'exchange_rates',
        label: 'KURS',
        kolom: ['rate_date', 'usd_idr', 'source'],
        urut: { kolom: 'rate_date', naik: false },
        global: true,
      },
    ],
  },

  lainnya: {
    // Tidak ada modul yang bisa membuka domain ini — hanya status pemilik.
    // Sejalan dengan klien: SECTION_MODULE.lainnya = null + OWNER_ONLY_KEYS
    // di src/lib/rbac.js. Karena itu tidak ada perubahan skema atau RPC yang
    // dibutuhkan; my_modules() tetap seperti apa adanya.
    modul: null,
    ownerOnly: true,
    tabel: [
      {
        tabel: 'staff_members',
        label: 'STAF & HAK AKSES',
        // email TIDAK ikut (PII). Kolom `name` sudah ada sejak
        // migration yang menambahkannya, dan itu cukup untuk menjawab
        // "siapa saja yang punya akses apa".
        kolom: ['name', 'modules', 'status'],
        urut: { kolom: 'created_at', naik: false },
        utama: true,
      },
      {
        tabel: 'audit_logs',
        label: 'AUDIT LOG',
        // `changed` TIDAK ikut: isinya salinan mentah baris sebelum/sesudah
        // diubah, jadi ia bisa memuat kolom PII dari tabel APA PUN — termasuk
        // yang sudah susah payah dikecualikan di atas.
        kolom: ['table_name', 'action', 'created_at'],
        urut: { kolom: 'created_at', naik: false },
      },
      {
        tabel: 'profiles',
        label: 'PROFIL USAHA',
        // owner_name & phone tidak ikut.
        kolom: ['business_name', 'business_type'],
      },
      {
        tabel: 'categories',
        label: 'KATEGORI',
        kolom: ['name', 'direction'],
        urut: { kolom: 'name', naik: true },
      },
      {
        tabel: 'channels',
        label: 'CHANNEL',
        kolom: ['value', 'label'],
        urut: { kolom: 'value', naik: true },
      },
    ],
  },
}

// ------------------------------------------------------------
// Gerbang hak akses
// ------------------------------------------------------------

/**
 * Boleh atau tidak sebuah domain dibaca oleh pemanggil.
 *
 * GAGAL TERTUTUP. Untuk domain ownerOnly, syaratnya `scope.isOwner === true`
 * secara harfiah — bukan truthy, bukan "bukan staf". Pola yang sama dipakai
 * canManageUsers() di src/lib/rbac.js, dan alasannya sama: nilai yang belum
 * termuat (undefined) harus berarti TIDAK, bukan diam-diam berarti ya.
 */
export function bolehAkses(domain: DomainKey, scope: WorkspaceScope): boolean {
  const spes = DOMAIN[domain]
  if (!spes) return false
  if (spes.ownerOnly) return scope.isOwner === true
  if (!spes.modul) return true
  return typeof scope.can === 'function' && scope.can(spes.modul) === true
}

/** Buang domain yang tidak boleh dibaca, pertahankan urutan aslinya. */
export function saringDomain(daftar: readonly DomainKey[], scope: WorkspaceScope): DomainKey[] {
  return daftar.filter((d) => bolehAkses(d, scope))
}

/** Semua kolom yang dideklarasikan seluruh domain — dipakai test invarian. */
export function semuaKolomDideklarasikan(): { domain: DomainKey; tabel: string; kolom: string }[] {
  const hasil: { domain: DomainKey; tabel: string; kolom: string }[] = []
  for (const domain of SEMUA_DOMAIN) {
    for (const t of DOMAIN[domain].tabel) {
      for (const k of t.kolom) hasil.push({ domain, tabel: t.tabel, kolom: k })
    }
  }
  return hasil
}
