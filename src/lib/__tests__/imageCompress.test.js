// ============================================================
// imageCompress.js — sebelumnya 0% coverage.
//
// Fungsi ini berdiri di depan jalur OCR struk (biaya token vision). Aturan yang
// dikunci: ia TIDAK BOLEH menggagalkan unggahan. Apa pun yang salah — format
// tidak didukung browser (HEIC dari iPhone), canvas gagal, hasil kompresi malah
// lebih besar — jawabannya selalu "kembalikan berkas asli", bukan melempar.
//
// createImageBitmap & canvas.toBlob tidak ada di jsdom, jadi dipalsukan.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImage } from '../imageCompress'

const berkas = (nama, ukuran, tipe = 'image/jpeg') => {
  const f = new File(['x'], nama, { type: tipe })
  Object.defineProperty(f, 'size', { value: ukuran })
  return f
}

/** Palsukan createImageBitmap + canvas.toBlob agar jalur kompresi bisa jalan. */
function pasangKanvas({ lebar = 3000, tinggi = 2000, ukuranHasil = 100 * 1024 } = {}) {
  const close = vi.fn()
  globalThis.createImageBitmap = vi.fn(async () => ({ width: lebar, height: tinggi, close }))

  const dipakai = {}
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
    return {
      set width(v) { dipakai.w = v }, get width() { return dipakai.w },
      set height(v) { dipakai.h = v }, get height() { return dipakai.h },
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb) => cb(new Blob([new Uint8Array(ukuranHasil)], { type: 'image/jpeg' })),
    }
  })
  return { dipakai, close }
}

beforeEach(() => { delete globalThis.createImageBitmap })
afterEach(() => vi.restoreAllMocks())

describe('berkas yang dilewati tanpa diproses', () => {
  it('mengembalikan apa adanya bila bukan gambar', async () => {
    const f = berkas('data.pdf', 5_000_000, 'application/pdf')
    expect(await compressImage(f)).toBe(f)
  })

  it('mengembalikan apa adanya bila file null/undefined', async () => {
    expect(await compressImage(null)).toBe(null)
    expect(await compressImage(undefined)).toBe(undefined)
  })

  it('mengembalikan apa adanya bila berkas sudah di bawah 300 KB', async () => {
    const f = berkas('kecil.jpg', 200 * 1024)
    expect(await compressImage(f)).toBe(f)
  })

  it('memproses berkas tepat di atas ambang 300 KB', async () => {
    pasangKanvas()
    const f = berkas('besar.jpg', 301 * 1024)
    expect(await compressImage(f)).not.toBe(f)
  })
})

describe('kompresi berhasil', () => {
  it('menghasilkan File JPEG baru berekstensi .jpg', async () => {
    pasangKanvas()
    const hasil = await compressImage(berkas('struk-warung.png', 2_000_000, 'image/png'))
    expect(hasil).toBeInstanceOf(File)
    expect(hasil.name).toBe('struk-warung.jpg')
    expect(hasil.type).toBe('image/jpeg')
  })

  it('menskalakan sisi terpanjang ke maxDim dengan rasio terjaga', async () => {
    const { dipakai } = pasangKanvas({ lebar: 3000, tinggi: 2000 })
    await compressImage(berkas('a.jpg', 2_000_000), 1280)
    expect(dipakai.w).toBe(1280)
    expect(dipakai.h).toBe(853) // 2000 * (1280/3000)
  })

  it('menskalakan berdasarkan tinggi bila foto berorientasi potret', async () => {
    const { dipakai } = pasangKanvas({ lebar: 2000, tinggi: 3000 })
    await compressImage(berkas('a.jpg', 2_000_000), 1280)
    expect(dipakai.h).toBe(1280)
    expect(dipakai.w).toBe(853)
  })

  it('tidak memperbesar gambar yang sudah lebih kecil dari maxDim', async () => {
    const { dipakai } = pasangKanvas({ lebar: 800, tinggi: 600 })
    await compressImage(berkas('a.jpg', 400 * 1024), 1280)
    expect(dipakai.w).toBe(800)
    expect(dipakai.h).toBe(600)
  })

  it('membebaskan bitmap setelah dipakai agar memori tidak menumpuk', async () => {
    const { close } = pasangKanvas()
    await compressImage(berkas('a.jpg', 2_000_000))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('memberi nama bawaan bila berkas tidak punya nama', async () => {
    pasangKanvas()
    const f = berkas('', 2_000_000)
    expect((await compressImage(f)).name).toBe('struk.jpg')
  })
})

describe('gagal dengan aman — unggahan tidak boleh batal', () => {
  it('mengembalikan berkas asli bila format tidak didukung (mis. HEIC)', async () => {
    globalThis.createImageBitmap = vi.fn(async () => { throw new Error('format tidak didukung') })
    const f = berkas('foto.heic', 3_000_000, 'image/heic')
    expect(await compressImage(f)).toBe(f)
  })

  it('mengembalikan berkas asli bila hasil kompresi justru lebih besar', async () => {
    pasangKanvas({ ukuranHasil: 5_000_000 })
    const f = berkas('a.jpg', 1_000_000)
    expect(await compressImage(f)).toBe(f)
  })

  it('mengembalikan berkas asli bila toBlob menghasilkan null', async () => {
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 3000, height: 2000 }))
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb) => cb(null),
    })
    const f = berkas('a.jpg', 1_000_000)
    expect(await compressImage(f)).toBe(f)
  })
})
