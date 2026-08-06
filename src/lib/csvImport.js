import Papa from 'papaparse'
import { categorize, guessDirection } from './categorize'

// Parse angka Rupiah dari berbagai format: "1.250.000", "1,250,000", "Rp 35.000", "(50.000)"
export function parseAmount(val) {
  if (val == null) return 0
  let s = String(val).trim()
  if (!s) return 0
  const negative = /^\(.*\)$/.test(s) || s.includes('-')
  s = s.replace(/rp/gi, '').replace(/[()]/g, '').trim()
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes(',')) {
    const parts = s.split(',')
    if (parts[parts.length - 1].length === 2) s = s.replace(/,/g, '.')
    else s = s.replace(/,/g, '')
  } else {
    s = s.replace(/\./g, '')
  }
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''))
  if (isNaN(n)) return 0
  return Math.abs(n) * (negative ? -1 : 1)
}

const lc = (s) => (s || '').toString().toLowerCase().trim()

function findCol(headers, candidates) {
  const h = headers.map(lc)
  for (const c of candidates) {
    const idx = h.findIndex((x) => x.includes(c))
    if (idx !== -1) return headers[idx]
  }
  return null
}

const COLS = {
  date: ['tanggal', 'tgl', 'date', 'waktu', 'time', 'transaction date', 'posting', 'order created', 'waktu pesanan'],
  desc: ['keterangan', 'deskripsi', 'description', 'uraian', 'remark', 'narasi', 'merchant', 'nama produk',
    'product name', 'catatan', 'no. pesanan', 'no pesanan', 'order id', 'nomor pesanan', 'nama barang'],
  amount: ['nominal', 'jumlah', 'amount', 'nilai', 'total', 'value', 'total penghasilan', 'penghasilan',
    'total pembayaran', 'subtotal', 'harga', 'income', 'settlement', 'total harga produk'],
  debit: ['debit', 'debet', 'keluar', 'pengeluaran', 'biaya'],
  credit: ['kredit', 'credit', 'masuk', 'pemasukan', 'penerimaan', 'diterima'],
  type: ['tipe', 'type', 'd/k', 'dc', 'mutasi'],
}

// Kata kunci untuk MENDETEKSI baris header (laporan marketplace sering punya baris judul di atas tabel)
const HEADER_HINTS = [
  ...COLS.date, ...COLS.desc, ...COLS.amount, ...COLS.debit, ...COLS.credit, ...COLS.type,
  'status', 'sku', 'qty', 'kuantitas', 'ongkir', 'admin',
]

function scoreHeaderRow(row) {
  return row.reduce((n, cell) => {
    const c = lc(cell)
    if (!c) return n
    return n + (HEADER_HINTS.some((k) => c.includes(k)) ? 1 : 0)
  }, 0)
}

// Ubah array-of-arrays (baris mentah) → { rows: [obj], headers: [] } dengan deteksi baris header
function buildFromAoa(aoa) {
  const rowsArr = (aoa || []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''))
  if (!rowsArr.length) return { rows: [], headers: [] }

  // Cari baris header terbaik di 15 baris pertama
  let headerIdx = 0, best = -1
  for (let i = 0; i < Math.min(rowsArr.length, 15); i++) {
    const s = scoreHeaderRow(rowsArr[i])
    if (s > best) { best = s; headerIdx = i }
  }
  if (best < 2) headerIdx = 0 // fallback: anggap baris pertama header

  const headers = rowsArr[headerIdx].map((h, i) => (String(h ?? '').trim() || `kolom_${i + 1}`))
  const rows = rowsArr.slice(headerIdx + 1).map((r) => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = r[i] != null ? r[i] : '' })
    return obj
  })
  return { rows, headers }
}

/**
 * Auto-deteksi struktur file & ubah jadi daftar transaksi siap simpan.
 * channel: 'bank' | 'qris' | 'marketplace'
 */
