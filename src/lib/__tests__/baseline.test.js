import { describe, it, expect } from 'vitest'
import { LANGS, translations } from '../i18n'
import { BIAYA_DIKENAL } from '../../components/BaselineAsk'

// Kartu baseline dan kartu pembanding hanya muncul di layar ter-login, jadi
// tidak bisa diuji di peramban tanpa kredensial. Yang bisa dikunci: teksnya ada
// di semua bahasa, dan kalimat pembandingnya terisi utuh tanpa placeholder.

describe('teks baseline', () => {
  for (const lang of LANGS) {
    it(`bahasa ${lang}: semua pertanyaan dan label tombol ada`, () => {
      const b = translations[lang].baseline
      for (const k of ['title', 'sub', 'qMargin', 'qHours', 'qFees', 'save', 'skip', 'note', 'phMargin', 'phHours']) {
        expect(b[k], `baseline.${k} hilang di ${lang}`).toBeTruthy()
      }
    })

    it(`bahasa ${lang}: setiap pilihan biaya punya label`, () => {
      const b = translations[lang].baseline
      for (const k of BIAYA_DIKENAL) {
        expect(b.fees[k], `baseline.fees.${k} hilang di ${lang}`).toBeTruthy()
      }
    })

    it(`bahasa ${lang}: kalimat pembanding menyediakan ketiga tempat isian`, () => {
      const rev = translations[lang].reveal
      expect(rev.blTitle).toBeTruthy()
      for (const p of ['{kira}', '{asli}', '{selisih}']) {
        expect(rev.blBody, `${p} hilang di ${lang}`).toContain(p)
      }
    })
  }

  it('lima jenis biaya sesuai yang diminta spec', () => {
    expect(BIAYA_DIKENAL).toEqual(['admin', 'ongkir', 'iklan', 'gratis_ongkir', 'lainnya'])
  })
})

describe('kalimat pembanding terisi', () => {
  // Meniru perhitungan yang dipakai Reveal.jsx.
  const susun = (lang, kira, asli) => translations[lang].reveal.blBody
    .replace('{kira}', kira)
    .replace('{asli}', asli)
    .replace('{selisih}', Math.round((kira - asli) * 10) / 10)

  it('contoh dari spec: 22% dikira, 14% asli, selisih 8 poin', () => {
    expect(susun('id', 22, 14)).toBe(
      'Kamu memperkirakan margin 22%. Angka sebenarnya 14%. Selisihnya 8 poin persen.',
    )
  })

  it('tidak menyisakan placeholder atau NaN', () => {
    for (const lang of LANGS) {
      const s = susun(lang, 30, 12.5)
      expect(s).not.toMatch(/[{}]/)
      expect(s).not.toContain('NaN')
      expect(s).not.toContain('undefined')
    }
  })

  it('tetap masuk akal saat tebakannya justru lebih rendah dari kenyataan', () => {
    // Bukan kasus mustahil: ada yang meremehkan marginnya sendiri.
    expect(susun('id', 10, 14)).toContain('-4 poin persen')
  })
})
