import { describe, it, expect } from 'vitest'
import { translations, LANGS } from '../i18n'

// ============================================================
// Kelengkapan terjemahan asisten suara.
//
// Komponen membaca t.voice.<kunci> langsung. Kunci yang hilang di salah satu
// bahasa TIDAK menimbulkan error — React merender `undefined` sebagai kosong,
// jadi tombolnya sekadar tampil tanpa tulisan. Test ini menangkapnya di CI,
// bukan di layar pengguna.
// ============================================================

const VOICE_KEYS = [
  'enable', 'disable',
  'stInactive', 'stListening', 'stReconnecting', 'stProcessing', 'stAwaiting',
  'introTitle', 'introPersist', 'introConfirm', 'introExample',
  'confirmTitle', 'confirmHint', 'save', 'cancel',
  'persistNote', 'savedCount', 'saveFailed', 'failed', 'tab', 'subtitle',
]

describe('i18n asisten suara', () => {
  it.each(LANGS)('bahasa "%s" punya seluruh kunci voice yang terisi', (lang) => {
    const v = translations[lang]?.voice
    expect(v, `blok voice hilang di bahasa ${lang}`).toBeTruthy()
    for (const k of VOICE_KEYS) {
      expect(typeof v[k], `${lang}.voice.${k} bukan string`).toBe('string')
      expect(v[k].trim().length, `${lang}.voice.${k} kosong`).toBeGreaterThan(0)
    }
  })

  // Menyalin blok Indonesia ke slot Inggris akan lolos pemeriksaan "ada isinya"
  // di atas, padahal pengguna EN tetap melihat bahasa Indonesia.
  it('teks Inggris benar-benar berbeda dari Indonesia', () => {
    for (const k of ['enable', 'disable', 'stListening', 'confirmHint', 'save', 'cancel']) {
      expect(translations.en.voice[k], `voice.${k} belum diterjemahkan`).not.toBe(translations.id.voice[k])
    }
  })

  it('savedCount menyediakan placeholder jumlah', () => {
    for (const lang of LANGS) expect(translations[lang].voice.savedCount).toContain('{n}')
  })
})

// Kolom Nama Pengguna (Tahap 2) ikut dijaga di sini karena alasan yang sama.
describe('i18n Pengguna & Akses', () => {
  it('memakai kolom Nama Pengguna, bukan Email', () => {
    for (const lang of LANGS) {
      expect(translations[lang].team.thName).toBeTruthy()
      expect(translations[lang].team.thEmail).toBeUndefined()
    }
  })
})
