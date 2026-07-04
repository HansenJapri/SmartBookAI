import { rupiah, fmtDateTime } from './format'

// Nomor invoice deterministik dari tanggal + sebagian id transaksi,
// sehingga stabil tanpa perlu disimpan terpisah.
export function invoiceNo(tx) {
  const d = new Date(tx.occurred_at || tx.created_at || Date.now())
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const short = String(tx.id || '').replace(/-/g, '').slice(0, 5).toUpperCase() || Math.random().toString(36).slice(2, 7).toUpperCase()
  return `INV-${ymd}-${short}`
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Logo BukuPintar (inline SVG) untuk branding di nota/invoice. bw=true untuk nota hitam-putih.
function bukuMark(size = 18, bw = false) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="${bw ? 'filter:grayscale(1);' : ''}vertical-align:middle;display:inline-block;">
    <rect width="32" height="32" rx="8" fill="#4F46E5"/>
    <path d="M9 8h9a3 3 0 0 1 3 3v13H12a3 3 0 0 1-3-3V8Z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M13 13h5M13 16.5h5M13 20h3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="22" cy="10" r="5" fill="#22C55E" stroke="#4F46E5" stroke-width="1.5"/>
    <path d="M20 10l1.4 1.4L24 8.8" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`
}

// Tampilkan nomor telepon dengan awalan 0 (bukan +62) agar lebih rapi pada nota.
function displayPhone(p) {
  const s = String(p || '').replace(/[\s-]/g, '')
  if (!s) return ''
  if (s.startsWith('+62')) return '0' + s.slice(3)
  if (s.startsWith('62')) return '0' + s.slice(2)
  return s
}

// Hitung subtotal, PPN, biaya layanan, dan grand total dari pengaturan profil.
function calcTotals(tx, profile) {
  const subtotal = Number(tx.amount) || 0
  const taxPct = Number(profile?.invoice_tax_percent) || 0
  const svcPct = Number(profile?.invoice_service_percent) || 0
  const tax = Math.round(subtotal * taxPct / 100)
  const service = Math.round(subtotal * svcPct / 100)
  const grand = subtotal + tax + service
  return { subtotal, taxPct, svcPct, tax, service, grand, hasExtra: tax > 0 || service > 0 }
}

// Teks baris "dilayani oleh" bila diaktifkan di pengaturan; kosong bila tidak.
function servedByText(profile) {
  if (!profile?.invoice_show_server) return ''
  const label = (profile?.invoice_server_label || 'Dilayani oleh').trim()
  const val = (profile?.invoice_server_value || '').trim()
  return val ? `${label}: ${val}` : ''
}

// Mengubah angka menjadi terbilang (Bahasa Indonesia) untuk invoice.
function terbilang(n) {
  n = Math.floor(Math.abs(Number(n) || 0))
  const s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas']
  const w = (x) => {
    if (x < 12) return s[x]
    if (x < 20) return w(x - 10) + ' belas'
    if (x < 100) return w(Math.floor(x / 10)) + ' puluh' + (x % 10 ? ' ' + w(x % 10) : '')
    if (x < 200) return 'seratus' + (x - 100 ? ' ' + w(x - 100) : '')
    if (x < 1000) return w(Math.floor(x / 100)) + ' ratus' + (x % 100 ? ' ' + w(x % 100) : '')
    if (x < 2000) return 'seribu' + (x - 1000 ? ' ' + w(x - 1000) : '')
    if (x < 1e6) return w(Math.floor(x / 1000)) + ' ribu' + (x % 1000 ? ' ' + w(x % 1000) : '')
    if (x < 1e9) return w(Math.floor(x / 1e6)) + ' juta' + (x % 1e6 ? ' ' + w(x % 1e6) : '')
    if (x < 1e12) return w(Math.floor(x / 1e9)) + ' miliar' + (x % 1e9 ? ' ' + w(x % 1e9) : '')
    return w(Math.floor(x / 1e12)) + ' triliun' + (x % 1e12 ? ' ' + w(x % 1e12) : '')
  }
  if (n === 0) return 'nol'
  const t = w(n).replace(/\s+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// Membentuk satu kartu invoice (HTML) yang profesional untuk dirender jadi
// gambar/PDF. Mengikuti kaidah nota/invoice Indonesia: identitas penjual,
// nomor & tanggal, pihak tertagih, rincian, total, terbilang, dan keterangan
// keabsahan dokumen elektronik (UU ITE).
function invoiceHtml(tx, profile) {
  const biz = esc(profile?.business_name || 'Usaha Saya')
  const owner = esc(profile?.owner_name || '')
  const phone = esc(displayPhone(profile?.phone))
  const address = esc(profile?.business_address || '')
  const email = esc(profile?.email || '')
  const logo = profile?.logo_url || ''
  const no = esc(tx.invoice_no || invoiceNo(tx))
  const paid = tx.payment_status !== 'belum'
  const t = calcTotals(tx, profile)
  const served = esc(servedByText(profile))
  const meterai = (paid && t.grand > 5000000)
    ? '<div style="font-size:11px;color:#475569;margin-top:12px;">Sebagai bukti penerimaan uang di atas Rp5.000.000, dokumen ini dikenai Bea Meterai Rp10.000 sesuai UU No. 10 Tahun 2020 tentang Bea Meterai.</div>'
    : ''
  const status = paid
    ? '<span style="background:#dcfce7;color:#16a34a;padding:5px 13px;border-radius:999px;font-weight:700;font-size:12px;letter-spacing:.04em;">LUNAS</span>'
    : '<span style="background:#fef3c7;color:#b45309;padding:5px 13px;border-radius:999px;font-weight:700;font-size:12px;letter-spacing:.04em;">BELUM LUNAS</span>'
  const cust = esc(tx.customer_name || 'Pelanggan')
  const custContact = tx.customer_contact ? `<div style="color:#64748b;font-size:13px;margin-top:2px;">${esc(displayPhone(tx.customer_contact))}</div>` : ''

  const subRow = (label, val, strong) =>
    `<div style="display:flex;justify-content:space-between;padding:5px 16px;font-size:13px;color:${strong ? '#0f172a' : '#475569'};${strong ? 'font-weight:700;' : ''}"><span>${label}</span><span>${esc(rupiah(val))}</span></div>`
  const grandRow = (label) =>
    `<div style="display:flex;justify-content:space-between;padding:13px 16px;margin-top:6px;background:#4f46e5;color:#fff;border-radius:10px;"><span style="font-weight:700;">${label}</span><span style="font-weight:800;">${esc(rupiah(t.grand))}</span></div>`
  const totalsBlock = t.hasExtra
    ? subRow('Subtotal', t.subtotal) +
      (t.tax > 0 ? subRow(`PPN (${t.taxPct}%)`, t.tax) : '') +
      (t.service > 0 ? subRow(`Biaya Layanan (${t.svcPct}%)`, t.service) : '') +
      grandRow('GRAND TOTAL')
    : grandRow('TOTAL')

  return `
  <div style="width:680px;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#fff;padding:44px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #4f46e5;padding-bottom:20px;margin-bottom:24px;gap:20px;">
      <div style="display:flex;gap:14px;align-items:flex-start;">
        ${logo ? `<img src="${logo}" alt="logo" style="width:62px;height:62px;object-fit:contain;border-radius:10px;border:1px solid #e2e8f0;background:#fff;" />` : ''}
        <div>
          <div style="font-size:23px;font-weight:800;color:#4f46e5;line-height:1.2;">${biz}</div>
          ${owner ? `<div style="color:#475569;font-size:13px;margin-top:4px;">${owner}</div>` : ''}
          ${address ? `<div style="color:#64748b;font-size:12.5px;margin-top:2px;max-width:300px;">${address}</div>` : ''}
          ${phone ? `<div style="color:#64748b;font-size:12.5px;margin-top:1px;">Telp/WA: ${phone}</div>` : ''}
          ${email ? `<div style="color:#64748b;font-size:12.5px;">${email}</div>` : ''}
        </div>
      </div>
      <div style="text-align:right;white-space:nowrap;">
        <div style="font-size:28px;font-weight:800;letter-spacing:2px;color:#0f172a;">INVOICE</div>
        <div style="color:#475569;font-size:13px;margin-top:6px;">No. ${no}</div>
        <div style="color:#64748b;font-size:13px;">Tanggal: ${esc(fmtDateTime(tx.occurred_at || tx.created_at))}</div>
        ${served ? `<div style="color:#64748b;font-size:13px;margin-top:2px;">${served}</div>` : ''}
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;margin-bottom:20px;gap:16px;">
      <div>
        <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Ditagihkan kepada</div>
        <div style="font-weight:700;font-size:15px;">${cust}</div>
        ${custContact}
      </div>
      <div style="text-align:right;">
        <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px;">Status Pembayaran</div>
        ${status}
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="text-align:center;padding:11px 10px;font-size:12px;color:#475569;width:40px;">No</th>
          <th style="text-align:left;padding:11px 14px;font-size:12px;color:#475569;">Keterangan</th>
          <th style="text-align:right;padding:11px 14px;font-size:12px;color:#475569;width:170px;">Jumlah</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:13px 10px;border-bottom:1px solid #e2e8f0;font-size:14px;text-align:center;color:#64748b;">1</td>
          <td style="padding:13px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;">${esc(tx.description || 'Penjualan')}</td>
          <td style="padding:13px 14px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:14px;">${esc(rupiah(t.subtotal))}</td>
        </tr>
      </tbody>
    </table>

    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
      <div style="width:320px;">${totalsBlock}</div>
    </div>

    <div style="border-top:1px dashed #cbd5e1;padding-top:12px;margin-bottom:26px;color:#475569;font-size:13px;font-style:italic;">
      Terbilang: <b style="font-style:normal;">${esc(terbilang(t.grand))} rupiah</b>
    </div>

    <div style="display:flex;justify-content:flex-end;">
      <div style="text-align:center;width:240px;color:#0f172a;font-size:13px;">
        <div>Hormat kami,</div>
        <div style="height:46px;"></div>
        <div style="font-weight:700;border-top:1px solid #cbd5e1;padding-top:6px;">${biz}</div>
      </div>
    </div>

    ${meterai}
    <div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-top:18px;color:#94a3b8;font-size:11px;line-height:1.6;">
      Terima kasih atas kepercayaan Anda. Dokumen ini diterbitkan secara elektronik melalui BukuPintar AI dan
      merupakan bukti transaksi yang sah sesuai Undang-Undang Informasi dan Transaksi Elektronik
      (UU No. 11 Tahun 2008 jo. UU No. 19 Tahun 2016), tanpa memerlukan tanda tangan basah.
      <div style="display:flex;align-items:center;justify-content:center;gap:7px;margin-top:13px;color:#475569;font-weight:700;font-size:12px;">
        ${bukuMark(18)}<span>Dibuat dengan BukuPintar AI</span>
      </div>
    </div>
  </div>`
}

async function renderCanvas(tx, profile) {
  const { default: html2canvas } = await import('html2canvas')
  const wrap = document.createElement('div')
  wrap.style.position = 'fixed'
  wrap.style.left = '-10000px'
  wrap.style.top = '0'
  wrap.innerHTML = invoiceHtml(tx, profile)
  document.body.appendChild(wrap)
  try {
    const node = wrap.firstElementChild
    return await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', logging: false })
  } finally {
    document.body.removeChild(wrap)
  }
}

export async function invoicePngBlob(tx, profile) {
  const canvas = await renderCanvas(tx, profile)
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

export async function invoicePdfBlob(tx, profile) {
  const canvas = await renderCanvas(tx, profile)
  const { default: jsPDF } = await import('jspdf')
  const img = canvas.toDataURL('image/png')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const margin = 24
  const w = pageW - margin * 2
  const h = canvas.height * (w / canvas.width)
  pdf.addImage(img, 'PNG', margin, margin, w, h)
  return pdf.output('blob')
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

// Bagikan file via menu bagikan perangkat (di HP akan muncul WhatsApp, Instagram,
// Telegram, dll). Mengembalikan true bila berhasil dibagikan.
export async function shareInvoiceFile(blob, filename, caption) {
  try {
    const file = new File([blob], filename, { type: blob.type })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Invoice', text: caption })
      return true
    }
  } catch { /* dibatalkan atau tidak didukung */ }
  return false
}

export function invoiceCaption(tx, profile) {
  const biz = profile?.business_name || 'kami'
  const no = tx.invoice_no || invoiceNo(tx)
  const grand = calcTotals(tx, profile).grand
  const sapaan = tx.customer_name ? `Halo ${tx.customer_name},` : 'Halo,'
  const penutup = tx.payment_status === 'belum'
    ? 'Mohon konfirmasi pembayarannya. Terima kasih.'
    : 'Terima kasih atas pembeliannya.'
  return [
    `${sapaan} berikut invoice dari ${biz}:`,
    '',
    `No. Invoice : ${no}`,
    `Total       : ${rupiah(grand)}`,
    `Status      : ${tx.payment_status === 'belum' ? 'Belum Lunas' : 'Lunas'}`,
    '',
    penutup,
  ].join('\n')
}

export function whatsappLink(tx, profile) {
  const phone = String(tx.customer_contact || '').replace(/[^0-9]/g, '').replace(/^0/, '62')
  const text = encodeURIComponent(invoiceCaption(tx, profile))
  return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`
}

