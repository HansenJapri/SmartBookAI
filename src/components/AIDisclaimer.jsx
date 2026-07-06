import { AlertTriangle } from 'lucide-react'

// Disclaimer standar untuk SEMUA permukaan AI (keputusan PRD D7):
// hasil AI bisa keliru — pengguna diminta memeriksa & mengoreksi.
export default function AIDisclaimer({ text }) {
  return (
    <div className="ai-note" role="note">
      <AlertTriangle size={13} aria-hidden="true" />
      <span>{text || 'Hasil AI bisa keliru. Periksa dan koreksi sebelum dipakai.'}</span>
    </div>
  )
}
