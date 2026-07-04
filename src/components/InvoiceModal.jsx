import { useState } from 'react'
import { X } from 'lucide-react'
import {
  invoiceNo, invoicePdfBlob, invoicePngBlob, downloadBlob,
  shareInvoiceFile, invoiceCaption, whatsappLink, telegramLink, printNota,
} from '../lib/invoice'

// Dialog aksi invoice untuk satu transaksi pemasukan.
export default function InvoiceModal({ tx, profile, onClose }) {
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const no = tx.invoice_no || invoiceNo(tx)
  const baseName = `Invoice-${no}`

  const run = async (kind, fn) => {
    setBusy(kind); setNote('')
    try { await fn() } catch (e) { setNote('Gagal memproses: ' + e.message) } finally { setBusy('') }
  }

  const downloadPdf = () => run('pdf', async () => {
    const blob = await invoicePdfBlob(tx, profile); downloadBlob(blob, baseName + '.pdf')
  })
  const downloadPng = () => run('png', async () => {
    const blob = await invoicePngBlob(tx, profile); downloadBlob(blob, baseName + '.png')
  })
  const share = () => run('share', async () => {
    const blob = await invoicePngBlob(tx, profile)
    const ok = await shareInvoiceFile(blob, baseName + '.png', invoiceCaption(tx, profile))
    if (!ok) { downloadBlob(blob, baseName + '.png'); setNote('Perangkat tidak mendukung berbagi langsung. Gambar invoice sudah diunduh, silakan lampirkan ke chat secara manual.') }
  })
  const cetak = () => {
    setNote('')
    const ok = printNota(tx, profile)
    if (!ok) setNote('Jendela cetak diblokir browser. Mohon izinkan pop-up untuk halaman ini, lalu coba lagi.')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Invoice {no}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="card-sub" style={{ marginBottom: 14 }}>
            Pelanggan: <b>{tx.customer_name || 'Pelanggan'}</b> &middot; Status:{' '}
            {tx.payment_status === 'belum'
              ? <span className="tx-type tx-type-out">Belum Lunas</span>
              : <span className="tx-type tx-type-in">Lunas</span>}
          </div>

          {note && <div className="alert alert-info" style={{ marginBottom: 12 }}>{note}</div>}

          <div className="inv-actions">
            <button className="btn btn-primary" disabled={!!busy} onClick={downloadPdf}>
              {busy === 'pdf' ? 'Memproses...' : 'Unduh PDF'}
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={downloadPng}>
              {busy === 'png' ? 'Memproses...' : 'Unduh Gambar (PNG)'}
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={share}>
              {busy === 'share' ? 'Memproses...' : 'Bagikan ke WhatsApp / IG / Telegram'}
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={cetak}>
              Cetak Nota (Hitam Putih)
            </button>
          </div>

          <div className="card-sub" style={{ margin: '14px 0 6px' }}>Atau kirim pesan teks langsung:</div>
          <div className="inv-actions">
            <a className="btn btn-ghost" href={whatsappLink(tx, profile)} target="_blank" rel="noreferrer">Buka WhatsApp</a>
            <a className="btn btn-ghost" href={telegramLink(tx, profile)} target="_blank" rel="noreferrer">Buka Telegram</a>
          </div>
          <p className="muted-sm" style={{ marginTop: 12 }}>
            Tips: untuk mengirim file invoice (bukan hanya teks), pakai tombol <b>Bagikan</b> di atas, lalu pilih aplikasi tujuan.
          </p>
        </div>
      </div>
    </div>
  )
}