export function telegramLink(tx, profile) {
  return `https://t.me/share/url?url=${encodeURIComponent(' ')}&text=${encodeURIComponent(invoiceCaption(tx, profile))}`
}

// Nota versi HITAM-PUTIH, dioptimalkan untuk dicetak (printer struk/biasa).
function notaHtmlBW(tx, profile) {
  const biz = esc(profile?.business_name || 'Usaha Saya')
  const owner = esc(profile?.owner_name || '')
  const address = esc(profile?.business_address || '')
  const phone = esc(displayPhone(profile?.phone))
  const logo = profile?.logo_url || ''
  const no = esc(tx.invoice_no || invoiceNo(tx))
  const cust = esc(tx.customer_name || 'Pelanggan')
  const paid = tx.payment_status !== 'belum'
  const date = esc(fmtDateTime(tx.occurred_at || tx.created_at))
  const t = calcTotals(tx, profile)
  const served = esc(servedByText(profile))
  const row = (l, v) => `<div style="display:flex;justify-content:space-between;gap:10px;"><span>${l}</span><span style="white-space:nowrap;">${esc(rupiah(v))}</span></div>`
  const totals = t.hasExtra
    ? row('Subtotal', t.subtotal) +
      (t.tax > 0 ? row(`PPN ${t.taxPct}%`, t.tax) : '') +
      (t.service > 0 ? row(`Layanan ${t.svcPct}%`, t.service) : '') +
      `<div style="display:flex;justify-content:space-between;font-weight:bold;font-size:13px;margin-top:4px;border-top:1px dashed #000;padding-top:4px;"><span>GRAND TOTAL</span><span>${esc(rupiah(t.grand))}</span></div>`
    : `<div style="display:flex;justify-content:space-between;font-weight:bold;font-size:13px;"><span>TOTAL</span><span>${esc(rupiah(t.grand))}</span></div>`
  return `<div style="font-family:'Courier New',monospace;color:#000;width:300px;margin:0 auto;padding:10px;">
    <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:8px;margin-bottom:8px;">
      ${logo ? `<img src="${logo}" alt="logo" style="width:48px;height:48px;object-fit:contain;filter:grayscale(1);display:block;margin:0 auto 4px;" />` : ''}
      <div style="font-size:16px;font-weight:bold;">${biz}</div>
      ${owner ? `<div style="font-size:11px;">${owner}</div>` : ''}
      ${address ? `<div style="font-size:10px;">${address}</div>` : ''}
      ${phone ? `<div style="font-size:10px;">${phone}</div>` : ''}
    </div>
    <div style="font-size:11px;line-height:1.7;">
      <div>No&nbsp;&nbsp;&nbsp;: ${no}</div>
      <div>Tanggal: ${date}</div>
      <div>Pelanggan: ${cust}</div>
      ${served ? `<div>${served}</div>` : ''}
    </div>
    <div style="border-top:1px dashed #000;border-bottom:1px dashed #000;margin:8px 0;padding:8px 0;font-size:12px;">
      <div style="display:flex;justify-content:space-between;gap:10px;"><span>${esc(tx.description || 'Penjualan')}</span><span style="white-space:nowrap;">${esc(rupiah(t.subtotal))}</span></div>
    </div>
    <div style="font-size:12px;line-height:1.6;">${totals}</div>
    <div style="font-size:11px;margin-top:5px;">Status : ${paid ? 'LUNAS' : 'BELUM LUNAS'}</div>
    <div style="font-size:10px;margin-top:3px;font-style:italic;">Terbilang: ${esc(terbilang(t.grand))} rupiah</div>
    <div style="text-align:center;border-top:1px dashed #000;margin-top:10px;padding-top:8px;font-size:10px;line-height:1.5;">
      <div style="margin-bottom:4px;">${bukuMark(22, true)}</div>
      Terima kasih atas kunjungan Anda.<br>Dibuat dengan BukuPintar AI.
    </div>
  </div>`
}

// Membuka jendela cetak berisi nota hitam-putih lalu memicu dialog cetak.
export function printNota(tx, profile) {
  const win = window.open('', '_blank', 'width=420,height=680')
  if (!win) return false
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Nota ${esc(invoiceNo(tx))}</title>` +
    '<style>@page{margin:6mm;} body{margin:0;background:#fff;} @media print{body{-webkit-print-color-adjust:exact;}}</style>' +
    `</head><body>${notaHtmlBW(tx, profile)}` +
    '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},250);};</scr' + 'ipt>' +
    '</body></html>')
  win.document.close()
  return true
}
