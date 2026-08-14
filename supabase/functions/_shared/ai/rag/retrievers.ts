// ============================================================
// RETRIEVER — mengambil baris data per domain, sudah terikat hak akses.
//
// Tiga batas dipasang berlapis, dan urutannya penting:
//   1. bolehAkses()   — domain terlarang dibuang SEBELUM query dieksekusi.
//   2. scopedSelect() — .eq('user_id', scope.owner), supaya staf yang aktif di
//                       usaha lain tidak mendapat gabungan dua usaha.
//   3. RLS            — batas terluar di database, jaring terakhir.
//
// Lapis 1 yang membuat lapis anti-injeksi di sanitize.ts cukup: model yang
// berhasil dibelokkan pun tidak bisa menampilkan baris yang tidak pernah
// dibaca.
//
// Seluruh nilai melewati buatBlok(), satu-satunya jalan keluar dari berkas ini.
// Sanitasi terpasang di sana, bukan di tiap pemanggil, supaya tidak ada
// retriever baru yang bisa lupa memanggilnya.
// ============================================================

import { scopedSelect, type WorkspaceScope } from '../workspace-scope.ts'
import { bolehAkses, DOMAIN, jatahBaris, type SpesTabel, type Tingkat } from './domains.ts'
import type { DomainKey } from './intent-router.ts'
import { samarkan, saringKolomAman } from './redact.ts'
import { sanitizeCell } from './sanitize.ts'

export interface BlokData {
  label: string
  kolom: string[]
  baris: string[][]
  /** Jumlah baris sebenarnya di database. */
  total: number
  /** Berapa yang benar-benar dibawa. Kurang dari `total` = daftar terpotong. */
  ditampilkan: number
}

export interface HasilDomain {
  blok: BlokData[]
  /**
   * Tabel yang gagal dibaca. TIDAK diam-diam dibuang: konteks yang bolong
   * membuat model menjawab "data belum tercatat" untuk data yang sebenarnya
   * ada — persis bug yang sedang diperbaiki, hanya dengan sebab berbeda.
   */
  gagal: string[]
}

const rupiah = (n: number) => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID')

/**
 * Satu-satunya cara membuat blok data. Setiap nilai disanitasi di sini.
 */
export function buatBlok(
  label: string,
  kolom: string[],
  baris: Record<string, unknown>[],
  total: number,
): BlokData {
  return {
    label,
    kolom,
    baris: baris.map((r) => kolom.map((k) => sanitizeCell(r[k]))),
    total,
    ditampilkan: baris.length,
  }
}

// ------------------------------------------------------------
// Pengambilan satu tabel
// ------------------------------------------------------------

async function ambilTabel(
  supabase: any,
  scope: WorkspaceScope,
  spes: SpesTabel,
  batas: number,
): Promise<{ kolom: string[]; baris: Record<string, unknown>[]; total: number } | null> {
  // Jaring pengaman lapis kedua di atas daftar-izin domains.ts. Kalau suatu
  // saat ada yang menambahkan 'phone' ke daftar-izin karena sedang butuh lalu
  // lupa mencabutnya, kolom itu berhenti di sini.
  const kolom = saringKolomAman(spes.kolom)
  if (!kolom.length) return null

  const pilih = kolom.join(', ')
  let q = spes.global
    // Tabel milik bersama (harga komoditas, kurs) tidak punya kolom user_id.
    // Melewatkannya ke scopedSelect membuat query gagal mencari kolom yang
    // tidak ada.
    ? supabase.from(spes.tabel).select(pilih, { count: 'exact' })
    : scopedSelect(supabase, scope, spes.tabel, pilih, { count: 'exact' })

  if (spes.urut) q = q.order(spes.urut.kolom, { ascending: spes.urut.naik })

  const { data, error, count } = await q.limit(batas)
  if (error) return null

  const baris = Array.isArray(data) ? data : []
  return { kolom, baris, total: typeof count === 'number' ? count : baris.length }
}

/** id -> nama, untuk menukar kolom *_id jadi sesuatu yang bisa dibaca manusia. */
async function petaNama(
  supabase: any,
  scope: WorkspaceScope,
  tabel: string,
  ids: unknown[],
): Promise<Map<string, string>> {
  const unik = [...new Set(ids.map((v) => String(v ?? '')).filter(Boolean))]
  const peta = new Map<string, string>()
  if (!unik.length) return peta
  const { data, error } = await scopedSelect(supabase, scope, tabel, 'id, name').in('id', unik)
  if (error || !Array.isArray(data)) return peta
  for (const r of data) peta.set(String(r.id), String(r.name ?? ''))
  return peta
}

