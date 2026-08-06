import { describe, it, expect } from 'vitest'
import {
  MAX_UNCLEAR, VOICE_STATE, advanceFromServer, confirmationPrompt, describeDrafts,
  handleConfirmationReply, initialFlow, isAwaitingConfirmation, isBusy, toTransactionRows,
} from '../voiceFlow'

// ============================================================
// Voice Double-Check Confirmation.
// Sifat yang dijaga: perintah suara TIDAK PERNAH menyimpan tanpa persetujuan
// lisan yang eksplisit.
// ============================================================

const drafts = [{ direction: 'in', amount: 15000, description: '3 donat', category: 'Penjualan' }]
const okRes = { transactions: drafts, note: '' }

describe('advanceFromServer', () => {
  // Gerbang yang menghalangi penyimpanan otomatis: draft lengkap TIDAK
  // langsung tersimpan, melainkan menunggu jawaban lisan.
  it('draft masuk mode konfirmasi, BUKAN langsung simpan', () => {
    const f = advanceFromServer(initialFlow(), okRes, 'id')
    expect(f.state).toBe(VOICE_STATE.CONFIRMING)
    expect(f.state).not.toBe(VOICE_STATE.SAVING)
    expect(isAwaitingConfirmation(f)).toBe(true)
    expect(f.speak).toContain('Apakah sudah benar?')
  })

  it('membuang transaksi tanpa nominal yang sah', () => {
    const res = { transactions: [...drafts, { direction: 'in', amount: 0, description: 'x' }] }
    expect(advanceFromServer(initialFlow(), res, 'id').drafts).toHaveLength(1)
  })

  it('tanpa transaksi terbaca, kembali ke keadaan awal dengan penjelasan', () => {
    const f = advanceFromServer(initialFlow(), { transactions: [], note: 'Nominal belum disebut.' }, 'id')
    expect(f.state).toBe(VOICE_STATE.IDLE)
    expect(f.speak).toBe('Nominal belum disebut.')
  })

  it('error dari server mengembalikan flow ke keadaan awal', () => {
    const f = advanceFromServer(initialFlow(), { error: 'Kuota harian habis.' }, 'id')
    expect(f.state).toBe(VOICE_STATE.IDLE)
    expect(f.speak).toBe('Kuota harian habis.')
  })

  // Bahasa jawaban mengikuti pilihan ID/EN pengguna di header aplikasi.
  it('berbicara dalam bahasa Inggris saat lang = en', () => {
    const f = advanceFromServer(initialFlow(), okRes, 'en')
    expect(f.speak).toContain('Is that correct?')
    expect(f.speak).toContain('income')
    expect(f.speak).not.toContain('Apakah')
  })
})

describe('handleConfirmationReply', () => {
  const confirming = advanceFromServer(initialFlow(), okRes, 'id')

  it('"ya" menyimpan', () => {
    const f = handleConfirmationReply(confirming, 'ya benar', 'id')
    expect(f.action).toBe('save')
    expect(f.state).toBe(VOICE_STATE.SAVING)
  })

  it('"tidak" membatalkan dan mengosongkan draft', () => {
    const f = handleConfirmationReply(confirming, 'tidak, salah', 'id')
    expect(f.action).toBe('cancel')
    expect(f.drafts).toBeNull()
    expect(f.state).toBe(VOICE_STATE.IDLE)
  })

  it('bahasa Inggris: yes / no ikut dikenali', () => {
    expect(handleConfirmationReply(confirming, 'yes correct', 'en').action).toBe('save')
    expect(handleConfirmationReply(confirming, 'no, cancel', 'en').action).toBe('cancel')
  })

  // Inti keamanan fitur: apa pun yang tidak jelas TIDAK boleh menyimpan.
  it('jawaban tak jelas TIDAK PERNAH menyimpan', () => {
    for (const s of ['hmm', 'apa ya', 'nasi goreng', '', 'terus', 'what']) {
      const f = handleConfirmationReply(confirming, s, 'id')
      expect(f.action).not.toBe('save')
      expect(f.state).not.toBe(VOICE_STATE.SAVING)
    }
  })

  it('jawaban tak jelas mengulang pertanyaan', () => {
    const f = handleConfirmationReply(confirming, 'hmm', 'id')
    expect(f.action).toBe('repeat')
    expect(f.unclearCount).toBe(1)
    expect(f.speak).toContain('Apakah sudah benar?')
  })

  // Tanpa batas, pengguna di tempat berisik terjebak tanpa jalan keluar.
  it('membatalkan setelah terlalu banyak jawaban tak jelas', () => {
    const f = handleConfirmationReply({ ...confirming, unclearCount: MAX_UNCLEAR - 1 }, 'hmm', 'id')
    expect(f.action).toBe('cancel')
    expect(f.state).toBe(VOICE_STATE.IDLE)
    expect(f.drafts).toBeNull()
  })

  it('kalimat campur "ya tapi salah" membatalkan, bukan menyimpan', () => {
    expect(handleConfirmationReply(confirming, 'ya tapi salah', 'id').action).toBe('cancel')
  })
})

