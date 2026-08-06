import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SpeechRecCtor, VOICE_ERROR, VOICE_FATAL_MESSAGE,
  classifyVoiceError, collectFinalTranscript, restartDelay,
} from './voice'

// ============================================================
// Sesi suara PERSISTEN.
//
// Syarat fitur: sesi tidak boleh mati sendiri — hanya berhenti saat pengguna
// menekan tombol nonaktifkan. Itu bertabrakan dengan cara kerja Web Speech API:
// walau `continuous = true`, Chrome tetap menutup aliran setelah beberapa detik
// hening dan memancarkan `onend`. Jadi "persisten" di sini bukan satu properti,
// melainkan mesin penyambung ulang:
//
//   onend  -> kalau pengguna masih mengaktifkan sesi, nyalakan lagi
//   onerror-> klasifikasikan dulu; hanya error fatal (izin ditolak) yang
//             benar-benar menghentikan sesi
//
// `activeRef` sengaja dipakai berdampingan dengan state `active`: callback
// SpeechRecognition dibuat sekali dan akan menutup nilai state yang basi,
// sehingga sesi berhenti menyambung setelah render berikutnya kalau kita
// membaca state di dalamnya.
// ============================================================

export function useVoiceSession({ lang = 'id-ID', onUtterance } = {}) {
  const [active, setActive] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')

  const recRef = useRef(null)
  const activeRef = useRef(false)
  const timerRef = useRef(null)
  const failuresRef = useRef(0)
  // Batas hasil yang sudah diproses — lihat collectFinalTranscript.
  const cursorRef = useRef(0)
  // Handler terbaru tanpa membangun ulang objek recognition tiap render.
  const onUtteranceRef = useRef(onUtterance)
  onUtteranceRef.current = onUtterance

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  // Menyalakan recognition dengan aman: memanggil start() pada instance yang
  // sudah berjalan melempar InvalidStateError, dan itu terjadi lebih sering
  // dari dugaan karena onend kadang datang setelah start() berikutnya.
  const startRec = useCallback(() => {
    const rec = recRef.current
    if (!rec || !activeRef.current) return
    try {
      rec.start()
    } catch {
      // Sudah berjalan (atau belum benar-benar berhenti) — abaikan, onend
      // berikutnya akan menjadwalkan percobaan lain.
    }
  }, [])

  const scheduleRestart = useCallback((kind) => {
    if (!activeRef.current) return
    clearTimer()
    timerRef.current = setTimeout(startRec, restartDelay(kind, failuresRef.current))
  }, [startRec])

  const stop = useCallback(() => {
    activeRef.current = false
    clearTimer()
    setActive(false)
    setListening(false)
    setInterim('')
    const rec = recRef.current
    recRef.current = null
    if (rec) {
      // Lepas handler SEBELUM stop: tanpa ini onend masih menyala dan
      // menjadwalkan sambungan baru untuk sesi yang barusan dimatikan.
      rec.onend = null; rec.onerror = null; rec.onresult = null; rec.onstart = null
      try { rec.stop() } catch { /* sudah berhenti */ }
    }
    try { window.speechSynthesis?.cancel() } catch { /* abaikan */ }
  }, [])

  const start = useCallback(() => {
    if (!SpeechRecCtor) {
      setError('Peramban ini belum mendukung input suara. Coba Chrome di HP atau laptop.')
      return false
    }
    if (activeRef.current) return true

    setError('')
    cursorRef.current = 0
    failuresRef.current = 0
    activeRef.current = true
    setActive(true)

    const rec = new SpeechRecCtor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true

    rec.onstart = () => { setListening(true) }

    rec.onresult = (ev) => {
      const { final, interim: partial } = collectFinalTranscript(ev.results, cursorRef.current)
      setInterim(partial)
      if (!final) return
      // Hasil final sudah diproses — geser kursor supaya tidak terkirim dua kali.
      cursorRef.current = ev.results.length
      failuresRef.current = 0
      setInterim('')
      onUtteranceRef.current?.(final)
    }

    rec.onerror = (ev) => {
      const kind = classifyVoiceError(ev?.error)
      if (kind === VOICE_ERROR.FATAL) {
        setError(VOICE_FATAL_MESSAGE[ev?.error] || 'Mikrofon tidak dapat digunakan.')
        stop()
        return
      }
      if (kind === VOICE_ERROR.RETRY) failuresRef.current += 1
      // TRANSIENT (hening/aborted) tidak dihitung sebagai kegagalan: itu
      // keadaan normal, bukan gangguan, dan tidak boleh memperlambat sambungan.
    }

    rec.onend = () => {
      setListening(false)
      // Inilah yang membuat sesi terasa "tidak pernah mati": selama pengguna
      // belum menekan nonaktifkan, setiap penutupan aliran disambung lagi.
      if (activeRef.current) scheduleRestart(VOICE_ERROR.TRANSIENT)
    }

    recRef.current = rec
    startRec()
    return true
  }, [lang, scheduleRestart, startRec, stop])

  const toggle = useCallback(() => {
    if (activeRef.current) stop(); else start()
  }, [start, stop])

  // Ucapan balik (sisi ke-2 dari "2 arah"). Pengenalan TIDAK dijeda saat bicara:
  // menjeda lalu menyalakan lagi memicu InvalidStateError beruntun, dan efek
  // "mendengar suara sendiri" sudah ditekan oleh peredam gema bawaan browser.
  const speak = useCallback((text) => {
    if (!text) return
    try {
      const synth = window.speechSynthesis
      if (!synth) return
      synth.cancel()
      const u = new SpeechSynthesisUtterance(String(text).slice(0, 500))
      u.lang = lang
      u.rate = 1.05
      synth.speak(u)
    } catch { /* TTS opsional — sesi tetap jalan tanpa suara balik */ }
  }, [lang])

  // Tab yang kembali terlihat: browser membekukan recognition di latar
  // belakang, jadi sambungkan lagi begitu pengguna kembali.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && activeRef.current) {
        scheduleRestart(VOICE_ERROR.TRANSIENT)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [scheduleRestart])

  // Bersihkan saat komponen dilepas — mikrofon tidak boleh tetap menyala.
  useEffect(() => () => { stop() }, [stop])

  return { active, listening, interim, error, start, stop, toggle, speak, setError }
}