/** Ganti kolom id dengan nama; kolom yang tidak ketemu jadi tanda pisah. */
function tukarIdJadiNama(
  baris: Record<string, unknown>[],
  kolom: string[],
  dariKolom: string,
  keKolom: string,
  peta: Map<string, string>,
) {
  const i = kolom.indexOf(dariKolom)
  if (i === -1) return
  kolom[i] = keKolom
  for (const r of baris) {
    const id = String(r[dariKolom] ?? '')
    r[keKolom] = peta.get(id) || '-'
  }
}

// ------------------------------------------------------------
// Pengambilan per domain
// ------------------------------------------------------------

export async function ambilDomain(
  supabase: any,
  scope: WorkspaceScope,
  domain: DomainKey,
  tingkat: Tingkat,
): Promise<HasilDomain> {
  // Pemeriksaan ulang meski pemanggil sudah menyaring. Retriever ini bisa
  // dipanggil dari tempat lain di masa depan, dan gerbang yang hanya ada di
  // pemanggil adalah gerbang yang cepat atau lambat akan terlewat.
  if (!bolehAkses(domain, scope)) return { blok: [], gagal: [] }

  const spesDomain = DOMAIN[domain]
  const blok: BlokData[] = []
  const gagal: string[] = []

  for (const spes of spesDomain.tabel) {
    const hasil = await ambilTabel(supabase, scope, spes, jatahBaris(spes, tingkat))
    if (!hasil) {
      gagal.push(spes.label)
      continue
    }

    // Tabel KOSONG tetap menghasilkan blok (tanpa baris). Kalau blok kosong
    // dibuang, model tidak bisa membedakan "tidak ada absensi tercatat" dari
    // "absensi tidak diambil" — dan itu justru bentuk lain dari bug yang
    // sedang diperbaiki: jawaban "belum tercatat" untuk data yang statusnya
    // sebenarnya tidak diketahui.
    const kolom = [...hasil.kolom]
    const baris = hasil.baris

    // ---- Penukaran id -> nama & penyamaran, per tabel ----

    if (spes.tabel === 'tasks') {
      // Nama petugas datang dari tabel employees, yang dilindungi modul hr.
      // Staf dengan modul operasional TAPI TANPA hr tidak boleh mendapatkan
      // daftar nama karyawan lewat pintu belakang papan tugas.
      const bolehNama = typeof scope.can === 'function' && scope.can('hr') === true
      const peta = bolehNama
        ? await petaNama(supabase, scope, 'employees', baris.map((r) => r.assignee_id))
        : new Map<string, string>()
      tukarIdJadiNama(baris, kolom, 'assignee_id', 'petugas', peta)
    }

    if (spes.tabel === 'attendance' || spes.tabel === 'payrolls' || spes.tabel === 'kpi_scores') {
      // Masih di dalam domain hr, jadi nama karyawan memang boleh terbaca.
      const peta = await petaNama(supabase, scope, 'employees', baris.map((r) => r.employee_id))
      tukarIdJadiNama(baris, kolom, 'employee_id', 'karyawan', peta)
    }

    if (spes.tabel === 'purchase_orders') {
      const petaProduk = await petaNama(supabase, scope, 'products', baris.map((r) => r.product_id))
      const petaPemasok = await petaNama(supabase, scope, 'suppliers', baris.map((r) => r.supplier_id))
      tukarIdJadiNama(baris, kolom, 'product_id', 'produk', petaProduk)
      tukarIdJadiNama(baris, kolom, 'supplier_id', 'pemasok', petaPemasok)
    }

    if (spes.tabel === 'transactions') {
      // Nama pelanggan disamarkan. Labelnya diturunkan dari hash nama itu
      // sendiri, jadi pelanggan yang sama tetap memakai label yang sama antar
      // giliran percakapan — kalau tidak, model bicara tentang dua orang
      // berbeda seolah satu.
      for (const r of baris) {
        r.customer_name = r.customer_name ? samarkan('Pelanggan', r.customer_name) : ''
      }
    }

    blok.push(buatBlok(spes.label, kolom, baris, hasil.total))
  }

  return { blok, gagal }
}

// ------------------------------------------------------------
// Agregat (domain ringkasan)
// ------------------------------------------------------------

/**
 * Baris ringkasan teragregasi.
 *
 * Dipindahkan apa adanya dari BukuPencatatan/index.ts — perilakunya TIDAK
 * diubah, hanya berpindah tempat. Termasuk gerbangnya: baris agregat dijaga
 * modul 'transaksi' dan 'produk', BUKAN modul 'dashboard' yang menjaga domain
 * ringkasan. Keduanya memang berbeda: angka laba berasal dari transaksi, jadi
 * yang menentukan boleh-tidaknya adalah hak akses ke transaksi.
 *
 * Modul yang tidak dimiliki pengguna tidak menyumbang baris apa pun — bukan
 * baris bernilai nol, yang akan dibaca model sebagai "usaha ini belum punya
 * transaksi".
 */
