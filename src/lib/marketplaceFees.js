// ---------- IMPOR LAPORAN MARKETPLACE (multi-platform) ----------
// Memecah tiap baris pesanan menjadi: 1 transaksi PENJUALAN (kotor) + transaksi
// BIAYA terpisah (admin/komisi, ongkir ditanggung penjual, iklan, potongan lain).
// Dengan begitu "kebocoran" bisa dihitung (lihat src/lib/reveal.js).
//
// Deteksi kolom berbasis SINONIM lintas marketplace (Shopee, Tokopedia, TikTok,
// Lazada, Blibli) — bukan hardcode satu platform. Bila gross tidak ada tapi net &
// biaya ada, gross direkonstruksi. Selisih yang belum terjelaskan ditandai "Potongan lain".
import { parseAmount, parseDate } from './csvImport'

export const PLATFORM_LABEL = {
  shopee: 'Shopee', tokopedia: 'Tokopedia', tiktok: 'TikTok Shop',
  lazada: 'Lazada', blibli: 'Blibli', marketplace: 'Marketplace',
}

// Sinonim header (dicocokkan dengan "includes", huruf kecil). Urutan = prioritas.
const COL = {
  order: ['no. pesanan', 'no pesanan', 'nomor pesanan', 'order id', 'order sn', 'no. invoice', 'no invoice', 'invoice', 'kode pesanan', 'order number'],
  date: ['waktu pesanan dibuat', 'waktu pembayaran dilakukan', 'tanggal pembayaran', 'tanggal pelunasan', 'tanggal pesanan', 'order created time', 'created time', 'order time', 'tanggal', 'tgl', 'waktu'],
  gross: ['total harga produk', 'harga produk', 'total pembayaran', 'jumlah pembayaran pembeli', 'total pembeli', 'subtotal', 'total penjualan', 'total order', 'grand total', 'total harga jual'],
  net: ['total penghasilan', 'total dana diterima', 'dana yang diterima', 'total diterima', 'total pendapatan', 'penghasilan', 'settlement amount', 'total payout', 'dana dikreditkan', 'total dana'],
  admin: ['biaya administrasi', 'biaya admin', 'biaya layanan', 'biaya komisi', 'komisi', 'biaya proses pesanan', 'biaya transaksi', 'biaya jasa', 'service fee', 'commission', 'biaya penanganan', 'biaya provisi'],
  ongkir: ['ongkos kirim', 'ongkir', 'biaya pengiriman', 'subsidi ongkir', 'ongkir ditanggung penjual', 'biaya kirim', 'shipping fee'],
  iklan: ['biaya iklan', 'biaya promosi', 'biaya promo', 'biaya kampanye', 'biaya program', 'biaya affiliate', 'komisi affiliate'],
}

const lc = (s) => (s || '').toString().toLowerCase().trim()
function findCol(headers, cands) {
  const h = headers.map(lc)
  for (const c of cands) {
    const i = h.findIndex((x) => x.includes(c))
    if (i !== -1) return headers[i]
  }
  return null
}

// Peran kolom yang memengaruhi ketepatan angka kebocoran. 'order' sengaja tidak
// ikut: ketiadaannya hanya membuat deskripsi transaksi kehilangan nomor pesanan,
// tidak menggeser satu rupiah pun.
export const PERAN_PENTING = ['date', 'gross', 'net', 'admin', 'ongkir', 'iklan']

/**
 * Versi berdiagnostik. Deteksi kolom berbasis sinonim sudah bagus, tapi selama
 * ini DIAM saat gagal: kalau kolom biaya iklan tidak dikenali, angka kebocoran
 * jadi terlalu kecil dan tidak ada yang tahu. Untuk fitur yang menjadi pembeda
 * utama produk, kegagalan diam adalah risiko terbesarnya.
 *
 * @returns {{transactions: Array<Object>, diagnostics: Object}}
 */
