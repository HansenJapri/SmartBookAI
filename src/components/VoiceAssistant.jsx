import { useEffect, useRef } from 'react'
import { Mic, MicOff, Loader2, ShieldCheck, Check, X, Volume2, AudioLines } from 'lucide-react'
import { useLang } from '../context/LangContext'
import { useLiveVoice } from '../lib/useLiveVoice'
import { VOICE_PHASE } from '../lib/voiceCommand'

// ============================================================
// Asisten suara 2 arah (Gemini Live).
//
//  - Percakapan berjalan lewat WebSocket audio dua arah; tidak ada tombol
//    "kirim" karena tidak ada yang diketik.
//  - Saat asisten bicara, indikator mikrofon dijeda DITAMPILKAN. Ini bukan
//    hiasan: pengguna yang tidak tahu mikrofonnya tertutup akan bicara di
//    saat yang salah lalu mengira aplikasinya rusak.
//  - Tidak ada perintah yang dijalankan tanpa persetujuan. Tombol Ya/Batal
//    hanya jaring pengaman bila mikrofon berulang kali salah dengar.
// ============================================================

export default function VoiceAssistant() {
  const { t, lang } = useLang()
  const v = t.voice
  const logRef = useRef(null)

  const voice = useLiveVoice({ lang })

  // Gulir otomatis ke pesan terbaru.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [voice.log, voice.phase, voice.aiSpeaking])

  const status = !voice.active
    ? (voice.connecting ? v.stConnecting : v.stInactive)
    : voice.aiSpeaking ? v.stSpeaking
      : voice.phase === VOICE_PHASE.EXECUTING ? v.stProcessing
        : voice.awaitingConfirmation ? v.stAwaiting
          : v.stListening

  const pending = voice.pending

  return (
    <div className="voice-panel">
      <div className="voice-head">
        <div className="voice-status">
          <span
            className={`voice-dot${voice.active ? ' on' : ''}${voice.active && !voice.aiSpeaking ? ' pulse' : ''}`}
            aria-hidden="true"
          />
          <span className="voice-status-text">{status}</span>
        </div>
        <button
          type="button"
          className={`btn btn-sm ${voice.active ? 'btn-danger' : 'btn-primary'}`}
          onClick={voice.toggle}
          disabled={voice.connecting}
          aria-pressed={voice.active}
        >
          {voice.connecting
            ? <Loader2 size={15} className="spin" />
            : voice.active ? <MicOff size={15} /> : <Mic size={15} />}
          <span>{voice.active ? v.disable : v.enable}</span>
        </button>
      </div>

      {voice.error && <div className="alert alert-err voice-alert">{voice.error}</div>}

      {/* Status mikrofon dijeda diumumkan ke pembaca layar juga (aria-live),
          karena pengguna tunanetra tidak melihat indikator titik berdenyut. */}
      {voice.aiSpeaking && (
        <div className="voice-muted-bar" role="status" aria-live="polite">
          <Volume2 size={13} aria-hidden="true" />
          <span>{v.micPaused}</span>
        </div>
      )}

      <div className="voice-log" ref={logRef}>
        {voice.log.length === 0 && !voice.active && (
          <div className="voice-empty">
            <p>{v.introTitle}</p>
            <ul>
              <li>{v.introPersist}</li>
              <li>{v.introConfirm}</li>
              <li>{v.introExample}</li>
            </ul>
          </div>
        )}
        {voice.log.map((m, i) => (
          <div key={`${m.at}-${i}`} className={`chat-msg ${m.role}`}>{m.text}</div>
        ))}
        {voice.active && !voice.aiSpeaking && !voice.awaitingConfirmation && (
          <div className="voice-listening-hint" aria-hidden="true">
            <AudioLines size={13} className="spin-slow" />
          </div>
        )}
        {voice.phase === VOICE_PHASE.EXECUTING && (
          <div className="chat-msg assistant voice-working">
            <Loader2 size={13} className="spin" /> {v.stProcessing}
          </div>
        )}
      </div>

      {voice.awaitingConfirmation && pending && (
        <div className={`voice-confirm${pending.destructive ? ' voice-confirm-danger' : ''}`}>
          <div className="voice-confirm-body">
            <b>{v.confirmTitle}</b>
            <div className="voice-draft">
              <span className="voice-draft-desc">{pending.summary}</span>
            </div>
            <div className="muted-sm">{v.confirmHint}</div>
          </div>
          <div className="voice-confirm-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={voice.cancelByButton}>
              <X size={14} /><span>{v.cancel}</span>
            </button>
            <button
              type="button"
              className={`btn btn-sm ${pending.destructive ? 'btn-danger' : 'btn-primary'}`}
              onClick={voice.confirmByButton}
            >
              <Check size={14} /><span>{v.save}</span>
            </button>
          </div>
        </div>
      )}

      {voice.active && !voice.awaitingConfirmation && (
        <p className="voice-note muted-sm">
          <ShieldCheck size={13} aria-hidden="true" />
          <span>{v.persistNote}</span>
        </p>
      )}
    </div>
  )
}
