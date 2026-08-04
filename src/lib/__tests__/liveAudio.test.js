import { describe, it, expect } from 'vitest'
import {
  FRAME_SAMPLES, INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE,
  base64ToPcm16, downsampleTo, floatToPcm16, pcm16ToBase64, pcm16ToFloat, shouldSendFrame,
} from '../liveAudio'

// ============================================================
// Lapisan audio sesi suara.
//
// Yang diuji di sini bukan "apakah suaranya bagus", melainkan dua sifat yang
// kalau rusak akan mengembalikan bug lingkaran umpan balik:
//   1. Sampel yang dikirim benar-benar PCM16 16 kHz seperti kontrak Live API.
//   2. Mikrofon TIDAK PERNAH mengirim saat AI sedang bicara.
// ============================================================

describe('konversi sampel', () => {
  it('menjepit nilai di luar [-1,1] alih-alih membiarkannya meluap', () => {
    // Sampel yang meluap berubah tanda dan terdengar sebagai letupan keras.
    const out = floatToPcm16(new Float32Array([2, -2]))
    expect(out[0]).toBe(32767)
    expect(out[1]).toBe(-32768)
  })

  it('bolak-balik float <-> pcm16 mempertahankan bentuk gelombang', () => {
    const src = new Float32Array([0, 0.5, -0.5, 0.999])
    const back = pcm16ToFloat(floatToPcm16(src))
    for (let i = 0; i < src.length; i++) {
      expect(Math.abs(back[i] - src[i])).toBeLessThan(0.001)
    }
  })

  it('base64 bolak-balik tidak mengubah satu sampel pun', () => {
    const src = new Int16Array([0, 1, -1, 32767, -32768, 1234])
    const back = base64ToPcm16(pcm16ToBase64(src))
    expect(Array.from(back)).toEqual(Array.from(src))
  })

  it('potongan base64 dengan byte ganjil dibuang sisanya, bukan melempar', () => {
    // Potongan yang terpotong di tengah sampel pernah membuat Int16Array
    // melempar dan mematikan seluruh sesi.
    const odd = btoa('abc')
    expect(() => base64ToPcm16(odd)).not.toThrow()
    expect(base64ToPcm16(odd).length).toBe(1)
  })
})

describe('downsampleTo', () => {
  it('menurunkan 48 kHz ke 16 kHz dengan panjang sepertiga', () => {
    const input = new Float32Array(48000).fill(0.5)
    const out = downsampleTo(input, 48000, INPUT_SAMPLE_RATE)
    expect(out.length).toBe(16000)
  })

  it('merata-ratakan, bukan mengambil tiap sampel ke-N', () => {
    // Decimation murni akan mengembalikan [1, 1]; rerata mengembalikan 0.
    // Ini yang membuat frekuensi tinggi tidak berubah jadi desis.
    const input = new Float32Array([1, -1, 1, -1, 1, -1])
    const out = downsampleTo(input, 6, 3)
    expect(out.length).toBe(3)
    out.forEach((v) => expect(Math.abs(v)).toBeLessThan(0.001))
  })

  it('meneruskan apa adanya bila sample rate sudah sama', () => {
    const input = new Float32Array([0.1, 0.2])
    expect(Array.from(downsampleTo(input, 16000, 16000))).toEqual([
      expect.closeTo(0.1, 5), expect.closeTo(0.2, 5),
    ])
  })

  it('tidak mengarang sampel saat perangkat di bawah 16 kHz', () => {
    const input = new Float32Array([0.1, 0.2, 0.3])
    expect(downsampleTo(input, 8000, 16000).length).toBe(3)
  })
})

describe('shouldSendFrame — gerbang anti-gema', () => {
  // INI test terpenting di berkas ini. Bug lama persis berarti fungsi ini
  // mengembalikan true saat aiSpeaking bernilai true.
  it('MENUTUP mikrofon selama AI bicara', () => {
    expect(shouldSendFrame({ capturing: true, aiSpeaking: true, muted: false })).toBe(false)
  })

  it('membuka mikrofon hanya saat sesi jalan dan AI diam', () => {
    expect(shouldSendFrame({ capturing: true, aiSpeaking: false, muted: false })).toBe(true)
  })

  it('tetap tertutup saat sesi belum aktif', () => {
    expect(shouldSendFrame({ capturing: false, aiSpeaking: false, muted: false })).toBe(false)
  })

  it('bisu manual menang atas keadaan lain', () => {
    expect(shouldSendFrame({ capturing: true, aiSpeaking: false, muted: true })).toBe(false)
  })
})

describe('kontrak sample rate Live API', () => {
  it('memakai 16 kHz masuk dan 24 kHz keluar', () => {
    // Angka ini bagian dari kontrak API. Kalau berubah tanpa mengubah mimeType
    // yang dikirim, suara akan terdengar cepat/lambat dan transkrip berantakan.
    expect(INPUT_SAMPLE_RATE).toBe(16000)
    expect(OUTPUT_SAMPLE_RATE).toBe(24000)
  })

  it('potongan kirim berukuran bulat dan tidak mikroskopis', () => {
    expect(Number.isInteger(FRAME_SAMPLES)).toBe(true)
    expect(FRAME_SAMPLES).toBeGreaterThan(1000)
  })
})
