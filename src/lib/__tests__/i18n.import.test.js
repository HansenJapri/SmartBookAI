import { describe, it, expect } from 'vitest'
import { LANGS, translations } from '../i18n'

// Layar Impor tidak bisa dibuka tanpa sesi login, jadi kunci i18n yang salah
// ketik baru ketahuan saat pengguna sungguhan mengimpor berkas — tepat di saat
// mereka sedang menyelamatkan data yang tanggalnya bermasalah. Tes ini menutup
// celah itu: setiap kunci yang dipakai bagian pemulihan tanggal (task B6) harus
// ada dan terisi di SEMUA bahasa.

const KUNCI_TEKS = [
  'dateFixTitle', 'dateFixSub', 'dateUseTodayAll', 'dateSkipAll', 'dateSkipOne',
  'thDateRaw', 'thWhy', 'thFix', 'dateEmpty', 'dateBlock',
  'dateBadge', 'dateBadgeTitle',
  // Dipakai tabel pemulihan yang memakai ulang header tabel utama.
  'thDesc', 'thAmount',
]

const ALASAN = ['kosong', 'mustahil', 'tidak dikenali', 'unknown']

describe('kunci i18n layar Impor', () => {
  for (const lang of LANGS) {
    describe(`bahasa ${lang}`, () => {
      const imp = translations[lang].importPage

      it('semua kunci teks ada dan tidak kosong', () => {
        for (const k of KUNCI_TEKS) {
          expect(imp[k], `importPage.${k} hilang di ${lang}`).toBeTruthy()
          expect(typeof imp[k]).toBe('string')
        }
      })

      it('setiap alasan penandaan punya penjelasan', () => {
        for (const a of ALASAN) {
          expect(imp.dateReason[a], `dateReason.${a} hilang di ${lang}`).toBeTruthy()
        }
      })

      it('teks berjumlah menyediakan tempat untuk {n}', () => {
        expect(imp.dateFixTitle).toContain('{n}')
        expect(imp.dateBlock).toContain('{n}')
      })
    })
  }

  it('teks lama yang sudah tidak dipakai sudah dibersihkan', () => {
    for (const lang of LANGS) {
      expect(translations[lang].importPage.dateWarnA).toBeUndefined()
      expect(translations[lang].importPage.dateWarnB).toBeUndefined()
    }
  })
})
