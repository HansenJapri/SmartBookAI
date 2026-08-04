import { describe, it, expect } from 'vitest'
import {
  CONFIRM_RESULT, RESTART_BASE_MS, RESTART_MAX_MS, VOICE_ERROR,
  classifyVoiceError, collectFinalTranscript, isMeaningfulUtterance,
  isStopCommand, matchConfirmation, normalizeSpeech, restartDelay,
} from '../voice'

// ============================================================
// Sesi suara persisten & konfirmasi lisan.
// ============================================================

describe('classifyVoiceError', () => {
  // Syarat fitur: sesi hanya berhenti saat pengguna menekan nonaktifkan.
  // Hening dan penutupan aliran oleh browser adalah kejadian NORMAL yang
  // terjadi tiap beberapa detik — kalau ini dianggap fatal, sesi mati sendiri.
  it('hening & aborted bersifat sementara (sesi disambung lagi)', () => {
    expect(classifyVoiceError('no-speech')).toBe(VOICE_ERROR.TRANSIENT)
    expect(classifyVoiceError('aborted')).toBe(VOICE_ERROR.TRANSIENT)
  })

  // Kebalikannya: izin mikrofon ditolak TIDAK boleh disambung terus, karena
  // tiap percobaan memunculkan dialog izin lagi.
  it('izin ditolak bersifat fatal', () => {
    expect(classifyVoiceError('not-allowed')).toBe(VOICE_ERROR.FATAL)
    expect(classifyVoiceError('service-not-allowed')).toBe(VOICE_ERROR.FATAL)
    expect(classifyVoiceError('audio-capture')).toBe(VOICE_ERROR.FATAL)
  })

  it('gangguan jaringan boleh dicoba lagi', () => {
    expect(classifyVoiceError('network')).toBe(VOICE_ERROR.RETRY)
  })

  // Memutus sesi karena kode yang tidak dikenal lebih merugikan daripada mencoba lagi.
  it('kode tak dikenal tidak pernah fatal', () => {
    expect(classifyVoiceError('sesuatu-yang-baru')).toBe(VOICE_ERROR.RETRY)
    expect(classifyVoiceError(undefined)).toBe(VOICE_ERROR.RETRY)
  })
})

describe('restartDelay', () => {
  it('hening disambung nyaris seketika', () => {
    expect(restartDelay(VOICE_ERROR.TRANSIENT, 0)).toBe(RESTART_BASE_MS)
    // Hening berulang tetap cepat — tidak boleh melambat karena pengguna diam.
    expect(restartDelay(VOICE_ERROR.TRANSIENT, 9)).toBe(RESTART_BASE_MS)
  })

  it('kegagalan beruntun melebar secara eksponensial', () => {
    expect(restartDelay(VOICE_ERROR.RETRY, 0)).toBe(RESTART_BASE_MS)
    expect(restartDelay(VOICE_ERROR.RETRY, 1)).toBe(RESTART_BASE_MS * 2)
    expect(restartDelay(VOICE_ERROR.RETRY, 3)).toBe(RESTART_BASE_MS * 8)
  })

  it('tidak pernah melewati batas atas', () => {
    expect(restartDelay(VOICE_ERROR.RETRY, 50)).toBe(RESTART_MAX_MS)
  })
})

