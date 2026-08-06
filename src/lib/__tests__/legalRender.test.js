// ============================================================
// legalRender.js — sebelumnya 0% coverage.
//
// Modul ini disebut EKSPLISIT di §1.7 S-8 dokumen strategi sebagai tempat yang
// harus diperiksa untuk XSS: keluarannya dipakai lewat `dangerouslySetInnerHTML`,
// jadi React tidak melindungi apa pun. Isinya pun bisa diedit dari panel admin —
// artinya kalau akun admin jebol, satu dokumen legal cukup untuk menanam skrip
// di halaman yang dilihat semua pengguna.
//
// Urutan operasinya yang bikin aman: escape SELURUH teks dulu, baru
// transformasi markdown. Test di bawah mengunci urutan itu.
// ============================================================
import { describe, it, expect } from 'vitest'
import { renderLegalMarkdown } from '../legalRender'

describe('renderLegalMarkdown — keamanan (S-8)', () => {
  it('meng-escape tag HTML mentah, tidak meneruskannya', () => {
    const html = renderLegalMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('meng-escape atribut event yang diselipkan di teks', () => {
    const html = renderLegalMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
  })

  it('meng-escape tanda kutip agar tidak bisa keluar dari atribut href', () => {
    const html = renderLegalMarkdown('[klik](https://a.id" onmouseover="alert(1))')
    expect(html).not.toContain('onmouseover="alert(1)"')
    expect(html).toContain('&quot;')
  })

  it('menolak URL javascript: dan menggantinya dengan #', () => {
    const html = renderLegalMarkdown('[klik](javascript:alert(1))')
    expect(html).toContain('href="#"')
    expect(html).not.toContain('javascript:')
  })

  it('menolak javascript: apa pun besar-kecil hurufnya', () => {
    for (const jahat of ['JavaScript:alert(1)', 'JAVASCRIPT:alert(1)', 'jAvAsCrIpT:x']) {
      expect(renderLegalMarkdown(`[k](${jahat})`)).toContain('href="#"')
    }
  })

  it('menolak URL data: dan vbscript:', () => {
    expect(renderLegalMarkdown('[k](data:text/html,<script>alert(1)</script>)')).toContain('href="#"')
    expect(renderLegalMarkdown('[k](vbscript:msgbox(1))')).toContain('href="#"')
  })

  it('mengizinkan skema yang aman: http, https, mailto, dan path relatif', () => {
    expect(renderLegalMarkdown('[k](https://smartbook.id)')).toContain('href="https://smartbook.id"')
    expect(renderLegalMarkdown('[k](http://smartbook.id)')).toContain('href="http://smartbook.id"')
    expect(renderLegalMarkdown('[k](mailto:halo@smartbook.id)')).toContain('href="mailto:halo@smartbook.id"')
    expect(renderLegalMarkdown('[k](/privasi)')).toContain('href="/privasi"')
  })

  it('memangkas spasi di sekitar URL sebelum memeriksanya', () => {
    // Tanpa trim, "  javascript:..." lolos karena tidak diawali skema terlarang
    // menurut regex yang dipatok di awal string.
    expect(renderLegalMarkdown('[k](   javascript:alert(1)   )')).toContain('href="#"')
    expect(renderLegalMarkdown('[k](  https://a.id  )')).toContain('href="https://a.id"')
  })

  it('memberi rel="noreferrer" dan target="_blank" pada semua tautan', () => {
    const html = renderLegalMarkdown('[k](https://a.id)')
    expect(html).toContain('rel="noreferrer"')
    expect(html).toContain('target="_blank"')
  })
})

describe('renderLegalMarkdown — format', () => {
  it('mengubah "## " menjadi h3 dan "### " menjadi h4', () => {
    expect(renderLegalMarkdown('## Judul')).toBe('<h3>Judul</h3>')
    expect(renderLegalMarkdown('### Subjudul')).toBe('<h4>Subjudul</h4>')
  })

  it('mengubah **teks** menjadi <b>', () => {
    expect(renderLegalMarkdown('ini **tebal** ya')).toBe('<p>ini <b>tebal</b> ya</p>')
  })

  it('membungkus baris "- " menjadi satu <ul> yang benar', () => {
    expect(renderLegalMarkdown('- satu\n- dua')).toBe('<ul><li>satu</li><li>dua</li></ul>')
  })

  it('menutup daftar saat bertemu paragraf biasa', () => {
    expect(renderLegalMarkdown('- satu\nlanjutan')).toBe('<ul><li>satu</li></ul><p>lanjutan</p>')
  })

  it('menutup daftar saat bertemu judul', () => {
    expect(renderLegalMarkdown('- satu\n## Bab')).toBe('<ul><li>satu</li></ul><h3>Bab</h3>')
  })

  it('menutup daftar di akhir dokumen', () => {
    expect(renderLegalMarkdown('- satu')).toBe('<ul><li>satu</li></ul>')
  })

  it('memulai daftar baru setelah dipisah baris kosong', () => {
    expect(renderLegalMarkdown('- a\n\n- b')).toBe('<ul><li>a</li></ul><ul><li>b</li></ul>')
  })

  it('mengabaikan baris kosong dan spasi di tepi', () => {
    expect(renderLegalMarkdown('\n\n   teks   \n\n')).toBe('<p>teks</p>')
  })

  it('menangani akhir baris Windows (CRLF)', () => {
    expect(renderLegalMarkdown('## A\r\n- b')).toBe('<h3>A</h3><ul><li>b</li></ul>')
  })

  it('mengembalikan string kosong untuk masukan kosong, null, atau undefined', () => {
    expect(renderLegalMarkdown('')).toBe('')
    expect(renderLegalMarkdown(null)).toBe('')
    expect(renderLegalMarkdown(undefined)).toBe('')
  })

  it('memformat tebal dan tautan di dalam judul maupun butir daftar', () => {
    expect(renderLegalMarkdown('## Lihat **ini**')).toBe('<h3>Lihat <b>ini</b></h3>')
    expect(renderLegalMarkdown('- baca [aturan](/ketentuan)'))
      .toContain('<li>baca <a href="/ketentuan"')
  })
})
