// ============================================================
// Klien WebSocket untuk Gemini Live API (BidiGenerateContent).
//
// Sesi suara memakai DUA model dengan pembagian tugas yang jelas:
//
//   percakapan  -> gemini-2.5-flash-native-audio-dialog
//                  Suara masuk, suara keluar. Model ini yang menjawab dengan
//                  intonasi alami dan mengikuti bahasa penggunanya.
//   perintah    -> Gemini 3 Flash Live (lihat FEATURE_ROUTES.voice_crud)
//                  Dipanggil saat percakapan menghasilkan perintah CRUD.
//                  Tugasnya sempit: mengubah kalimat menjadi argumen fungsi
//                  yang valid. Model yang menjawab dan model yang menulis ke
//                  database sengaja dipisah supaya obrolan santai tidak pernah
//                  punya jalur langsung ke tabel transaksi.
//
// Kunci API TIDAK pernah ada di browser. Token efemeral berumur pendek diminta
// dari Edge Function `voice-live-token`, dan itulah yang dipakai membuka soket.
// ============================================================

// Host dan versi dipisah sebagai konstanta karena keduanya masih berlabel
// preview di sisi Google dan paling mungkin berubah lebih dulu. Versi bukan
// segmen path tersendiri — ia menempel di NAMA layanan, jadi disusun di sini.
export const LIVE_HOST = 'generativelanguage.googleapis.com'
// Token efemeral hanya dilayani oleh v1alpha; v1beta masih menuntut kunci asli.
export const LIVE_API_VERSION = 'v1alpha'

export function liveSocketUrl(token, { host = LIVE_HOST, version = LIVE_API_VERSION } = {}) {
  const service = `google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent`
  // Token dikirim sebagai access_token: WebSocket di browser tidak bisa
  // membawa header Authorization, jadi query string satu-satunya jalan. Ini
  // dapat diterima karena token efemeral berumur menit dan sekali pakai —
  // kunci proyek yang sebenarnya tidak pernah meninggalkan Edge Function.
  return `wss://${host}/ws/${service}?access_token=${encodeURIComponent(token)}`
}

export const LIVE_EVENT = {
  READY: 'ready',
  AUDIO: 'audio',
  INPUT_TEXT: 'inputText',
  OUTPUT_TEXT: 'outputText',
  TOOL_CALL: 'toolCall',
  TURN_COMPLETE: 'turnComplete',
  INTERRUPTED: 'interrupted',
  GO_AWAY: 'goAway',
  ERROR: 'error',
  CLOSED: 'closed',
}

/**
 * Ubah satu pesan server menjadi daftar event yang seragam.
 *
 * Dipisah sebagai fungsi MURNI karena di sinilah letak semua asumsi tentang
 * bentuk balasan Live API. Kalau Google mengubah nama field, satu berkas test
 * ini yang gagal lebih dulu — bukan mikrofon pengguna di lapangan.
 */
export function parseServerMessage(msg) {
  const events = []
  if (!msg || typeof msg !== 'object') return events

  if (msg.setupComplete) events.push({ type: LIVE_EVENT.READY })

  const sc = msg.serverContent
  if (sc) {
    // Interupsi diperiksa PALING AWAL: pengguna menyela berarti seluruh audio
    // yang masih mengantre harus dibuang sebelum apa pun yang lain diproses.
    if (sc.interrupted) events.push({ type: LIVE_EVENT.INTERRUPTED })

    const parts = sc.modelTurn?.parts || []
    for (const p of parts) {
      const inline = p.inlineData
      if (inline?.data && String(inline.mimeType || '').startsWith('audio/')) {
        events.push({ type: LIVE_EVENT.AUDIO, data: inline.data })
      }
      if (typeof p.text === 'string' && p.text) {
        events.push({ type: LIVE_EVENT.OUTPUT_TEXT, text: p.text })
      }
    }

    // Transkrip dipakai untuk menampilkan percakapan di layar. Tanpa ini
    // pengguna hanya mendengar, tidak bisa memeriksa apa yang AI tangkap —
    // dan pemeriksaan itu bagian dari perlindungan sebelum data tersimpan.
    if (sc.inputTranscription?.text) {
      events.push({ type: LIVE_EVENT.INPUT_TEXT, text: sc.inputTranscription.text })
    }
    if (sc.outputTranscription?.text) {
      events.push({ type: LIVE_EVENT.OUTPUT_TEXT, text: sc.outputTranscription.text })
    }
    if (sc.turnComplete) events.push({ type: LIVE_EVENT.TURN_COMPLETE })
  }

  const calls = msg.toolCall?.functionCalls
  if (Array.isArray(calls) && calls.length) {
    events.push({ type: LIVE_EVENT.TOOL_CALL, calls })
  }

  // goAway = server akan menutup sesi (batas umur koneksi). Bukan error;
  // sesi harus disambung ulang diam-diam supaya pengguna tidak merasa putus.
  if (msg.goAway) events.push({ type: LIVE_EVENT.GO_AWAY, timeLeft: msg.goAway.timeLeft })

  return events
}

