import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'
import CrudList from './CrudList'
import './modal.css'

// Dialog konfirmasi hapus — dipakai untuk hapus produk, satuan, kategori.
export function ConfirmModal({ open, onClose, onConfirm, title = 'Konfirmasi', message, confirmLabel = 'Hapus', variant = 'danger', busy = false }) {
  if (!open) return null
  const handleConfirm = async (e) => {
    e?.preventDefault?.()
    if (busy) return
    await onConfirm?.()
  }
  return (
    <Modal onClose={busy ? () => {} : onClose} labelledBy="stk-confirm-title">
      <div className="modal-head">
        <h3 id="stk-confirm-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-grid', placeItems: 'center', width: 34, height: 34, borderRadius: 999, background: 'rgba(186, 26, 26, 0.12)', color: '#ba1a1a' }}>
            <AlertTriangle size={18} />
          </span>
          {title}
        </h3>
      </div>
      <div className="modal-body">
        <p className="mdl-message">{message}</p>
        <div className="mdl-actions">
          <button type="button" className="mdl-btn mdl-btn-ghost" onClick={onClose} disabled={busy}>Batal</button>
          <button type="button" className={`mdl-btn mdl-btn-${variant}`} onClick={handleConfirm} disabled={busy}>
            {busy ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// Modal kelola satuan & kategori dengan tab.
export function KelolaModal({ open, onClose, units, cats, onAddUnit, onRenameUnit, onDeleteUnit, onAddCat, onRenameCat, onDeleteCat }) {
  const [tab, setTab] = useState('unit')
  if (!open) return null
  return (
    <Modal onClose={onClose} className="modal-lg" labelledBy="stk-kelola-title">
      <div className="modal-head">
        <div>
          <h3 id="stk-kelola-title">Kelola Satuan & Kategori</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13.5 }}>
            Tambah, ubah, atau hapus daftar. Perubahan langsung tersimpan.
          </p>
        </div>
      </div>
      <div className="modal-body">
        <div className="mdl-tabs" role="tablist" aria-label="Pilih daftar">
          <button role="tab" aria-selected={tab === 'unit'} className={tab === 'unit' ? 'is-on' : ''} onClick={() => setTab('unit')}>Satuan</button>
          <button role="tab" aria-selected={tab === 'cat'} className={tab === 'cat' ? 'is-on' : ''} onClick={() => setTab('cat')}>Kategori</button>
        </div>
        {tab === 'unit' ? (
          <CrudList
            title="Satuan"
            placeholder="cth: karung"
            items={units}
            dupMsg="Satuan itu sudah ada."
            onAdd={onAddUnit}
            onRename={onRenameUnit}
            onDelete={onDeleteUnit}
          />
        ) : (
          <CrudList
            title="Kategori Produk"
            placeholder="cth: Elektronik"
            items={cats}
            dupMsg="Kategori itu sudah ada."
            onAdd={onAddCat}
            onRename={onRenameCat}
            onDelete={onDeleteCat}
          />
        )}
      </div>
    </Modal>
  )
}