export function expandMarketplaceReport(rows, headers, platform = 'marketplace') {
  const kolom = {
    order: findCol(headers, COL.order),
    date: findCol(headers, COL.date),
    gross: findCol(headers, COL.gross),
    net: findCol(headers, COL.net),
    admin: findCol(headers, COL.admin),
    ongkir: findCol(headers, COL.ongkir),
    iklan: findCol(headers, COL.iklan),
  }
  const matched = {}
  for (const [peran, header] of Object.entries(kolom)) if (header) matched[peran] = header
  const unmatched = PERAN_PENTING.filter((p) => !matched[p])

  // Kolom berkas yang tidak dikenali satu peran pun. Didaftarkan supaya sinonim
  // baru bisa ditambahkan ke COL — inilah cara daftar sinonim tumbuh dari
  // berkas nyata, bukan dari tebakan.
  const terpakai = new Set(Object.values(matched))
  const unknownColumns = headers.filter((h) => !terpakai.has(h))

  const cOrder = kolom.order, cDate = kolom.date, cGross = kolom.gross
  const cNet = kolom.net, cAdmin = kolom.admin, cOngkir = kolom.ongkir, cIklan = kolom.iklan
  const label = PLATFORM_LABEL[platform] || 'Marketplace'
  const out = []

  let unexplainedAmount = 0
  let rowCount = 0
  let skippedRows = 0
  let reconstructedRows = 0

  for (const row of rows) {
    const orderId = cOrder ? String(row[cOrder] ?? '').trim() : ''
    const occurred = parseDate(cDate ? row[cDate] : null)
    let gross = cGross ? Math.abs(parseAmount(row[cGross])) : 0
    const net = cNet ? Math.abs(parseAmount(row[cNet])) : 0
    const admin = cAdmin ? Math.abs(parseAmount(row[cAdmin])) : 0
    const ongkir = cOngkir ? Math.abs(parseAmount(row[cOngkir])) : 0
    const iklan = cIklan ? Math.abs(parseAmount(row[cIklan])) : 0

    // Rekonstruksi kotor bila hanya nilai bersih + biaya yang tersedia.
    if (!gross && net) { gross = net + admin + ongkir + iklan; reconstructedRows++ }
    // Baris tanpa nilai kotor yang bisa dipakai DIBUANG. Dulu ini terjadi tanpa
    // jejak apa pun; sekarang dihitung supaya pengguna tahu berapa baris
    // berkasnya yang tidak terpakai.
    if (!gross || gross <= 0) { skippedRows++; continue }
    rowCount++

    // Selisih yang belum terjelaskan (potongan lain) — hanya bila nilai bersih diketahui.
    let lain = 0
    if (net > 0) {
      const diff = gross - net - admin - ongkir - iklan
      if (diff > 1) { lain = diff; unexplainedAmount += diff }
    }

    const ref = orderId || undefined
    const suffix = orderId ? ` ${orderId}` : ''
    out.push({
      occurred_at: occurred, description: `Penjualan ${label}${suffix}`,
      amount: gross, direction: 'in', channel: platform,
      category: 'Penjualan Marketplace', source_ref: ref,
    })
    const fee = (amt, category, desc) => {
      if (amt > 0) out.push({
        occurred_at: occurred, description: `${desc} ${label}${suffix}`,
        amount: amt, direction: 'out', channel: platform, category, source_ref: ref,
      })
    }
    fee(admin, 'Biaya Admin & Transaksi', 'Biaya admin')
    fee(ongkir, 'Transportasi & Ongkir', 'Ongkir ditanggung')
    fee(iklan, 'Iklan & Promosi', 'Biaya iklan')
    fee(lain, 'Biaya Admin & Transaksi', 'Potongan lain')
  }

  // Keyakinan menjawab satu pertanyaan: seberapa besar kemungkinan angka
  // kebocoran ini TERLALU KECIL karena ada biaya yang tidak terbaca?
  //   tinggi = kolom kotor ada + KETIGA kolom biaya terdeteksi
  //   sedang = kolom kotor ada + 1 sampai 2 kolom biaya
  //   rendah = kotor direkonstruksi dari bersih, atau tidak ada kolom biaya
  //
  // CATATAN PENYIMPANGAN. Spec C3 menulis "tinggi = gross + >=2 kolom biaya",
  // tetapi kriteria terimanya menuntut "impor berkas tanpa kolom iklan ->
  // confidence turun". Keduanya tidak bisa benar bersamaan: berkas dengan kotor
  // + admin + ongkir tapi tanpa iklan memenuhi ">=2" sehingga tetap 'tinggi'.
  // Yang dimenangkan adalah kriteria terimanya, karena itu juga yang sesuai
  // alasan task ini ada ("kalau kolom biaya iklan tidak terdeteksi, angka
  // kebocoran jadi terlalu kecil dan tidak ada yang tahu") — dan pada data
  // contoh produk ini, iklan menyumbang 48% dari total kebocoran. Arah
  // penyimpangannya juga yang aman: lebih sering memperingatkan, tidak pernah
  // lebih jarang. Aturan 'sedang' dan 'rendah' dari spec tetap utuh.
  const feeTerdeteksi = ['admin', 'ongkir', 'iklan'].filter((k) => matched[k]).length
  let confidence
  if (!matched.gross || feeTerdeteksi === 0) confidence = 'rendah'
  else if (feeTerdeteksi === 3) confidence = 'tinggi'
  else confidence = 'sedang'

  return {
    transactions: out,
    diagnostics: {
      platform, matched, unmatched, unknownColumns,
      unexplainedAmount, rowCount, skippedRows, reconstructedRows, confidence,
    },
  }
}

/**
 * Bentuk lama yang hanya mengembalikan transaksi. Dipertahankan agar pemanggil
 * dan tes yang sudah ada tidak perlu diubah.
 *
 * @param {Array<Object>} rows baris-baris (objek per header)
 * @param {Array<string>} headers nama kolom
 * @param {string} platform 'shopee'|'tokopedia'|'tiktok'|'lazada'|'blibli'|'marketplace'
 * @returns {Array<Object>} transaksi siap simpan (penjualan + biaya terpisah)
 */
export function expandMarketplaceRows(rows, headers, platform = 'marketplace') {
  return expandMarketplaceReport(rows, headers, platform).transactions
}
