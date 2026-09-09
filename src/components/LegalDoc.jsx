import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { renderLegalMarkdown } from '../lib/legalRender'

// Menampilkan dokumen legal (Syarat & Ketentuan / Kebijakan Privasi) dari
// basis data, dan mengikuti perubahan admin secara real-time. Bila tabel
// belum terisi (migrasi belum dijalankan), tampilkan konten bawaan (fallback).
export default function LegalDoc({ slug, fallback = null }) {
  const [content, setContent] = useState(null) // null = sedang memuat
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    if (!supabase) { setReady(true); return }

    supabase.from('legal_docs').select('content').eq('slug', slug).maybeSingle()
      .then(({ data }) => { if (alive) { setContent(data?.content || ''); setReady(true) } })
      .catch(() => { if (alive) { setContent(''); setReady(true) } })

    const ch = supabase
      .channel(`legal-${slug}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'legal_docs', filter: `slug=eq.${slug}` },
        (p) => { if (alive && p.new && p.new.content != null) setContent(p.new.content) })
      .subscribe()

    return () => { alive = false; supabase.removeChannel(ch) }
  }, [slug])

  if (!ready) {
    return <div className="legal-doc"><p className="muted">Memuat dokumen...</p></div>
  }

  // DB kosong atau belum tersedia -> pakai konten bawaan bila ada.
  if (!content) {
    return fallback || (
      <div className="legal-doc"><p className="muted">Dokumen belum tersedia. Silakan hubungi pengelola.</p></div>
    )
  }

  return (
    <div className="legal-doc">
      <div dangerouslySetInnerHTML={{ __html: renderLegalMarkdown(content) }} />
    </div>
  )
}