/** Bingkai setup — pesan pertama yang WAJIB dikirim setelah soket terbuka. */
export function buildSetupFrame({
  model,
  systemInstruction,
  tools = [],
  voiceName = 'Aoede',
  audioOut = true,
}) {
  const setup = {
    model: model.startsWith('models/') ? model : `models/${model}`,
    generationConfig: {
      // Live API hanya menerima SATU modalitas keluaran per sesi.
      responseModalities: [audioOut ? 'AUDIO' : 'TEXT'],
      temperature: 0.3,
    },
    systemInstruction: { parts: [{ text: systemInstruction }] },
  }

  if (audioOut) {
    setup.generationConfig.speechConfig = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      // languageCode SENGAJA tidak diisi. Mengunci bahasa keluaran di sini
      // membuat model tetap menjawab Indonesia walau pengguna beralih ke
      // Inggris — persis kebalikan dari perilaku dwibahasa yang diminta.
      // Pemilihan bahasa diserahkan ke system instruction.
    }
    // Transkrip dua arah dinyalakan supaya percakapan bisa ditampilkan dan
    // dicatat, bukan hanya terdengar sekilas.
    setup.inputAudioTranscription = {}
    setup.outputAudioTranscription = {}
  }

  if (tools.length) setup.tools = [{ functionDeclarations: tools }]

  return { setup }
}

/**
 * Sesi Live yang berumur panjang.
 *
 * Kelas ini sengaja TIDAK tahu apa-apa soal mikrofon maupun speaker. Ia hanya
 * mengubah pesan menjadi event; keputusan kapan mikrofon boleh mengirim ada di
 * useLiveVoice.js. Pemisahan itu yang membuat aturan anti-gema bisa diuji
 * tanpa membuka WebSocket sungguhan.
 */
export class LiveSession {
  constructor({ model, systemInstruction, tools, voiceName, audioOut = true, onEvent } = {}) {
    this.model = model
    this.systemInstruction = systemInstruction
    this.tools = tools || []
    this.voiceName = voiceName
    this.audioOut = audioOut
    this.onEvent = onEvent || (() => {})
    this.ws = null
    this.ready = false
    this.closedByUser = false
  }

  connect(token) {
    return new Promise((resolve, reject) => {
      let settled = false
      let ws
      try {
        ws = new WebSocket(liveSocketUrl(token))
      } catch (e) {
        reject(e); return
      }
      ws.binaryType = 'blob'
      this.ws = ws
      this.closedByUser = false

      ws.onopen = () => {
        ws.send(JSON.stringify(buildSetupFrame({
          model: this.model,
          systemInstruction: this.systemInstruction,
          tools: this.tools,
          voiceName: this.voiceName,
          audioOut: this.audioOut,
        })))
      }

      ws.onmessage = async (ev) => {
        let raw = ev.data
        // Live API membalas sebagai Blob biner walau isinya JSON.
        if (raw instanceof Blob) raw = await raw.text()
        let msg
        try { msg = JSON.parse(raw) } catch { return }

        for (const event of parseServerMessage(msg)) {
          if (event.type === LIVE_EVENT.READY) {
            this.ready = true
            if (!settled) { settled = true; resolve(this) }
          }
          this.onEvent(event)
        }
      }

      ws.onerror = () => {
        // Event error WebSocket tidak membawa alasan apa pun (aturan keamanan
        // browser). Sebab sebenarnya — token kedaluwarsa, model salah — baru
        // terbaca dari kode penutupan di onclose.
        if (!settled) { settled = true; reject(new Error('LIVE_SOCKET_ERROR')) }
      }

      ws.onclose = (ev) => {
        this.ready = false
        this.onEvent({
          type: LIVE_EVENT.CLOSED,
          code: ev.code,
          reason: ev.reason,
          byUser: this.closedByUser,
        })
        if (!settled) { settled = true; reject(new Error(ev.reason || `LIVE_CLOSED_${ev.code}`)) }
      }
    })
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN && this.ready
  }

  _send(obj) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(obj))
    return true
  }

  /**
   * Kirim satu potongan audio mikrofon.
   *
   * Pemanggil bertanggung jawab TIDAK memanggil ini saat AI sedang bicara.
   * Pemeriksaan kedua ada di sini juga (`this.open`) tapi itu soal koneksi,
   * bukan gema — gerbang anti-gema hidup di lapisan audio, sedekat mungkin
   * dengan sumber sampel.
   */
  sendAudio(base64Pcm, mimeType) {
    return this._send({ realtimeInput: { audio: { data: base64Pcm, mimeType } } })
  }

  /** Kirim teks sebagai giliran pengguna (dipakai jalur perintah/CRUD). */
  sendText(text, turnComplete = true) {
    return this._send({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete,
      },
    })
  }

  /** Balasan hasil eksekusi fungsi, supaya model tahu perintah sudah dijalankan. */
  sendToolResponse(responses) {
    return this._send({ toolResponse: { functionResponses: responses } })
  }

  /**
   * Beri tahu server bahwa aliran audio pengguna berhenti sementara.
   * Dikirim tepat sebelum mikrofon ditutup saat AI mulai bicara: tanpa ini
   * server menganggap alirannya terpotong mendadak dan kadang memaksa giliran
   * baru di tengah jawaban.
   */
  signalAudioStreamEnd() {
    return this._send({ realtimeInput: { audioStreamEnd: true } })
  }

  close() {
    this.closedByUser = true
    this.ready = false
    try { this.ws?.close(1000, 'client-stop') } catch { /* sudah tertutup */ }
    this.ws = null
  }
}