export function rowsToTransactions(rows, headers, channel, userRules = []) {
  const colDate = findCol(headers, COLS.date)
  const colDesc = findCol(headers, COLS.desc)
  const colAmount = findCol(headers, COLS.amount)
  const colDebit = findCol(headers, COLS.debit)
  const colCredit = findCol(headers, COLS.credit)
  const colType = findCol(headers, COLS.type)

  const out = []
  for (const row of rows) {
    const desc = (colDesc ? row[colDesc] : '') || row[headers[1]] || row[headers[0]] || 'Transaksi'
    const rawDate = colDate ? row[colDate] : null

    let amount = 0
    let direction = null

    if (colDebit || colCredit) {
      const deb = parseAmount(colDebit ? row[colDebit] : 0)
      const cred = parseAmount(colCredit ? row[colCredit] : 0)
      if (cred > 0) { amount = cred; direction = 'in' }
      else if (deb > 0) { amount = deb; direction = 'out' }
    } else if (colAmount) {
      const a = parseAmount(row[colAmount])
      amount = Math.abs(a)
      if (colType) {
        const t = lc(row[colType])
        if (['k', 'cr', 'credit', 'kredit', 'masuk', 'in'].some((x) => t === x || t.includes(x))) direction = 'in'
        else if (['d', 'db', 'debit', 'debet', 'keluar', 'out'].some((x) => t === x || t.includes(x))) direction = 'out'
      }
      if (!direction) direction = a < 0 ? 'out' : (channel === 'marketplace' || channel === 'qris' ? 'in' : guessDirection(desc))
    }

    if (!amount || amount <= 0) continue

    // Kategori: aturan/kata kunci dulu; jika masih generik, pakai default sesuai channel
    let category = categorize(desc, direction, userRules)
    if (direction === 'in' && category === 'Pendapatan Lain') {
      if (channel === 'marketplace') category = 'Penjualan Marketplace'
      else if (channel === 'qris') category = 'Penjualan QRIS'
      else if (channel === 'bank') category = 'Penjualan'
    }

    const dinfo = parseDateInfo(rawDate)
    out.push({
      occurred_at: dinfo.iso,
      description: String(desc).trim().slice(0, 280),
      amount,
      direction,
      channel,
      category,
      raw: Object.values(row).join(' | ').slice(0, 500),
      _dateUncertain: !dinfo.certain,
      _dateReason: dinfo.reason,
      _dateRaw: rawDate == null ? '' : String(rawDate),
    })
  }
  return out
}

// Rentang tahun yang masuk akal untuk pembukuan usaha. Di luar ini hampir pasti
// salah baca kolom (mis. nomor invoice terbaca sebagai tanggal), bukan data asli.
const TAHUN_MIN = 2000
const tahunMasukAkal = (th) => th >= TAHUN_MIN && th <= new Date().getFullYear() + 1

// Alasan kegagalan dipakai layar pratinjau untuk menjelaskan ke pengguna
// KENAPA sebuah baris ditandai, bukan sekadar bahwa ia ditandai.
const gagalBaca = (reason) => ({ iso: new Date().toISOString(), certain: false, reason })

// Mengembalikan { iso, certain, reason }. certain=false berarti tanggal tidak
// terbaca dan dipakai tanggal hari ini sebagai cadangan, agar baris bisa
// DITANDAI ke pengguna (bukan diam-diam salah periode).
export function parseDateInfo(val) {
  if (val == null || val === '') return gagalBaca('kosong')
  // Angka serial Excel (mis. 45809) → tanggal
  if (typeof val === 'number' && val > 30000 && val < 60000) {
    const ms = (val - 25569) * 86400 * 1000
    const d = new Date(ms)
    if (!isNaN(d) && tahunMasukAkal(d.getFullYear())) return { iso: d.toISOString(), certain: true, reason: null }
  }
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = '20' + y
    const hari = Number(d), bulan = Number(mo), tahun = Number(y)
    const date = new Date(tahun, bulan - 1, hari)
    // JavaScript MENGGULUNG tanggal tak masuk akal alih-alih menolaknya:
    // new Date(2026, 12, 32) menghasilkan 1 Feb 2027 dan isNaN-nya false.
    // Tanpa pemeriksaan balik ini, "32/13/2026" tersimpan sebagai tanggal yang
    // salah tahun DAN ditandai yakin — persis kegagalan diam yang paling mahal,
    // karena laporan bulanannya ikut salah tanpa ada yang tahu.
    const utuh = date.getDate() === hari && date.getMonth() === bulan - 1 && date.getFullYear() === tahun
    if (!isNaN(date) && utuh && tahunMasukAkal(tahun)) return { iso: date.toISOString(), certain: true, reason: null }
    return gagalBaca('mustahil')
  }
  const native = new Date(s)
  if (!isNaN(native) && tahunMasukAkal(native.getFullYear())) return { iso: native.toISOString(), certain: true, reason: null }
  return gagalBaca('tidak dikenali')
}

export function parseDate(val) {
  return parseDateInfo(val).iso
}

// ---------- PARSER PER FORMAT ----------

// CSV / TSV → array-of-arrays (header:false) → deteksi header
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (res) => resolve(buildFromAoa(res.data)),
      error: reject,
    })
  })
}

// Excel (.xlsx / .xls) - SheetJS dimuat dinamis (hanya saat dibutuhkan)
export async function parseExcelFile(file) {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  return buildFromAoa(aoa)
}

// Dispatcher berdasarkan ekstensi file
export function parseImportFile(file) {
  const name = (file?.name || '').toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseExcelFile(file)
  return parseCsvFile(file) // .csv / .tsv / .txt
}
