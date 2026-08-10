import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Penjaga regresi untuk aturan "nol dialog bawaan browser".
//
// Dialog bawaan (window.alert / confirm / prompt) memblokir thread UI, tampil
// di luar design system, tidak bisa diterjemahkan, dan di beberapa browser
// mobile bisa dibungkam pengguna — pesan penting hilang tanpa jejak. Semua
// konfirmasi/notifikasi wajib lewat useAlert() (src/context/AlertContext.jsx).
//
// Test ini membaca berkas sumber apa adanya, jadi ia tetap menangkap
// pelanggaran di komponen yang belum punya test unit sendiri.

const SRC = path.resolve(__dirname, '../..')

// `confirm(` yang tidak didahului titik atau huruf → panggilan global, bukan
// showConfirm()/setConfirm()/obj.confirm().
const TERLARANG = [
  { nama: 'window.alert', re: /\bwindow\s*\.\s*alert\s*\(/ },
  { nama: 'window.confirm', re: /\bwindow\s*\.\s*confirm\s*\(/ },
  { nama: 'window.prompt', re: /\bwindow\s*\.\s*prompt\s*\(/ },
  { nama: 'alert()', re: /(^|[^.\w$])alert\s*\(/ },
  { nama: 'confirm()', re: /(^|[^.\w$])confirm\s*\(/ },
  { nama: 'prompt()', re: /(^|[^.\w$])prompt\s*\(/ },
]

function kumpulkanBerkas(dir, hasil = []) {
  for (const entri of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entri.name)
    if (entri.isDirectory()) {
      // Berkas test memang memuat string payload XSS berisi kata "alert(1)".
      if (entri.name === '__tests__' || entri.name === 'test') continue
      kumpulkanBerkas(p, hasil)
    } else if (/\.(jsx?|tsx?)$/.test(entri.name)) {
      hasil.push(p)
    }
  }
  return hasil
}

describe('tidak ada dialog bawaan browser di src/', () => {
  it('tidak memakai alert/confirm/prompt global', () => {
    const pelanggaran = []
    for (const berkas of kumpulkanBerkas(SRC)) {
      const baris = fs.readFileSync(berkas, 'utf8').split('\n')
      baris.forEach((isi, i) => {
        // Lewati komentar & string dokumentasi yang menyebut nama fungsi.
        const bersih = isi.trim()
        if (bersih.startsWith('//') || bersih.startsWith('*') || bersih.startsWith('/*')) return
        for (const { nama, re } of TERLARANG) {
          if (re.test(isi)) {
            pelanggaran.push(`${path.relative(SRC, berkas)}:${i + 1} → ${nama}`)
            break
          }
        }
      })
    }
    expect(pelanggaran).toEqual([])
  })
})
