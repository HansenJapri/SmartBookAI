import { useEffect, useRef } from 'react'

// Aksesibilitas modal (dipakai lewat komponen <Modal>):
//  - Escape menutup dialog.
//  - Focus-trap: Tab / Shift+Tab berputar di dalam dialog, tidak lolos ke
//    halaman di belakangnya.
//  - Fokus otomatis pindah ke elemen fokusabel pertama saat dibuka.
//  - Fokus dikembalikan ke elemen pemicu (tombol yang membuka) saat ditutup —
//    penting bagi pengguna keyboard & pembaca layar agar tidak "tersesat".
// Pasang ref yang dikembalikan ke elemen .modal (yang juga diberi
// role="dialog" aria-modal="true").
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModalA11y(onClose) {
  const ref = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const prevActive = document.activeElement

    // Hanya elemen yang benar-benar terlihat (punya kotak layout) yang bisa difokus.
    const focusables = () => Array.from(node.querySelectorAll(FOCUSABLE))
      .filter((el) => el.getClientRects().length > 0)

    const first = focusables()[0]
    if (first) first.focus()
    else { node.setAttribute('tabindex', '-1'); node.focus() }

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) { e.preventDefault(); return }
      const firstEl = list[0]
      const lastEl = list[list.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === firstEl || !node.contains(active)) { e.preventDefault(); lastEl.focus() }
      } else if (active === lastEl || !node.contains(active)) {
        e.preventDefault(); firstEl.focus()
      }
    }
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      // Kembalikan fokus ke pemicu bila masih ada di dokumen.
      if (prevActive && document.contains(prevActive) && prevActive.focus) prevActive.focus()
    }
  }, [])

  return ref
}
