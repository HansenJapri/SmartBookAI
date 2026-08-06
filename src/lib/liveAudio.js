// ============================================================
// Lapisan audio untuk sesi suara 2 arah (Gemini Live API).
//
// Berkas ini memegang SATU tanggung jawab: memindahkan sampel audio antara
// perangkat keras dan WebSocket, dengan satu aturan yang tidak boleh dilanggar —
// mikrofon tidak boleh mengirim apa pun selama speaker sedang mengeluarkan
// suara AI. Itulah akar bug "AI bicara sendiri tanpa henti": suara AI masuk
// lagi lewat mikrofon, dikira ucapan pengguna, dijawab, dan seterusnya.
//
// Peredam gema bawaan browser (echoCancellation) dipasang, tapi TIDAK dijadikan
// satu-satunya pertahanan. AEC browser dikalibrasi untuk jalur WebRTC; audio
// yang kita render sendiri lewat Web Audio API tidak selalu ikut jadi referensi
// pembatalan — terutama di Bluetooth, speaker eksternal, atau saat sample rate
// masukan dan keluaran berbeda. Jadi AEC dipakai sebagai lapisan pertama, dan
// gerbang keras (buffer dibuang) sebagai lapisan kedua yang menentukan.
//
// Fungsi murni di bagian atas sengaja bebas DOM supaya bisa diuji di Node.
// ============================================================

