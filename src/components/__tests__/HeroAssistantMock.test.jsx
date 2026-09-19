import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { LangProvider } from '../../context/LangContext'
import { translations } from '../../lib/i18n'
import HeroAssistantMock from '../HeroAssistantMock'

// Mockup asisten di hero adalah animasi berjalan, bukan gambar diam. Yang
// dikunci di sini adalah URUTAN fase-nya: kalimat diketik dulu, baru terkirim,
// baru AI "membaca", baru field muncul satu per satu, terakhir tombol Simpan.
// Kalau urutannya rusak, pengunjung melihat hasil sebelum ada yang diketik —
// dan itu tidak menjelaskan apa pun tentang cara kerja fitur Catat.

const HERO = translations.id.landing2.hero
const KETIK_PER_HURUF = 45
const MULAI_KIRIM = HERO.msgUser.length * KETIK_PER_HURUF + 700
const MULAI_KARTU = MULAI_KIRIM + 1100
const MULAI_TOMBOL = MULAI_KARTU + HERO.fields.length * 170 + 320
const PUTARAN = MULAI_TOMBOL + 3600

let jam = 0
let picuObserver = null

const pasang = () => render(<LangProvider><HeroAssistantMock /></LangProvider>)

// Maju sekian milidetik waktu semu, lalu biarkan interval 60ms komponen
// menjalankan efeknya. performance.now dipalsukan bersama timer supaya jam
// putaran dan timer tidak berjalan di dua kecepatan berbeda.
const majuKe = async (ms) => {
  await act(async () => { jam = ms; vi.advanceTimersByTime(80) })
}

const kelas = (sel) => document.querySelector(sel).className
const nyala = (sel) => kelas(sel).includes('is-on')
const jumlahFieldNyala = () =>
  [...document.querySelectorAll('.lp-mock-field')].filter((e) => e.className.includes('is-on')).length

beforeEach(() => {
  jam = 0
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => jam)
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} })
  // jsdom belum punya IntersectionObserver. Stub ini menyimpan callback-nya
  // supaya test bisa menyatakan "panel terlihat" secara eksplisit.
  globalThis.IntersectionObserver = class {
    constructor(cb) { picuObserver = cb }
    observe() { picuObserver([{ isIntersecting: true }]) }
    disconnect() {}
    unobserve() {}
  }
})

afterEach(() => {
  vi.useRealTimers()
  picuObserver = null
})

describe('<HeroAssistantMock> urutan animasi', () => {
  it('mengetik kalimat dulu sebelum mengirimnya', async () => {
    pasang()
    await majuKe(6 * KETIK_PER_HURUF)

    const kotak = document.querySelector('.lp-mock-textbox')
    expect(kotak.className).toContain('is-typing')
    expect(kotak.textContent).toBe(HERO.msgUser.slice(0, 6))
    expect(kotak.textContent).not.toBe(HERO.msgUser)
    expect(nyala('.lp-typing')).toBe(false)
  })

  it('menampilkan titik "sedang membaca" setelah kalimat terkirim, sebelum kartu muncul', async () => {
    pasang()
    await majuKe(MULAI_KIRIM + 200)

    expect(nyala('.lp-msg-me')).toBe(true)
    expect(nyala('.lp-typing')).toBe(true)
    expect(nyala('.lp-mock-draft')).toBe(false)
    // Kotak input kembali ke placeholder begitu kalimatnya "terkirim".
    expect(document.querySelector('.lp-mock-textbox').textContent).toBe(HERO.inputPh)
  })

  it('memunculkan field satu per satu, bukan sekaligus', async () => {
    pasang()
    await majuKe(MULAI_KARTU + 10)
    expect(nyala('.lp-mock-draft')).toBe(true)
    expect(jumlahFieldNyala()).toBe(1)

    await majuKe(MULAI_KARTU + 2 * 170 + 10)
    expect(jumlahFieldNyala()).toBe(3)

    // Peringatan & tombol Simpan menunggu sampai seluruh field terisi.
    expect(nyala('.lp-mock-tail')).toBe(false)
  })

  it('menampilkan peringatan dan tombol Simpan di akhir urutan', async () => {
    pasang()
    await majuKe(MULAI_TOMBOL + 50)

    expect(jumlahFieldNyala()).toBe(HERO.fields.length)
    expect(nyala('.lp-mock-tail')).toBe(true)
    expect(document.querySelector('.lp-mock-save').textContent).toContain(HERO.cardSave)
    expect(document.querySelector('.lp-mock-warn').textContent).toContain(HERO.cardWarn)
  })

  it('memulai dari panel KOSONG — tidak ada kartu sebelum ada yang dikirim', async () => {
    pasang()
    await majuKe(5 * KETIK_PER_HURUF)

    expect(document.querySelector('.lp-mock-textbox').className).toContain('is-typing')
    expect(nyala('.lp-msg-me')).toBe(false)
    expect(nyala('.lp-mock-draft')).toBe(false)
    expect(jumlahFieldNyala()).toBe(0)
    expect(nyala('.lp-mock-tail')).toBe(false)
  })

  it('baru membiarkan hasil sebelumnya terbaca mulai putaran KEDUA', async () => {
    pasang()
    await majuKe(MULAI_TOMBOL + 50)
    await majuKe(PUTARAN + 10)      // putaran pertama selesai, jam kembali ke nol
    const awalPutaranBaru = jam
    await majuKe(awalPutaranBaru + 300) // baru beberapa huruf kalimat berikutnya

    expect(document.querySelector('.lp-mock-textbox').className).toContain('is-typing')
    // Di putaran kedua dan seterusnya panel TIDAK boleh kosong — itulah yang
    // dulu membuatnya terlihat seperti rusak selama beberapa detik tiap putaran.
    expect(nyala('.lp-mock-draft')).toBe(true)
    expect(jumlahFieldNyala()).toBe(HERO.fields.length)
  })

  it('berhenti berdetak saat halaman disembunyikan, dan jalan lagi saat dibuka', async () => {
    pasang()
    const sembunyi = (v) => {
      Object.defineProperty(document, 'hidden', { value: v, configurable: true })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    }

    // Fase "sedang membaca" dipakai sebagai penanda: di kondisi awal komponen
    // titik-titiknya padam, jadi nyala/padamnya langsung membedakan jam yang
    // berjalan dari jam yang berhenti.
    sembunyi(true)
    await majuKe(MULAI_KIRIM + 200)
    expect(nyala('.lp-typing')).toBe(false) // jam maju, tampilan membeku

    // Saat dibuka lagi, putaran dimulai ulang dari nol — jadi patokan waktunya
    // dihitung dari saat halaman kembali terlihat, bukan dari jam semu global.
    const kembali = jam
    sembunyi(false)
    await majuKe(kembali + MULAI_KIRIM + 200)
    expect(nyala('.lp-typing')).toBe(true)  // berjalan lagi tanpa perlu digulir

    sembunyi(false) // kembalikan ke kondisi normal untuk test berikutnya
  })

  it('langsung menampilkan hasil akhir saat pengguna meminta kurangi gerak', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} })
    pasang()
    await majuKe(100)

    expect(nyala('.lp-mock-draft')).toBe(true)
    expect(jumlahFieldNyala()).toBe(HERO.fields.length)
    expect(nyala('.lp-mock-tail')).toBe(true)
  })
})