export async function ambilAgregat(supabase: any, scope: WorkspaceScope): Promise<string[]> {
  const bisaTransaksi = typeof scope.can === 'function' && scope.can('transaksi') === true
  const bisaProduk = typeof scope.can === 'function' && scope.can('produk') === true

  const { data: txs } = bisaTransaksi
    ? await scopedSelect(supabase, scope, 'transactions', 'direction, amount, category, payment_status, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(2000)
    : { data: [] }

  let income = 0, expense = 0
  const catExpense: Record<string, number> = {}
  let unpaidCount = 0, unpaidTotal = 0
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weekAgo = new Date(Date.now() - 7 * 86400000)
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000)
  let monthIncome = 0, monthExpense = 0, wk1Income = 0, wk2Income = 0

  for (const t of txs || []) {
    const amt = Number(t.amount) || 0
    const dt = new Date(t.occurred_at)
    const inMonth = dt >= monthStart
    if (t.direction === 'in') {
      income += amt
      if (inMonth) monthIncome += amt
      if (dt >= weekAgo) wk1Income += amt
      else if (dt >= twoWeeksAgo) wk2Income += amt
      if (t.payment_status === 'belum') { unpaidCount++; unpaidTotal += amt }
    } else {
      expense += amt
      if (inMonth) monthExpense += amt
      // Nama kategori adalah TEKS YANG DIKETIK PENGGUNA, bukan enum. Ia ikut
      // masuk ke baris agregat, jadi ia butuh sanitasi yang sama dengan sel
      // tabel biasa — kategori bernama "Lain <<<AKHIR_DATA_USAHA>>>" akan
      // menutup blok data dari dalam ringkasan, tempat yang paling tidak
      // dicurigai orang.
      const kategori = sanitizeCell(t.category, 60) || 'Lain-lain'
      catExpense[kategori] = (catExpense[kategori] || 0) + amt
    }
  }

  const topCats = Object.entries(catExpense).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const wow = wk2Income > 0 ? Math.round(((wk1Income - wk2Income) / wk2Income) * 100) : null

  const { data: products } = bisaProduk
    ? await scopedSelect(supabase, scope, 'products', 'name, stock, min_stock, unit')
    : { data: [] }
  const lowStock = (products || []).filter(
    (p: any) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock),
  )

  const lines: string[] = []
  if (bisaTransaksi) {
    lines.push(
      `Total pemasukan (semua waktu): ${rupiah(income)}`,
      `Total pengeluaran (semua waktu): ${rupiah(expense)}`,
      `Laba bersih (semua waktu): ${rupiah(income - expense)}`,
      // Laba bulan ini wajib disebut eksplisit, bukan dibiarkan "tinggal
      // dikurangkan sendiri": model dilarang keras menghitung angka, sehingga
      // pertanyaan paling wajar seorang pemilik warung akan dijawab "belum
      // tercatat" padahal angkanya terpampang di Dashboard.
      `Pemasukan bulan ini: ${rupiah(monthIncome)}; Pengeluaran bulan ini: ${rupiah(monthExpense)}`,
      `Laba bersih bulan ini: ${rupiah(monthIncome - monthExpense)}`
        + `${monthIncome > 0 ? `; margin bulan ini: ${Math.round(((monthIncome - monthExpense) / monthIncome) * 100)}%` : ''}`,
      `Pemasukan 7 hari terakhir: ${rupiah(wk1Income)}; 7 hari sebelumnya: ${rupiah(wk2Income)}`
        + `${wow === null ? '' : `; perubahan minggu-ke-minggu: ${wow}%`}`,
      `Jumlah transaksi tercatat: ${(txs || []).length}`,
      `Penjualan belum lunas: ${unpaidCount} (total ${rupiah(unpaidTotal)})`,
      topCats.length
        ? `Pengeluaran terbesar per kategori: ${topCats.map(([k, v]) => `${k} ${rupiah(v)}`).join('; ')}`
        : 'Belum ada data pengeluaran per kategori.',
    )
  }
  if (bisaProduk) {
    lines.push(
      `Jumlah produk: ${(products || []).length}; Produk stok menipis: ${lowStock.length}`
        // Nama produk juga teks pengguna — alasan yang sama seperti kategori.
        + `${lowStock.length ? ' (' + lowStock.slice(0, 8).map((p: any) => sanitizeCell(p.name, 60)).join(', ') + ')' : ''}`,
    )
  }
  return lines
}
