import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import Modal from '../components/Modal'
import { useLang } from './LangContext'

// Pengganti window.alert() / window.confirm() bawaan browser.
//
// Alasan menggantinya bukan sekadar rasa: dialog bawaan memblokir thread UI,
// tampil di luar design system (dan menampilkan nama domain), tidak bisa
// diterjemahkan, tidak bisa diuji dengan Playwright, serta di beberapa browser
// mobile bisa dibungkam pengguna lewat "jangan tampilkan lagi" — pesan galat
// penting lalu hilang tanpa jejak.
//
// Pemakaian:
//   const { showAlert, showConfirm } = useAlert()
//   showAlert({ type: 'error', title: 'Gagal', message: 'Data gagal disimpan' })
//   if (!(await showConfirm({ message: 'Hapus data ini?' }))) return
//
// showAlert mengembalikan Promise yang resolve saat dialog ditutup; showConfirm
// resolve `true` bila dikonfirmasi dan `false` bila dibatalkan — bentuk yang
// sama dengan window.confirm sehingga pemanggil lama bisa dipindah apa adanya.

const AlertCtx = createContext(null)

const ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
}

const TONE = {
  error: 'var(--red, #dc2626)',
  success: 'var(--green, #16a34a)',
  warning: 'var(--amber, #d97706)',
  info: 'var(--primary, #1c36ee)',
}

export function AlertProvider({ children }) {
  const { t } = useLang()
  const a = t.alertDialog
  const [dialog, setDialog] = useState(null)
  // Promise pemanggil di-resolve dari sini, bukan dari state, supaya
  // penutupan lewat Escape / backdrop tidak menggantung `await` pemanggil.
  const resolveRef = useRef(null)

  const close = useCallback((result) => {
    setDialog(null)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.(result)
  }, [])

  const open = useCallback((opts) => new Promise((resolve) => {
    // Dialog kedua yang menimpa dialog pertama tidak boleh membuat pemanggil
    // pertama menunggu selamanya — tutup dulu dengan hasil batal.
    resolveRef.current?.(false)
    resolveRef.current = resolve
    setDialog(opts)
  }), [])

  const showAlert = useCallback(
    (opts = {}) => open({ ...(typeof opts === 'string' ? { message: opts } : opts), mode: 'alert' }),
    [open],
  )
  const showConfirm = useCallback(
    (opts = {}) => open({ ...(typeof opts === 'string' ? { message: opts } : opts), mode: 'confirm' }),
    [open],
  )

  const value = useMemo(() => ({ showAlert, showConfirm }), [showAlert, showConfirm])

  const type = dialog?.type || (dialog?.mode === 'confirm' ? 'warning' : 'info')
  const Icon = ICONS[type] || Info
  const tone = TONE[type] || TONE.info
  const isConfirm = dialog?.mode === 'confirm'
  const title = dialog?.title || (isConfirm ? a.confirmTitle : a.titles[type] || a.titles.info)

  return (
    <AlertCtx.Provider value={value}>
      {children}
      {dialog && (
        <Modal onClose={() => close(false)} labelledBy="alert-dialog-title" className="modal-alert">
          <div className="modal-body">
            <div className="alert-dlg-head">
              <span className="alert-dlg-icon" style={{ color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3 id="alert-dialog-title">{title}</h3>
            </div>
            {dialog.message && <p className="alert-dlg-msg">{dialog.message}</p>}
            <div className="modal-foot" style={{ justifyContent: 'flex-end' }}>
              {isConfirm && (
                <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
                  {dialog.cancelText || a.cancel}
                </button>
              )}
              <button
                type="button"
                className={`btn ${isConfirm && type === 'error' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => close(true)}
              >
                {dialog.confirmText || (isConfirm ? a.confirm : a.ok)}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AlertCtx.Provider>
  )
}

// Fallback non-provider sengaja TIDAK jatuh balik ke window.alert: kalau
// provider lupa dipasang, kita mau gagal terlihat di test, bukan diam-diam
// menghidupkan lagi dialog bawaan yang baru saja dibuang.
export function useAlert() {
  const ctx = useContext(AlertCtx)
  if (!ctx) throw new Error('useAlert() dipakai di luar <AlertProvider>.')
  return ctx
}