describe('describeDrafts', () => {
  it('menyebut arah, nominal, dan keterangan', () => {
    expect(describeDrafts(drafts, 'id')).toBe('pemasukan Rp 15.000 untuk 3 donat')
    expect(describeDrafts(drafts, 'en')).toBe('income Rp 15.000 for 3 donat')
  })

  it('menggabungkan beberapa transaksi', () => {
    const two = [...drafts, { direction: 'out', amount: 5000, description: 'plastik' }]
    expect(describeDrafts(two, 'id')).toContain(', dan ')
    expect(describeDrafts(two, 'en')).toContain(', and ')
  })
})

describe('toTransactionRows', () => {
  it('memberi nilai bawaan yang aman untuk kolom wajib', () => {
    const [row] = toTransactionRows([{ direction: 'in', amount: 15000.4, description: '', category: 'Penjualan' }])
    expect(row.amount).toBe(15000)
    expect(row.description).toBe('Penjualan')
    expect(row.channel).toBe('asisten')
    expect(row.payment_status).toBe('lunas')
  })

  // Tanggal dibangun dari komponen LOKAL; kalau dibuat lewat Date.parse('YYYY-MM-DD')
  // hasilnya UTC dan transaksi bisa tercatat mundur sehari untuk pengguna WIB.
  it('mempertahankan tanggal lokal tanpa bergeser sehari', () => {
    const [row] = toTransactionRows([{ direction: 'in', amount: 1000, occurred_at: '2026-03-15', category: 'x' }])
    const d = new Date(row.occurred_at)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(15)
  })

  it('menandai piutang hanya untuk pemasukan yang belum dibayar', () => {
    const rows = toTransactionRows([
      { direction: 'in', amount: 1, payment_status: 'belum', category: 'x' },
      { direction: 'out', amount: 1, payment_status: 'belum', category: 'x' },
    ])
    expect(rows[0].payment_status).toBe('belum')
    expect(rows[1].payment_status).toBe('lunas')
  })

  it('membuang baris tanpa nominal', () => {
    expect(toTransactionRows([{ direction: 'in', amount: 0 }])).toHaveLength(0)
  })
})

describe('penjaga keadaan', () => {
  it('ucapan diabaikan saat menyimpan (cegah simpan ganda)', () => {
    expect(isBusy({ ...initialFlow(), state: VOICE_STATE.SAVING })).toBe(true)
    expect(isBusy(initialFlow())).toBe(false)
  })
})

describe('confirmationPrompt', () => {
  it('menyebutkan cara menjawab supaya pengguna tidak menebak', () => {
    expect(confirmationPrompt('x', 'id')).toContain('ya')
    expect(confirmationPrompt('x', 'id')).toContain('tidak')
    expect(confirmationPrompt('x', 'en')).toContain('yes')
    expect(confirmationPrompt('x', 'en')).toContain('no')
  })
})
