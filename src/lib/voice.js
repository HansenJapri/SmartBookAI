// ============================================================
// Logika murni untuk sesi suara 2 arah (tanpa DOM, mudah diuji).
//
// Pencocokan konfirmasi & perintah berhenti di sini dipakai oleh jalur suara
// Gemini Live (voiceCommand.js + useLiveVoice.js). Bagian yang menyentuh
// browser ada di useLiveVoice.js dan liveAudio.js.
// ============================================================

export const SpeechRecCtor = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null

export const voiceSupported = () => Boolean(SpeechRecCtor)

// ---------- Klasifikasi error pengenalan suara ----------
//
// Ini inti dari "sesi tidak boleh mati sendiri". Web Speech API memancarkan
// `onend` terus-menerus walau `continuous = true`: Chrome menutup aliran tiap
// beberapa detik hening, dan tiap kali itu terjadi kita HARUS menyalakannya
// lagi. Tetapi tidak semua error boleh di-restart — izin mikrofon yang ditolak
// akan berputar tanpa henti (dan memunculkan dialog izin berulang) kalau
// diperlakukan sama seperti hening biasa.
export const VOICE_ERROR = {
  // Wajar & sering: tidak ada suara, atau aliran ditutup browser. Sambung lagi.
  TRANSIENT: 'transient',
  // Butuh tindakan pengguna (izin mikrofon). Sesi harus berhenti & memberi tahu.
  FATAL: 'fatal',
  // Jaringan/layanan: boleh dicoba lagi, tapi dengan jeda yang melebar.
  RETRY: 'retry',
}

export function classifyVoiceError(code) {
  switch (code) {
    case 'no-speech':
    case 'aborted':
    case 'audio-capture-timeout':
      return VOICE_ERROR.TRANSIENT
    case 'not-allowed':
    case 'service-not-allowed':
    case 'audio-capture':
      return VOICE_ERROR.FATAL
    case 'network':
    case 'bad-grammar':
    case 'language-not-supported':
      return VOICE_ERROR.RETRY
    default:
      // Kode tak dikenal diperlakukan sebagai bisa-dicoba-lagi, BUKAN fatal:
      // memutus sesi karena kode asing lebih merugikan daripada mencoba ulang.
      return VOICE_ERROR.RETRY
  }
}

export const VOICE_FATAL_MESSAGE = {
  'not-allowed': 'Izin mikrofon ditolak. Aktifkan izin mikrofon di pengaturan peramban, lalu nyalakan lagi.',
  'service-not-allowed': 'Peramban memblokir layanan pengenalan suara. Coba peramban lain (mis. Chrome).',
  'audio-capture': 'Mikrofon tidak terbaca. Pastikan perangkat mikrofon terpasang dan tidak dipakai aplikasi lain.',
}

// Jeda sebelum menyambung ulang. Hening biasa disambung nyaris seketika supaya
// pengguna tidak merasa terputus; kegagalan jaringan melebar sampai batas atas
// agar tidak menghantam layanan berulang kali saat koneksi mati.
export const RESTART_BASE_MS = 250
export const RESTART_MAX_MS = 8000

export function restartDelay(kind, consecutiveFailures = 0) {
  if (kind === VOICE_ERROR.TRANSIENT) return RESTART_BASE_MS
  const backoff = RESTART_BASE_MS * 2 ** Math.max(0, consecutiveFailures)
  return Math.min(RESTART_MAX_MS, backoff)
}

// ---------- Konfirmasi lisan (Voice Double-Check) ----------
//
// Perintah suara TIDAK pernah langsung tersimpan. Asisten membacakan ringkasan
// draft, lalu jawaban pengguna dicocokkan di sini. Yang tidak jelas TIDAK
// dianggap "ya": pertanyaannya diulang. Diam-diam menyimpan transaksi karena
// salah dengar adalah kegagalan yang paling mahal di fitur ini.
// Persetujuan dibagi dua tingkat karena "ya" berperilaku berbeda dari "benar".
//
// KUAT: tetap jelas maknanya di tengah kalimat ("sudah benar kok", "oke simpan").
// Daftar ID dan EN digabung: pengenal suara kadang mengembalikan kata Inggris
// walau bahasanya diset id-ID (dan sebaliknya), jadi menerima keduanya membuat
// pencocokan lebih tahan banting tanpa menambah risiko.
const STRONG_CONFIRM = [
  // Indonesia
  'benar', 'bener', 'betul', 'simpan', 'setuju', 'cocok', 'lanjut',
  'oke', 'ok', 'okay', 'sip',
  // English
  'yes', 'yeah', 'yep', 'correct', 'right', 'save', 'confirm', 'agree', 'sure',
]
// LEMAH: hanya berarti setuju bila BERDIRI SENDIRI. "ya" adalah kata pengisi
// yang sangat umum dalam bahasa Indonesia lisan — "apa ya", "gimana ya",
// "hmm ya" adalah keraguan, bukan persetujuan. Memperlakukannya sama dengan
// "benar" membuat asisten menyimpan transaksi saat pengguna justru sedang
// berpikir. Ini pernah lolos dan tertangkap test.
const WEAK_CONFIRM = ['ya', 'iya', 'iyah', 'yaa', 'yoi', 'gas', 'hooh']
const CONFIRM_WORDS = [...STRONG_CONFIRM, ...WEAK_CONFIRM]