describe('matchConfirmation (Voice Double-Check)', () => {
  it('mengenali persetujuan umum bahasa sehari-hari', () => {
    for (const s of ['ya', 'iya', 'benar', 'betul', 'oke', 'simpan', 'sip', 'setuju']) {
      expect(matchConfirmation(s)).toBe(CONFIRM_RESULT.YES)
    }
  })

  it('mengenali penolakan', () => {
    for (const s of ['tidak', 'gak', 'salah', 'batal', 'jangan', 'ulang']) {
      expect(matchConfirmation(s)).toBe(CONFIRM_RESULT.NO)
    }
  })

  // Paling penting: kalimat campur harus jatuh ke sisi AMAN (batal).
  // Salah dengar yang menyimpan transaksi jauh lebih mahal daripada
  // salah dengar yang menyuruh pengguna mengulang.
  it('penolakan menang saat kalimat campur', () => {
    expect(matchConfirmation('ya salah')).toBe(CONFIRM_RESULT.NO)
    expect(matchConfirmation('oke batalkan saja')).toBe(CONFIRM_RESULT.NO)
    expect(matchConfirmation('iya tapi jangan disimpan')).toBe(CONFIRM_RESULT.NO)
  })

  it('yang tidak jelas TIDAK dianggap setuju', () => {
    for (const s of ['', '   ', 'hmm', 'terus gimana', 'nasi goreng dua puluh ribu']) {
      expect(matchConfirmation(s)).toBe(CONFIRM_RESULT.UNCLEAR)
    }
  })

  it('tahan terhadap tanda baca & huruf besar dari mesin pengenal', () => {
    expect(matchConfirmation('Ya, benar.')).toBe(CONFIRM_RESULT.YES)
    expect(matchConfirmation('TIDAK!')).toBe(CONFIRM_RESULT.NO)
  })

  // "iyalah" mengandung "iya" sebagai substring; pencocokan harus per KATA
  // supaya kata lain yang kebetulan memuatnya tidak salah tafsir.
  it('mencocokkan per kata, bukan substring', () => {
    expect(matchConfirmation('bayar')).toBe(CONFIRM_RESULT.UNCLEAR)
    expect(matchConfirmation('yakin banget')).toBe(CONFIRM_RESULT.UNCLEAR)
  })

  // REGRESI. "ya" adalah kata pengisi paling umum dalam bahasa Indonesia lisan.
  // Versi pertama menganggap kehadiran "ya" di mana pun sebagai persetujuan,
  // sehingga "apa ya" — yang justru berarti pengguna sedang RAGU — menyimpan
  // transaksi. Persetujuan lemah kini hanya sah bila berdiri sendiri.
  it('"ya" sebagai kata pengisi keraguan tidak menyimpan', () => {
    expect(matchConfirmation('apa ya')).toBe(CONFIRM_RESULT.UNCLEAR)
    expect(matchConfirmation('gimana ya')).toBe(CONFIRM_RESULT.UNCLEAR)
    expect(matchConfirmation('hmm ya bentar')).toBe(CONFIRM_RESULT.UNCLEAR)
  })

  it('"ya" yang berdiri sendiri tetap sah sebagai persetujuan', () => {
    expect(matchConfirmation('ya')).toBe(CONFIRM_RESULT.YES)
    expect(matchConfirmation('iya ya')).toBe(CONFIRM_RESULT.YES)
    expect(matchConfirmation('ya benar')).toBe(CONFIRM_RESULT.YES)
  })

  // Kalimat panjang yang kebetulan memuat kata setuju bukan jawaban tegas.
  it('kalimat panjang tidak dianggap persetujuan', () => {
    expect(matchConfirmation('oke jadi tadi saya jual berapa banyak sih kemarin'))
      .toBe(CONFIRM_RESULT.UNCLEAR)
  })
})

describe('isStopCommand', () => {
  it('hanya frasa eksplisit yang mematikan sesi', () => {
    expect(isStopCommand('matikan suara')).toBe(true)
    expect(isStopCommand('berhenti mendengarkan')).toBe(true)
  })

  // "batal" saat mengisi form berarti batalkan draft — BUKAN matikan mikrofon.
  // Kalau keduanya tercampur, pengguna kehilangan sesi tiap kali salah ucap.
  it('kata batal biasa tidak mematikan sesi', () => {
    expect(isStopCommand('batal')).toBe(false)
    expect(isStopCommand('tidak')).toBe(false)
    expect(isStopCommand('stop')).toBe(false)
  })
})

describe('collectFinalTranscript', () => {
  const mk = (rows) => rows.map((r) => Object.assign([{ transcript: r.t }], { isFinal: r.f }))

  it('memisahkan hasil final dari sementara', () => {
    const res = mk([{ t: 'laku tiga donat ', f: true }, { t: 'lima belas ribu', f: false }])
    expect(collectFinalTranscript(res, 0)).toEqual({ final: 'laku tiga donat', interim: 'lima belas ribu' })
  })

  // onresult membawa SELURUH daftar sejak sesi mulai. Tanpa kursor, tiap event
  // mengirim ulang kalimat lama dan asisten memproses transaksi berkali-kali.
  it('kursor mencegah kalimat lama terkirim dua kali', () => {
    const res = mk([{ t: 'kalimat pertama', f: true }, { t: 'kalimat kedua', f: true }])
    expect(collectFinalTranscript(res, 1).final).toBe('kalimat kedua')
    expect(collectFinalTranscript(res, 2).final).toBe('')
  })

  it('melewati baris kosong tanpa error', () => {
    const res = [null, undefined, ...mk([{ t: 'halo', f: true }])]
    expect(collectFinalTranscript(res, 0).final).toBe('halo')
  })
})

describe('isMeaningfulUtterance', () => {
  it('menolak dehem & gumaman agar tidak memakan kuota AI', () => {
    for (const s of ['', 'eh', 'hmm', 'ya', 'anu']) expect(isMeaningfulUtterance(s)).toBe(false)
  })

  it('menerima kalimat yang berisi', () => {
    expect(isMeaningfulUtterance('laku 3 donat 15 ribu')).toBe(true)
    expect(isMeaningfulUtterance('berapa laba bulan ini')).toBe(true)
  })
})

describe('normalizeSpeech', () => {
  it('merapikan spasi, tanda baca, dan huruf besar', () => {
    expect(normalizeSpeech('  Ya,   BENAR!  ')).toBe('ya benar')
  })
})
