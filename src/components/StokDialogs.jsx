import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'
import CrudList from './CrudList'
import { useLang } from '../context/LangContext'
import './modal.css'

// Dialog konfirmasi hapus — dipakai untuk hapus produk, satuan, kategori.
export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel, variant = 'danger', busy = false }) {
  const { t } = useLang()
  const dl = t.dialogs
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
          {title || dl.confirm}
        </h3>
      </div>
      <div className="modal-body">
        <p className="mdl-message">{message}</p>
        <div className="mdl-actions">
          <button type="button" className="mdl-btn mdl-btn-ghost" onClick={onClose} disabled={busy}>{dl.cancel}</button>
          <button type="button" className={`mdl-btn mdl-btn-${variant}`} onClick={handleConfirm} disabled={busy}>
            {busy ? dl.processing : (confirmLabel || dl.del)}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// Modal kelola satuan & kategori dengan tab.
export function KelolaModal({ open, onClose, units, cats, onAddUnit, onRenameUnit, onDeleteUnit, onAddCat, onRenameCat, onDeleteCat }) {
  const { t } = useLang()
  const dl = t.dialogs
  const [tab, setTab] = useState('unit')
  if (!open) return null
  return (
    <Modal onClose={onClose} className="modal-lg" labelledBy="stk-kelola-title">
      <div className="modal-head">
        <div>
          <h3 id="stk-kelola-title">{dl.kelolaTitle}</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13.5 }}>{dl.kelolaSub}</p>
        </div>
      </div>
      <div className="modal-body">
        <div className="mdl-tabs" role="tablist" aria-label={dl.kelolaTitle}>
          <button role="tab" aria-selected={tab === 'unit'} className={tab === 'unit' ? 'is-on' : ''} onClick={() => setTab('unit')}>{dl.tabUnit}</button>
          <button role="tab" aria-selected={tab === 'cat'} className={tab === 'cat' ? 'is-on' : ''} onClick={() => setTab('cat')}>{dl.tabCat}</button>
        </div>
        {tab === 'unit' ? (
          <CrudList
            title={dl.unitTitle}
            placeholder={dl.unitPh}
            items={units}
            dupMsg={dl.unitDup}
            onAdd={onAddUnit}
            onRename={onRenameUnit}
            onDelete={onDeleteUnit}
          />
        ) : (
          <CrudList
            title={dl.catTitle}
            placeholder={dl.catPh}
            items={cats}
            dupMsg={dl.catDup}
            onAdd={onAddCat}
            onRename={onRenameCat}
            onDelete={onDeleteCat}
          />
        )}
      </div>
    </Modal>
  )
}