// Kalimat panjang yang kebetulan memuat kata setuju bukan persetujuan yang
// tegas — pengguna sedang bercerita, bukan menjawab.
const MAX_CONFIRM_WORDS = 5
const REJECT_WORDS = [
  // Indonesia
  'tidak', 'ga', 'gak', 'nggak', 'ngga', 'enggak', 'bukan', 'salah', 'batal',
  'batalkan', 'jangan', 'hapus', 'ulang', 'ubah', 'koreksi', 'keliru',
  // English
  'no', 'nope', 'wrong', 'cancel', 'stop', 'incorrect', 'delete', 'redo', 'change',
]

export const CONFIRM_RESULT = { YES: 'yes', NO: 'no', UNCLEAR: 'unclear' }

export function normalizeSpeech(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?;:"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchConfirmation(text) {
  const s = normalizeSpeech(text)
  if (!s) return CONFIRM_RESULT.UNCLEAR
  const words = s.split(' ')

  // Penolakan diperiksa LEBIH DULU dan menang bila keduanya muncul.
  // "ya salah" atau "oke batalkan" harus berarti BATAL, bukan simpan —
  // arah yang lebih aman saat kalimatnya campur.
  const hasReject = REJECT_WORDS.some((w) => words.includes(w) || s.startsWith(w + ' '))
  if (hasReject) return CONFIRM_RESULT.NO

  // Persetujuan lemah hanya sah bila SELURUH ucapan terdiri dari kata setuju
  // ("ya", "iya ya"). Begitu ada kata lain ("apa ya"), maknanya menjadi ragu
  // dan kita mengulang pertanyaan alih-alih menyimpan.
  if (words.every((w) => CONFIRM_WORDS.includes(w))) return CONFIRM_RESULT.YES

  // Persetujuan kuat sah di dalam kalimat pendek.
  if (words.length <= MAX_CONFIRM_WORDS && words.some((w) => STRONG_CONFIRM.includes(w))) {
    return CONFIRM_RESULT.YES
  }

  return CONFIRM_RESULT.UNCLEAR
}

// Kata pemicu untuk mematikan sesi lewat suara. Sengaja TIDAK memakai daftar
// REJECT_WORDS: "batal" saat mengisi form berarti batalkan draft, bukan matikan
// mikrofon. Hanya frasa eksplisit yang menghentikan sesi.
const STOP_PHRASES = [
  'matikan suara', 'matikan mikrofon', 'stop suara', 'berhenti mendengarkan',
  'nonaktifkan suara', 'tutup asisten suara', 'selesai bicara',
  'turn off voice', 'turn off the microphone', 'stop listening', 'disable voice',
]

export function isStopCommand(text) {
  const s = normalizeSpeech(text)
  return STOP_PHRASES.some((p) => s === p || s.includes(p))
}

// ---------- Perakitan transkrip ----------
//
// Dengan continuous + interimResults, onresult membawa SELURUH daftar hasil
// sejak sesi mulai — bukan hanya yang baru. Mengambil semuanya tiap event akan
// menggandakan kalimat. Yang diambil hanya hasil final sejak `fromIndex`.
export function collectFinalTranscript(results, fromIndex = 0) {
  let final = ''
  let interim = ''
  for (let i = fromIndex; i < results.length; i++) {
    const r = results[i]
    if (!r || !r[0]) continue
    if (r.isFinal) final += r[0].transcript
    else interim += r[0].transcript
  }
  return { final: final.trim(), interim: interim.trim() }
}

// Ucapan pendek tanpa isi ("eh", "hmm", dehem) tidak layak dikirim ke AI —
// memboroskan kuota dan membuat asisten menjawab hal yang tidak ditanyakan.
const FILLER = new Set(['eh', 'hmm', 'hm', 'em', 'ehm', 'ah', 'oh', 'anu', 'apa', 'itu', 'ya'])

export function isMeaningfulUtterance(text) {
  const s = normalizeSpeech(text)
  if (s.length < 3) return false
  const words = s.split(' ').filter(Boolean)
  return words.some((w) => !FILLER.has(w))
}