// Gemini Live menerima PCM 16-bit little-endian 16 kHz mono, dan mengirim
// balik PCM 16-bit 24 kHz mono. Angka ini bagian dari kontrak API, bukan
// preferensi kita — jangan diubah tanpa mengubah mimeType yang dikirim.
export const INPUT_SAMPLE_RATE = 16000
export const OUTPUT_SAMPLE_RATE = 24000
export const INPUT_MIME = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`

// Panjang potongan yang dikirim ke server. 128 ms cukup kecil supaya deteksi
// bicara server terasa responsif, tapi cukup besar supaya tidak membanjiri
// WebSocket dengan ribuan pesan kecil per menit.
export const FRAME_SAMPLES = INPUT_SAMPLE_RATE * 0.128

// Hening yang dijadwalkan SETELAH potongan suara AI terakhir. Ini bukan jeda
// tebak-tebakan: buffer ini ikut masuk antrean pemutaran, dan `onended`-nya
// yang menjadi penanda "AI benar-benar selesai". Gunanya menutupi ekor fisik
// suara — dengung speaker dan pantulan ruangan masih terdengar sesaat setelah
// sampel terakhir habis, dan mikrofon yang dibuka terlalu cepat akan
// menangkapnya sebagai "ucapan pengguna".
export const TAIL_GUARD_SEC = 0.18

// ---------- Konversi sampel (murni) ----------

/**
 * Float32 [-1..1] -> PCM 16-bit signed.
 * Nilai di luar rentang DIJEPIT, bukan dibiarkan meluap: sampel yang meluap
 * berubah tanda dan terdengar sebagai letupan keras di sisi server.
 */
export function floatToPcm16(input) {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** PCM 16-bit signed -> Float32 [-1..1], untuk diputar lewat AudioBuffer. */
export function pcm16ToFloat(int16) {
  const out = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 0x8000
  return out
}

/**
 * Turunkan sample rate ke `toRate`.
 *
 * Memakai RERATA seluruh sampel dalam satu jendela, bukan mengambil satu
 * sampel tiap N (decimation). Decimation murah tapi melipat frekuensi tinggi
 * menjadi desis yang membuat pengenalan suara meleset; rerata bertindak
 * sebagai low-pass sederhana dan jauh lebih jernih untuk ucapan.
 */
export function downsampleTo(input, fromRate, toRate = INPUT_SAMPLE_RATE) {
  if (!(fromRate > 0) || fromRate === toRate) return Float32Array.from(input)
  if (fromRate < toRate) {
    // Perangkat di bawah 16 kHz sangat jarang. Menaikkan sample rate tidak
    // menambah informasi apa pun, jadi kirim apa adanya dan biarkan server
    // yang menafsirkan — lebih jujur daripada interpolasi palsu.
    return Float32Array.from(input)
  }
  const ratio = fromRate / toRate
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    let n = 0
    for (let j = start; j < end; j++) { sum += input[j]; n++ }
    out[i] = n ? sum / n : 0
  }
  return out
}

/** Int16Array -> base64 (bentuk yang diminta Live API untuk inlineData). */
export function pcm16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength)
  let bin = ''
  // Dipotong per blok: apply() dengan puluhan ribu argumen sekaligus melebihi
  // batas argumen dan melempar RangeError di potongan audio yang panjang.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** base64 -> Int16Array (audio balasan dari server). */
export function base64ToPcm16(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  // byteLength ganjil berarti potongan terpotong di tengah sampel; buang byte
  // sisa daripada membiarkan Int16Array melempar.
  const usable = bytes.byteLength - (bytes.byteLength % 2)
  return new Int16Array(bytes.buffer, 0, usable / 2)
}

/**
 * Apakah frame mikrofon ini boleh dikirim ke server?
 *
 * Dipisah sebagai fungsi murni supaya aturan gerbang bisa diuji tanpa browser —
 * ini satu-satunya aturan yang mencegah lingkaran umpan balik, jadi ia layak
 * punya test sendiri alih-alih tersembunyi di dalam callback audio.
 */
export function shouldSendFrame({ capturing, aiSpeaking, muted }) {
  return Boolean(capturing) && !aiSpeaking && !muted
}

/**
 * Apakah peramban ini sanggup menjalankan sesi suara 2 arah?
 *
 * Sengaja TIDAK memeriksa SpeechRecognition. Jalur lama memakai Web Speech API
 * dan tab Suara ikut disembunyikan bila API itu tidak ada — padahal jalur baru
 * sama sekali tidak memerlukannya. Akibatnya Firefox dan Safari kehilangan
 * fitur yang sebenarnya bisa mereka jalankan.
 */
export function liveVoiceSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(
    (window.AudioContext || window.webkitAudioContext)
    && typeof window.AudioWorkletNode !== 'undefined'
    && window.WebSocket
    && navigator.mediaDevices?.getUserMedia,
  )
}

// ---------- Tangkapan mikrofon ----------

// Prosesor dipasang sebagai AudioWorklet supaya pengambilan sampel berjalan di
// thread audio: ScriptProcessorNode (API lama) berjalan di main thread dan
// mulai menjatuhkan sampel begitu React me-render daftar percakapan. Modulnya
// ditulis sebagai string lalu dijadikan Blob URL — dengan begitu tidak ada
// berkas statis tambahan yang harus ikut proses build Vite.
const WORKLET_SOURCE = `
class MicTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this._open = false
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'gate') this._open = Boolean(e.data.open)
    }
  }
  process(inputs) {
    // Gerbang diperiksa di sini, di titik paling awal yang mungkin. Saat
    // tertutup, sampel tidak dibuffer dan tidak dikirim ke main thread sama
    // sekali — suara AI yang bocor lewat speaker berhenti persis di sini.
    if (!this._open) return true
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('mic-tap', MicTap)
`

/**
 * Membuka mikrofon dan memanggil `onFrame(Int16Array)` untuk tiap potongan
 * yang layak kirim. Selama gerbang tertutup, `onFrame` tidak pernah dipanggil.
 */
export class MicCapture {
  constructor({ onFrame, onError } = {}) {
    this.onFrame = onFrame || (() => {})
    this.onError = onError || (() => {})
    this.stream = null
    this.ctx = null
    this.node = null
    this.source = null
    this.gateOpen = false
    this.pending = []
    this.pendingLength = 0
  }

  async start() {
    // Ketiga constraint ini WAJIB. echoCancellation adalah lapisan pertama
    // melawan gema; noiseSuppression menekan kipas/keramaian warung yang
    // memicu deteksi bicara palsu; autoGainControl menyamakan volume antara
    // pengguna yang bicara dekat dan jauh dari perangkat.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    })

    // Sample rate context dibiarkan mengikuti perangkat, lalu diturunkan
    // sendiri ke 16 kHz. Memaksa AudioContext ke 16 kHz memang lebih ringkas,
    // tapi di sebagian browser hal itu menyisipkan resampler yang membuat
    // peredam gema kehilangan acuan waktunya.
    this.ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    this.source = this.ctx.createMediaStreamSource(this.stream)

    const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
    try {
      await this.ctx.audioWorklet.addModule(blobUrl)
    } finally {
      URL.revokeObjectURL(blobUrl)
    }

    this.node = new AudioWorkletNode(this.ctx, 'mic-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    })
    this.node.port.onmessage = (e) => this._consume(e.data)
    this.source.connect(this.node)

    // Gerbang menyusul sesudah semuanya siap: kalau dibuka sebelum node
    // terpasang, potongan pertama hilang dan kata pertama pengguna terpotong.
    this.setGate(true)
  }

  /** true = mikrofon boleh mengirim; false = sampel dibuang di thread audio. */
  setGate(open) {
    this.gateOpen = Boolean(open)
    this.node?.port.postMessage({ type: 'gate', open: this.gateOpen })
    if (!this.gateOpen) {
      // Buang sisa buffer yang belum penuh. Tanpa ini, potongan yang direkam
      // TEPAT sebelum AI mulai bicara akan terkirim setelah AI selesai dan
      // dianggap sebagai giliran baru pengguna.
      this.pending = []
      this.pendingLength = 0
    }
  }

  _consume(chunk) {
    if (!this.gateOpen || !chunk?.length) return
    const down = downsampleTo(chunk, this.ctx.sampleRate, INPUT_SAMPLE_RATE)
    this.pending.push(down)
    this.pendingLength += down.length

    while (this.pendingLength >= FRAME_SAMPLES) {
      const frame = new Float32Array(FRAME_SAMPLES)
      let filled = 0
      while (filled < FRAME_SAMPLES) {
        const head = this.pending[0]
        const need = FRAME_SAMPLES - filled
        if (head.length <= need) {
          frame.set(head, filled)
          filled += head.length
          this.pending.shift()
        } else {
          frame.set(head.subarray(0, need), filled)
          this.pending[0] = head.subarray(need)
          filled += need
        }
      }
      this.pendingLength -= FRAME_SAMPLES
      // Diperiksa lagi: gerbang bisa tertutup di tengah perakitan frame.
      if (this.gateOpen) this.onFrame(floatToPcm16(frame))
    }
  }

  stop() {
    this.setGate(false)
    try { this.node?.port.close() } catch { /* sudah tertutup */ }
    try { this.source?.disconnect() } catch { /* sudah lepas */ }
    try { this.node?.disconnect() } catch { /* sudah lepas */ }
    // Track WAJIB dihentikan satu per satu. Menutup AudioContext saja tidak
    // mematikan indikator mikrofon di tab, dan pengguna berhak melihat lampu
    // itu padam begitu sesi dimatikan.
    this.stream?.getTracks().forEach((t) => { try { t.stop() } catch { /* abaikan */ } })
    try { this.ctx?.close() } catch { /* sudah tertutup */ }
    this.stream = null; this.ctx = null; this.node = null; this.source = null
  }
}

// ---------- Pemutaran balasan AI ----------

/**
 * Antrean pemutaran audio AI.
 *
 * Potongan dijadwalkan berurutan memakai jam AudioContext, bukan setTimeout:
 * jam audio tidak ikut tersendat saat main thread sibuk, sehingga sambungan
 * antar potongan tidak berbunyi "klik". Akhir giliran ditentukan oleh `onended`
 * dari buffer hening penjaga yang selalu dijadwalkan paling akhir.
 */
export class AudioPlayer {
  constructor({ onSpeakingChange } = {}) {
    this.onSpeakingChange = onSpeakingChange || (() => {})
    this.ctx = null
    this.sources = new Set()
    this.nextStartAt = 0
    this.speaking = false
    this.guard = null
    // Naik tiap kali giliran dibatalkan (barge-in). Callback `onended` dari
    // giliran lama membandingkan nilai ini sebelum bertindak, supaya giliran
    // yang sudah dibuang tidak ikut mengumumkan "AI selesai bicara" dan
    // membuka mikrofon di tengah giliran yang baru.
    this.turn = 0
  }

  _ensureCtx() {
    if (!this.ctx) {
      // Context keluaran dibuat pada 24 kHz — sama persis dengan keluaran
      // Gemini Live — supaya tidak ada resampling yang menggeser nada suara.
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: OUTPUT_SAMPLE_RATE,
      })
    }
    return this.ctx
  }

  /** Wajib dipanggil dari gestur pengguna (klik tombol) agar audio diizinkan. */
  async unlock() {
    const ctx = this._ensureCtx()
    if (ctx.state === 'suspended') await ctx.resume()
  }

  _setSpeaking(v) {
    if (this.speaking === v) return
    this.speaking = v
    this.onSpeakingChange(v)
  }

  /** Menambahkan potongan PCM 24 kHz ke antrean. */
  enqueue(int16) {
    if (!int16?.length) return
    const ctx = this._ensureCtx()
    const myTurn = this.turn

    const buf = ctx.createBuffer(1, int16.length, OUTPUT_SAMPLE_RATE)
    buf.copyToChannel(pcm16ToFloat(int16), 0)

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)

    // Penjaga hening lama dibatalkan: potongan baru berarti giliran BELUM
    // selesai, jadi penanda selesai harus mundur ke belakang potongan ini.
    this._clearGuard()

    const startAt = Math.max(ctx.currentTime, this.nextStartAt)
    src.start(startAt)
    this.nextStartAt = startAt + buf.duration

    this.sources.add(src)
    src.onended = () => { this.sources.delete(src) }

    this._setSpeaking(true)
    this._scheduleGuard(myTurn)
  }

  _clearGuard() {
    if (!this.guard) return
    this.guard.onended = null
    try { this.guard.stop() } catch { /* belum sempat mulai */ }
    this.guard = null
  }

  /**
   * Jadwalkan hening penjaga di ujung antrean. `onended`-nya adalah SATU-SATUNYA
   * sinyal yang membuka kembali mikrofon — inilah pengganti setTimeout.
   */
  _scheduleGuard(myTurn) {
    const ctx = this.ctx
    const frames = Math.ceil(TAIL_GUARD_SEC * OUTPUT_SAMPLE_RATE)
    const buf = ctx.createBuffer(1, frames, OUTPUT_SAMPLE_RATE)  // isinya nol
    const g = ctx.createBufferSource()
    g.buffer = buf
    g.connect(ctx.destination)
    g.onended = () => {
      // Giliran sudah basi (dibatalkan / diinterupsi) — jangan sentuh state.
      if (myTurn !== this.turn) return
      this.guard = null
      this._setSpeaking(false)
    }
    g.start(Math.max(ctx.currentTime, this.nextStartAt))
    this.guard = g
  }

  /**
   * Hentikan seketika seluruh audio AI yang tersisa.
   * Dipakai saat server mengirim `interrupted` (pengguna menyela) dan saat sesi
   * dimatikan — antrean lama tidak boleh terus berbunyi setelah itu.
   */
  interrupt() {
    this.turn += 1
    this._clearGuard()
    this.sources.forEach((s) => {
      s.onended = null
      try { s.stop() } catch { /* sudah selesai */ }
    })
    this.sources.clear()
    this.nextStartAt = this.ctx ? this.ctx.currentTime : 0
    this._setSpeaking(false)
  }

  close() {
    this.interrupt()
    try { this.ctx?.close() } catch { /* sudah tertutup */ }
    this.ctx = null
  }
}
