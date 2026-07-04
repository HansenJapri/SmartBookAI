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

/**
 * @param {Array<Object>} rows baris-baris (objek per header)
 * @param {Array<string>} headers nama kolom
 * @param {string} platform 'shopee'|'tokopedia'|'tiktok'|'lazada'|'blibli'|'marketplace'
 * @returns {Array<Object>} transaksi siap simpan (penjualan + biaya terpisah)
 */
export function expandMarketplaceRows(rows, headers, platform = 'marketplace') {
  const cOrder = findCol(headers, COL.order)
  const cDate = findCol(headers, COL.date)
  const cGross = findCol(headers, COL.gross)
  const cNet = findCol(headers, COL.net)
  const cAdmin = findCol(headers, COL.admin)
  const cOngkir = findCol(headers, COL.ongkir)
  const cIklan = findCol(headers, COL.iklan)
  const label = PLATFORM_LABEL[platform] || 'Marketplace'
  const out = []

  for (const row of rows) {
    const orderId = cOrder ? String(row[cOrder] ?? '').trim() : ''
    const occurred = parseDate(cDate ? row[cDate] : null)
    let gross = cGross ? Math.abs(parseAmount(row[cGross])) : 0
    const net = cNet ? Math.abs(parseAmount(row[cNet])) : 0
    const admin = cAdmin ? Math.abs(parseAmount(row[cAdmin])) : 0
    const ongkir = cOngkir ? Math.abs(parseAmount(row[cOngkir])) : 0
    const iklan = cIklan ? Math.abs(parseAmount(row[cIklan])) : 0

    // Rekonstruksi kotor bila hanya nilai bersih + biaya yang tersedia.
    if (!gross && net) gross = net + admin + ongkir + iklan
    if (!gross || gross <= 0) continue

    // Selisih yang belum terjelaskan (potongan lain) — hanya bila nilai bersih diketahui.
    let lain = 0
    if (net > 0) {
      const diff = gross - net - admin - ongkir - iklan
      if (diff > 1) lain = diff
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
  return out
}
