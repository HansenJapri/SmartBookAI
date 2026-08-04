import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { getSelectedWorkspace } from './api'
import {
  AudioPlayer, INPUT_MIME, MicCapture, base64ToPcm16, pcm16ToBase64, shouldSendFrame,
} from './liveAudio'
import { LIVE_EVENT, LiveSession } from './liveClient'
import { VOICE_TOOLS, buildSessionInstruction } from './voiceInstruction'
import {
  VOICE_PHASE, initialVoiceState, isAwaitingConfirmation, isExecuting,
  markExecuted, markFailed, pendingToolResponse, resolveConfirmation, stageCommand,
} from './voiceCommand'
import { executeCommand } from './voiceExecutor'
import { isStopCommand } from './voice'

// ============================================================
// Sesi suara 2 arah — perekat antara mikrofon, WebSocket, dan gerbang perintah.
//
// SATU ATURAN YANG MENENTUKAN SELURUH BERKAS INI:
//
//     Selama AI mengeluarkan suara, mikrofon tidak mengirim apa pun.
//
// Bug lama terjadi karena aturan itu tidak ada. Asisten membacakan ringkasan
// lewat speaker, mikrofon menangkap suaranya sendiri, transkrip yang rusak
// ("Tanyakini detail transaksi...") dikirim balik sebagai ucapan pengguna,
// asisten menjawabnya, dan lingkarannya tidak pernah berhenti.
//
// Yang membuka kembali gerbang BUKAN penghitung waktu, melainkan `onended`
// dari buffer terakhir di antrean pemutaran (lihat AudioPlayer). Penghitung
// waktu selalu salah: potongan audio datang tidak beraturan, dan jeda yang
// ditebak terlalu pendek membuka mikrofon di tengah kalimat AI.
// ============================================================

const TOKEN_FN = 'voice-live-token'

// Batas sambungan ulang beruntun sebelum sesi menyerah dan meminta pengguna
// menyalakannya lagi. Angkanya kecil dengan sengaja: kalau tiga percobaan
// berturut-turut gagal, penyebabnya bukan gangguan sesaat.
const MAX_RECONNECTS = 3

/**
 * Minta token efemeral dari Edge Function. Kunci Gemini tidak pernah ke browser.
 *
 * Pesan kegagalan diteruskan APA ADANYA dari server. Versi sebelumnya
 * meruntuhkan setiap sebab menjadi satu kalimat "Sesi suara belum bisa dibuka.
 * Coba lagi sebentar lagi." — kalimat yang tidak pernah benar dan tidak pernah
 * menolong, karena penyebab paling umumnya (fungsi belum ter-deploy) justru
 * tidak akan membaik betapa pun lamanya ditunggu.
 */
export async function fetchLiveToken(feature = 'voice_live') {
  const { data, error } = await supabase.functions.invoke(TOKEN_FN, {
    body: { feature, owner: getSelectedWorkspace() || undefined },
  })

  if (error) {
    const status = error.context?.status
    let detail = ''
    try { detail = (await error.context?.json())?.error } catch { /* badan bukan JSON */ }
    if (detail) throw new Error(detail)
    // 404 dari gateway Supabase berarti fungsinya tidak ada sama sekali —
    // sebab yang paling sering, dan yang paling tidak berguna kalau
    // disamarkan menjadi "coba lagi nanti".
    if (status === 404) {
      throw new Error(
        `Fitur suara belum aktif: Edge Function "${TOKEN_FN}" belum ter-deploy. `
        + `Jalankan: supabase functions deploy ${TOKEN_FN}`,
      )
    }
    throw new Error(
      `Sesi suara gagal dibuka${status ? ` (HTTP ${status})` : ''}. ${error.message || ''}`.trim(),
    )
  }

  if (data?.error) throw new Error(data.error)
  if (!data?.token) throw new Error('Server tidak mengirim token sesi suara.')
  return data
}

/**
 * Tanya server kenapa suara tidak mau menyala.
 * Tidak mencetak token dan tidak memakai kuota — aman dipanggil kapan saja.
 */
export async function diagnoseVoice(feature = 'voice_live') {
  const { data, error } = await supabase.functions.invoke(TOKEN_FN, {
    body: { action: 'diagnose', feature, owner: getSelectedWorkspace() || undefined },
  })
  if (error) {
    let detail = ''
    try { detail = (await error.context?.json())?.error } catch { /* abaikan */ }
    return { ok: false, status: error.context?.status ?? null, error: detail || error.message }
  }
  return data
}

