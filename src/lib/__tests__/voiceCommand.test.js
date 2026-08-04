import { describe, it, expect } from 'vitest'
import {
  MAX_UNCLEAR, VOICE_PHASE, confirmationPrompt, describeCommand, initialVoiceState,
  isAwaitingConfirmation, isExecuting, markExecuted, markFailed, pendingToolResponse,
  resolveConfirmation, splitToolName, stageCommand,
} from '../voiceCommand'

// ============================================================
// Gerbang konfirmasi perintah suara.
//
// Sifat yang dijaga berkas ini: SATU-SATUNYA jalan menuju eksekusi adalah
// persetujuan lisan yang eksplisit. Model Gemini boleh memanggil fungsi apa
// pun — panggilan itu tidak pernah cukup untuk mengubah data.
// ============================================================

const txCall = {
  id: 'fc-1',
  name: 'create_transaksi',
  args: { direction: 'in', amount: 150000, description: 'beras 10 kg' },
}
const deleteCall = { id: 'fc-2', name: 'delete_produk', args: { name: 'SKU-004' } }

describe('stageCommand', () => {
  it('panggilan fungsi dari model TIDAK langsung dieksekusi', () => {
    const s = stageCommand(initialVoiceState(), txCall, 'id')
    expect(s.phase).toBe(VOICE_PHASE.CONFIRMATION_PENDING)
    expect(s.phase).not.toBe(VOICE_PHASE.EXECUTING)
    expect(isAwaitingConfirmation(s)).toBe(true)
    expect(s.pending.name).toBe('create_transaksi')
  })

  it('menyertakan kalimat konfirmasi yang menyebut isinya', () => {
    const s = stageCommand(initialVoiceState(), txCall, 'id')
    expect(s.speak).toContain('Rp 150.000')
    expect(s.speak).toContain('beras 10 kg')
  })

  it('rencana baru MENGGANTIKAN rencana lama, tidak menumpuk', () => {
    // Koreksi pengguna ("bukan sepuluh, lima belas") harus menyisakan tepat
    // satu rencana. Dua rencana berarti satu persetujuan bisa menjalankan dua
    // perintah sekaligus.
    const first = stageCommand(initialVoiceState(), txCall, 'id')
    const corrected = { ...txCall, args: { ...txCall.args, amount: 15000 } }
    const second = stageCommand(first, corrected, 'id')
    expect(second.pending.args.amount).toBe(15000)
    expect(second.unclearCount).toBe(0)
  })

  it('menandai perintah hapus sebagai merusak', () => {
    const s = stageCommand(initialVoiceState(), deleteCall, 'id')
    expect(s.pending.destructive).toBe(true)
    expect(s.speak).toContain('hilang')
  })
})

describe('resolveConfirmation', () => {
  const staged = () => stageCommand(initialVoiceState(), txCall, 'id')

  it('"ya" yang berdiri sendiri menjalankan perintah', () => {
    const r = resolveConfirmation(staged(), 'ya', 'id')
    expect(r.action).toBe('execute')
    expect(r.phase).toBe(VOICE_PHASE.EXECUTING)
  })

  it('"sudah pas, tolong simpan" menjalankan perintah', () => {
    expect(resolveConfirmation(staged(), 'sudah pas tolong simpan', 'id').action).toBe('execute')
  })

  it('"batal" membatalkan dan mengosongkan rencana', () => {
    const r = resolveConfirmation(staged(), 'wait no cancel that', 'id')
    expect(r.action).toBe('cancel')
    expect(r.pending).toBeNull()
  })

  it('jawaban tidak jelas MENGULANG, tidak menyimpan', () => {
    // Ini kegagalan yang paling mahal: menganggap ketidakjelasan sebagai "ya".
    const r = resolveConfirmation(staged(), 'hmm apa ya', 'id')
    expect(r.action).toBe('repeat')
    expect(r.action).not.toBe('execute')
    expect(r.unclearCount).toBe(1)
  })

  it('tak jelas berulang akhirnya membatalkan, bukan menyimpan', () => {
    let s = staged()
    for (let i = 0; i < MAX_UNCLEAR; i++) s = resolveConfirmation(s, 'hmm apa ya', 'id')
    expect(s.action).toBe('cancel')
    expect(s.pending).toBeNull()
  })

  it('kalimat campur "ya salah" dibaca sebagai penolakan', () => {
    expect(resolveConfirmation(staged(), 'ya salah', 'id').action).toBe('cancel')
  })

  it('tidak melakukan apa-apa bila tak ada rencana yang menunggu', () => {
    expect(resolveConfirmation(initialVoiceState(), 'ya', 'id').action).toBe('none')
  })
})

describe('pendingToolResponse', () => {
  it('melapor PERLU_KONFIRMASI, bukan berhasil', () => {
    // Kalau status ini keliru berbunyi "berhasil", model akan mengucapkan
    // "sudah tersimpan" padahal belum ada apa pun yang tersimpan.
    const s = stageCommand(initialVoiceState(), txCall, 'id')
    const res = pendingToolResponse(s.pending, 'id')
    expect(res.response.status).toBe('PERLU_KONFIRMASI')
    expect(res.response.status).not.toBe('BERHASIL')
    expect(res.id).toBe('fc-1')
  })
})

describe('dwibahasa', () => {
  it('ringkasan mengikuti bahasa pengguna', () => {
    expect(describeCommand(txCall, 'id')).toContain('Menambah transaksi')
    expect(describeCommand(txCall, 'en')).toContain('Add transaction')
  })

  it('pertanyaan konfirmasi mengikuti bahasa pengguna', () => {
    expect(confirmationPrompt(txCall, 'en')).toContain('say "yes"')
    expect(confirmationPrompt(txCall, 'id')).toContain('bilang "ya"')
  })

  it('nominal dibacakan sebagai Rupiah, bukan angka telanjang', () => {
    expect(describeCommand(txCall, 'en')).toContain('Rp 150.000')
  })
})

describe('transisi akhir', () => {
  it('markExecuted mengembalikan sesi ke IDLE tanpa rencana tersisa', () => {
    const s = stageCommand(initialVoiceState(), txCall, 'id')
    const done = markExecuted(s)
    expect(done.phase).toBe(VOICE_PHASE.IDLE)
    expect(done.pending).toBeNull()
    expect(isExecuting(done)).toBe(false)
  })

  it('markFailed membuang rencana agar tidak diam-diam dicoba lagi', () => {
    const s = stageCommand(initialVoiceState(), txCall, 'id')
    const failed = markFailed(s, 'Produk tidak ditemukan.', 'id')
    expect(failed.pending).toBeNull()
    expect(failed.error).toContain('Produk tidak ditemukan')
  })
})

describe('splitToolName', () => {
  it('memisahkan operasi dan entitas', () => {
    expect(splitToolName('create_transaksi')).toEqual({ operation: 'create', entity: 'transaksi' })
    expect(splitToolName('create_pengingat')).toEqual({ operation: 'create', entity: 'pengingat' })
  })
})
