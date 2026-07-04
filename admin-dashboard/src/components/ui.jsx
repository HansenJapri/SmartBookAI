export function Kpi({ label, value, delta, icon, deltaDir }) {
  return (
    <div className="kpi">
      <div className="k-l">{icon && <span>{icon}</span>}{label}</div>
      <div className="k-v">{value}</div>
      {delta != null && <div className={`k-d ${deltaDir || ''}`}>{delta}</div>}
    </div>
  )
}

export function Stars({ value = 0 }) {
  const v = Math.round(value)
  return (
    <span className="stars">
      {'★'.repeat(v)}<span className="off">{'★'.repeat(Math.max(0, 5 - v))}</span>
    </span>
  )
}

const STATUS = {
  baru: ['badge-indigo', 'Baru'],
  dibaca: ['badge-gray', 'Dibaca'],
  ditindaklanjuti: ['badge-amber', 'Ditindaklanjuti'],
  selesai: ['badge-green', 'Selesai'],
}
export function StatusBadge({ status }) {
  const [cls, label] = STATUS[status] || STATUS.baru
  return <span className={`badge ${cls}`}>{label}</span>
}

export function Spinner() {
  return <div style={{ padding: 50, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