/** Laporkan durasi pemakaian agar kuota suara (dalam detik) tetap akurat. */
async function reportUsage(seconds, feature = 'voice_live') {
  if (!(seconds > 0)) return
  try {
    await supabase.functions.invoke(TOKEN_FN, {
      body: { action: 'usage', seconds, feature, owner: getSelectedWorkspace() || undefined },
    })
  } catch { /* pelaporan kuota tidak boleh menggagalkan penutupan sesi */ }
}

export function useLiveVoice({ lang = 'id', userName = '' } = {}) {
  const [active, setActive] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [aiSpeaking, setAiSpeaking] = useState(false)
  const [phase, setPhase] = useState(VOICE_PHASE.IDLE)
  const [pending, setPending] = useState(null)
  const [log, setLog] = useState([])
  const [error, setError] = useState('')

  // Semua yang dibaca di dalam callback audio/WebSocket disimpan sebagai ref:
  // callback itu dibuat sekali dan akan menutup nilai state yang basi. Ini bug
  // yang sama yang membuat sesi lama berhenti menyambung setelah render kedua.
  const sessionRef = useRef(null)
  const micRef = useRef(null)
  const playerRef = useRef(null)
  const activeRef = useRef(false)
  const speakingRef = useRef(false)
  const cmdRef = useRef(initialVoiceState())
  const langRef = useRef(lang)
  langRef.current = lang
  const startedAtRef = useRef(0)
  // Sambungan ulang beruntun dihitung. Server yang menutup soket berkali-kali
  // (kuota habis, model salah, jaringan kampus memblokir WebSocket) akan
  // memicu reconnect tanpa henti, dan tiap percobaan mencetak token baru —
  // satu gangguan berubah menjadi banjir permintaan ke Edge Function.
  const reconnectFailsRef = useRef(0)
  // Transkrip ucapan pengguna datang sepotong-sepotong; dirakit di sini sampai
  // giliran selesai supaya pencocokan "ya"/"tidak" melihat kalimat utuh.
  const userBufRef = useRef('')

  const push = useCallback((role, text) => {
    const clean = String(text || '').trim()
    if (!clean) return
    setLog((l) => [...l.slice(-40), { role, text: clean, at: Date.now() }])
  }, [])

  const applyCmd = useCallback((next) => {
    cmdRef.current = next
    setPhase(next.phase)
    setPending(next.pending || null)
    if (next.error) setError(next.error)
  }, [])

  // ---------- Gerbang mikrofon ----------
  //
  // Satu-satunya tempat yang boleh mengubah keadaan gerbang. Dipusatkan supaya
  // tidak ada jalur diam-diam yang membuka mikrofon saat AI masih bicara.
  const applyGate = useCallback(() => {
    const open = shouldSendFrame({
      capturing: activeRef.current,
      aiSpeaking: speakingRef.current,
      muted: false,
    })
    micRef.current?.setGate(open)
  }, [])

  const handleSpeakingChange = useCallback((speaking) => {
    speakingRef.current = speaking
    setAiSpeaking(speaking)
    if (speaking) {
      // Beri tahu server bahwa aliran pengguna berhenti di sini. Tanpa sinyal
      // ini server mengira alirannya terputus mendadak dan kadang membuka
      // giliran baru di tengah jawaban yang sedang diucapkan.
      sessionRef.current?.signalAudioStreamEnd()
    }
    applyGate()
  }, [applyGate])

  // ---------- Eksekusi perintah (hanya setelah disetujui) ----------
  const runExecution = useCallback(async () => {
    const state = cmdRef.current
    const cmd = state.pending
    if (!cmd) return
    try {
      const result = await executeCommand(cmd, langRef.current)
      applyCmd(markExecuted(state))
      // Model diberi tahu hasilnya supaya ia yang mengabarkan ke pengguna
      // dengan suara — dan baru SEKARANG ia boleh berkata "sudah tersimpan".
      sessionRef.current?.sendToolResponse([{
        id: cmd.id ?? undefined,
        name: cmd.name,
        response: { status: 'BERHASIL', hasil: result },
      }])
    } catch (e) {
      const msg = e?.message || 'Perintah gagal dijalankan.'
      applyCmd(markFailed(state, msg, langRef.current))
      push('assistant', msg)
      sessionRef.current?.sendToolResponse([{
        id: cmd.id ?? undefined,
        name: cmd.name,
        response: { status: 'GAGAL', alasan: msg },
      }])
    }
  }, [applyCmd, push])

  // ---------- Ucapan pengguna yang sudah utuh ----------
  const handleUserTurn = useCallback((text) => {
    const clean = String(text || '').trim()
    if (!clean) return
    push('user', clean)

    if (isStopCommand(clean)) { stopRef.current(); return }

    const state = cmdRef.current
    // Sedang menulis ke database — abaikan ucapan lain agar tidak tersimpan dua kali.
    if (isExecuting(state)) return

    if (isAwaitingConfirmation(state)) {
      const next = resolveConfirmation(state, clean, langRef.current)
      applyCmd(next)
      if (next.action === 'execute') runExecution()
      if (next.action === 'cancel' && next.pending === null && state.pending) {
        // Model masih menunggu balasan fungsi; beri tahu bahwa rencananya batal
        // supaya ia tidak menggantung atau mengulang panggilan yang sama.
        sessionRef.current?.sendToolResponse([{
          id: state.pending.id ?? undefined,
          name: state.pending.name,
          response: { status: 'DIBATALKAN', alasan: 'Pengguna menolak konfirmasi.' },
        }])
      }
    }
  }, [applyCmd, push, runExecution])

  // ---------- Event dari server ----------
  const handleEvent = useCallback((ev) => {
    switch (ev.type) {
      case LIVE_EVENT.AUDIO:
        playerRef.current?.enqueue(base64ToPcm16(ev.data))
        break

      case LIVE_EVENT.INTERRUPTED:
        // Pengguna menyela. Audio yang mengantre harus berhenti SEKARANG —
        // membiarkannya berbunyi berarti mikrofon tetap tertutup padahal
        // pengguna sudah mulai bicara.
        playerRef.current?.interrupt()
        break

      case LIVE_EVENT.INPUT_TEXT:
        userBufRef.current += ev.text
        break

      case LIVE_EVENT.OUTPUT_TEXT:
        push('assistant', ev.text)
        break

      case LIVE_EVENT.TOOL_CALL: {
        // Perintah dari model TIDAK dieksekusi. Ia ditahan sebagai rencana dan
        // menunggu persetujuan lisan — lihat voiceCommand.js.
        const call = ev.calls[0]
        const next = stageCommand(cmdRef.current, call, langRef.current)
        applyCmd(next)
        sessionRef.current?.sendToolResponse([pendingToolResponse(next.pending, langRef.current)])
        break
      }

      case LIVE_EVENT.TURN_COMPLETE: {
        const said = userBufRef.current.trim()
        userBufRef.current = ''
        if (said) handleUserTurn(said)
        break
      }

      case LIVE_EVENT.GO_AWAY:
        // Server akan menutup sesi karena batas umur koneksi, bukan karena
        // kesalahan. Disambung ulang diam-diam agar pengguna tidak merasa putus.
        reconnectRef.current()
        break

      case LIVE_EVENT.CLOSED:
        if (!ev.byUser && activeRef.current) reconnectRef.current()
        break

      default:
        break
    }
  }, [applyCmd, handleUserTurn, push])

  // Ref pemanggilan silang: stop/reconnect dipakai di dalam handleEvent yang
  // didefinisikan lebih dulu.
  const stopRef = useRef(() => {})
  const reconnectRef = useRef(() => {})

  // ---------- Buka sesi ----------
  const start = useCallback(async () => {
    if (activeRef.current || connecting) return
    setError('')
    setConnecting(true)
    try {
      const { token, model } = await fetchLiveToken('voice_live')

      const player = new AudioPlayer({ onSpeakingChange: handleSpeakingChange })
      // Wajib dipanggil di dalam gestur klik: tanpa ini AudioContext tetap
      // "suspended" dan balasan pertama AI tidak terdengar sama sekali.
      await player.unlock()
      playerRef.current = player

      const session = new LiveSession({
        model,
        systemInstruction: buildSessionInstruction({ userName, lang: langRef.current }),
        tools: VOICE_TOOLS,
        audioOut: true,
        onEvent: handleEvent,
      })
      sessionRef.current = session
      await session.connect(token)

      const mic = new MicCapture({
        onFrame: (pcm) => {
          // Pemeriksaan terakhir sebelum sampel meninggalkan perangkat.
          // Gerbang di thread audio sudah menutup lebih dulu; ini jaring kedua
          // untuk frame yang sempat dirakit tepat saat AI mulai bicara.
          if (speakingRef.current || !activeRef.current) return
          session.sendAudio(pcm16ToBase64(pcm), INPUT_MIME)
        },
        onError: (e) => setError(e?.message || 'Mikrofon bermasalah.'),
      })
      micRef.current = mic
      await mic.start()

      activeRef.current = true
      startedAtRef.current = Date.now()
      reconnectFailsRef.current = 0
      setActive(true)
      applyCmd({ ...initialVoiceState(), phase: VOICE_PHASE.LISTENING })
      applyGate()
    } catch (e) {
      setError(e?.message || 'Sesi suara gagal dibuka.')
      micRef.current?.stop(); micRef.current = null
      playerRef.current?.close(); playerRef.current = null
      sessionRef.current?.close(); sessionRef.current = null
      activeRef.current = false
      setActive(false)
    } finally {
      setConnecting(false)
    }
  }, [applyCmd, applyGate, connecting, handleEvent, handleSpeakingChange, userName])

  // ---------- Tutup sesi ----------
  const stop = useCallback(() => {
    const seconds = startedAtRef.current
      ? Math.round((Date.now() - startedAtRef.current) / 1000)
      : 0
    activeRef.current = false
    startedAtRef.current = 0
    speakingRef.current = false

    micRef.current?.stop(); micRef.current = null
    playerRef.current?.close(); playerRef.current = null
    sessionRef.current?.close(); sessionRef.current = null

    setActive(false)
    setAiSpeaking(false)
    applyCmd(initialVoiceState())
    userBufRef.current = ''
    reportUsage(seconds)
  }, [applyCmd])
  stopRef.current = stop

  // ---------- Sambung ulang ----------
  //
  // Sesi Live punya batas umur di sisi server. Menyambung ulang memakai token
  // BARU (token lama sekali pakai) dan mempertahankan rencana yang sedang
  // menunggu konfirmasi — pengguna tidak perlu mendikte ulang hanya karena
  // koneksi berganti di tengah jalan.
  const reconnect = useCallback(async () => {
    if (!activeRef.current) return
    if (reconnectFailsRef.current >= MAX_RECONNECTS) {
      setError('Koneksi suara tidak stabil. Nyalakan lagi sesi suara untuk mencoba ulang.')
      stopRef.current()
      return
    }
    reconnectFailsRef.current += 1
    try {
      const { token, model } = await fetchLiveToken('voice_live')
      sessionRef.current?.close()
      const session = new LiveSession({
        model,
        systemInstruction: buildSessionInstruction({ userName, lang: langRef.current }),
        tools: VOICE_TOOLS,
        audioOut: true,
        onEvent: handleEvent,
      })
      sessionRef.current = session
      await session.connect(token)
      // Sambungan berhasil — penghitung disetel ulang supaya sesi panjang yang
      // sesekali terputus tidak menumpuk hitungan sampai batas.
      reconnectFailsRef.current = 0
      applyGate()
    } catch (e) {
      setError(e?.message || 'Koneksi suara terputus.')
      stopRef.current()
    }
  }, [applyGate, handleEvent, userName])
  reconnectRef.current = reconnect

  const toggle = useCallback(() => {
    if (activeRef.current) stop(); else start()
  }, [start, stop])

  // Tombol cadangan di layar. Disediakan karena pengenalan suara bisa gagal
  // berulang di tempat bising, dan pengguna tidak boleh terjebak dalam
  // rencana yang tidak bisa disetujui maupun dibatalkan.
  const confirmByButton = useCallback(() => {
    const next = resolveConfirmation(cmdRef.current, 'ya', langRef.current)
    applyCmd(next)
    if (next.action === 'execute') runExecution()
  }, [applyCmd, runExecution])

  const cancelByButton = useCallback(() => {
    const state = cmdRef.current
    const next = resolveConfirmation(state, 'tidak', langRef.current)
    applyCmd(next)
    if (state.pending) {
      sessionRef.current?.sendToolResponse([{
        id: state.pending.id ?? undefined,
        name: state.pending.name,
        response: { status: 'DIBATALKAN', alasan: 'Pengguna membatalkan lewat tombol.' },
      }])
    }
  }, [applyCmd])

  // Mikrofon tidak boleh tetap menyala setelah komponen dilepas.
  useEffect(() => () => { stopRef.current() }, [])

  return {
    active, connecting, aiSpeaking, phase, pending, log, error,
    awaitingConfirmation: phase === VOICE_PHASE.CONFIRMATION_PENDING,
    start, stop, toggle, confirmByButton, cancelByButton, setError,
  }
}
