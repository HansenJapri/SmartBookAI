import { useModalA11y } from '../lib/useModalA11y'

// Dialog modal yang konsisten & aksesibel untuk seluruh aplikasi.
// Menyatukan: backdrop (klik untuk menutup), role="dialog" + aria-modal,
// focus-trap, Escape, dan pengembalian fokus (lewat useModalA11y).
//
// Pemakaian:
//   <Modal onClose={...} labelledBy="idJudul">...</Modal>
//   <Modal onClose={...} onSubmit={simpan} className="modal-lg">...</Modal>
// Bila onSubmit diberikan, kotak dialog dirender sebagai <form> agar tombol
// bertipe submit tetap bekerja. Beri judul dialog id yang sama dengan labelledBy.
export default function Modal({ onClose, onSubmit, className = '', labelledBy, children }) {
  const ref = useModalA11y(onClose)
  const inner = {
    ref,
    className: `modal ${className}`.trim(),
    role: 'dialog',
    'aria-modal': 'true',
    onClick: (e) => e.stopPropagation(),
  }
  if (labelledBy) inner['aria-labelledby'] = labelledBy
  return (
    <div className="modal-backdrop" onClick={onClose}>
      {onSubmit
        ? <form {...inner} onSubmit={onSubmit}>{children}</form>
        : <div {...inner}>{children}</div>}
    </div>
  )
}
