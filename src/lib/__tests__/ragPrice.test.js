import { describe, it, expect } from 'vitest'
import {
  isTrusted,
  domainOf,
  finalUrl,
  numberAppearsIn,
  parseRupiahMentions,
  pickCommodityPrice,
  selectRagPrices,
  TRUSTED_DOMAINS,
} from '../ragPrice'

// ============================================================
// Unit tests: pilar Source Grounding & Freshness RAG Radar Harga.
// Setiap test mengunci satu aturan grounding nyata di edge makro-harian.
// ============================================================

describe('domainOf & isTrusted (allowlist domain — pilar #1 grounding)', () => {
  it('mengambil hostname bersih tanpa www.', () => {
    expect(domainOf('https://www.kontan.co.id/berita/xyz')).toBe('kontan.co.id')
    expect(domainOf('https://sub.bisnis.com/a')).toBe('sub.bisnis.com')
    expect(domainOf('bukan-url')).toBe('')
  })
  it('menerima domain dalam daftar', () => {
    expect(isTrusted('kontan.co.id')).toBe(true)
    expect(isTrusted('bi.go.id')).toBe(true)
    expect(isTrusted('reuters.com')).toBe(true)
  })
  it('menerima subdomain dari domain sah', () => {
    expect(isTrusted('finansial.bisnis.com')).toBe(true)
    expect(isTrusted('www.cnbcindonesia.com')).toBe(true)
  })
  it('menolak domain di luar daftar (anti-hallucinated source)', () => {
    expect(isTrusted('blogspam.xyz')).toBe(false)
    expect(isTrusted('kontan.co.id.attacker.com')).toBe(false) // wajib exact/subdomain, bukan substring
    expect(isTrusted('')).toBe(false)
  })
  it('daftar TRUSTED_DOMAINS dipangkas: unik, ringkas, & non-kosong', () => {
    const uniq = new Set(TRUSTED_DOMAINS)
    expect(uniq.size).toBe(TRUSTED_DOMAINS.length)
    // Sengaja dipangkas agresif ke inti paling berdampak.
    expect(TRUSTED_DOMAINS.length).toBeGreaterThanOrEqual(8)
    expect(TRUSTED_DOMAINS.length).toBeLessThanOrEqual(12)
  })
})

describe('finalUrl (Bing redirect resolution)', () => {
  it('mengembalikan URL asli dari redirect Bing', () => {
    const bing = 'https://www.bing.com/news/apiclick.aspx?ref=x&url=' +
      encodeURIComponent('https://kontan.co.id/berita/harga-beras')
    expect(finalUrl(bing)).toBe('https://kontan.co.id/berita/harga-beras')
  })
  it('membuang redirect Bing tanpa parameter url= (tidak dapat diverifikasi)', () => {
    expect(finalUrl('https://www.bing.com/news/apiclick.aspx?ref=x')).toBe('')
  })
  it('meneruskan URL langsung apa adanya', () => {
    expect(finalUrl('https://kontan.co.id/x')).toBe('https://kontan.co.id/x')
  })
  it('URL invalid -> string kosong (bukan throw)', () => {
    expect(finalUrl('bukan-url')).toBe('')
    expect(finalUrl('')).toBe('')
  })
})

describe('numberAppearsIn (grounding angka — pilar #3 anti-halusinasi angka)', () => {
  it('mengenali format ribuan Indonesia (18.500)', () => {
    expect(numberAppearsIn('harga beras 18.500 per kg', 18500)).toBe(true)
  })
  it('mengenali format en (18,500)', () => {
    expect(numberAppearsIn('harga beras 18,500 per kg', 18500)).toBe(true)
  })
  it('mengenali kata "ribu" & "rb"', () => {
    expect(numberAppearsIn('gula 15 ribu', 15000)).toBe(true)
    expect(numberAppearsIn('gula 15rb', 15000)).toBe(true)
  })
  it('mengenali "juta" & "jt"', () => {
    expect(numberAppearsIn('daging sapi 1,2 juta per kuintal', 1200000)).toBe(true)
    expect(numberAppearsIn('daging 2jt', 2000000)).toBe(true)
  })
  it('menolak bila angka tak tertulis (grounding gagal)', () => {
    expect(numberAppearsIn('harga beras naik tajam pekan ini', 14500)).toBe(false)
    expect(numberAppearsIn('', 14500)).toBe(false)
  })
})

describe('parseRupiahMentions (ekstraksi kandidat harga)', () => {
  it('menemukan sebutan "Rp" dengan berbagai variasi', () => {
    const t = 'Beras Rp14.500 per kg, gula Rp 15 ribu, minyak Rp.20.000'
    const out = parseRupiahMentions(t)
    expect(out.map((o) => o.harga)).toEqual([14500, 15000, 20000])
  })
  it('membatasi maksimum 8 kandidat (anti-bloat)', () => {
    const t = 'Rp1000. '.repeat(20)
    const out = parseRupiahMentions(t)
    expect(out.length).toBe(8)
  })
  it('menyertakan "pre" 55 char sebelum Rp untuk "nearest name wins"', () => {
    const t = 'harga gula pasir premium kelas satu Rp15.000 per kg'
    const [pick] = parseRupiahMentions(t)
    expect(pick.pre).toContain('gula')
    expect(pick.pre.length).toBeLessThanOrEqual(55)
  })
  it('menolak input kosong / non-string', () => {
    expect(parseRupiahMentions('')).toEqual([])
    expect(parseRupiahMentions(null)).toEqual([])
  })
})

// --- Aturan grounding paling halus: nearest name wins (anti-distractor) ---
describe('pickCommodityPrice — nearest name wins (pilar #2 grounding, anti-distractor)', () => {
  const cfgBBM = { min: 5000, max: 30000 }
  const kwsBBM = ['pertalite']
  const hints = ['/liter', 'per liter']
  const negs = ['solar', 'pertamax', 'dex']

  it('menerima kandidat "strong": nama target tepat sebelum angka + satuan cocok', () => {
    const item = { title: 'Harga BBM', snippet: 'Pertalite dijual Rp 10.000 per liter di SPBU.' }
    const pick = pickCommodityPrice(item, cfgBBM, kwsBBM, hints, negs)
    expect(pick).toBeTruthy()
    expect(pick.harga).toBe(10000)
    expect(pick.strong).toBe(true)
    expect(pick.hasUnit).toBe(true)
    expect(pick.score).toBe(3) // 2 strong + 1 unit
  })

  it('menolak angka milik produk tetangga yang LEBIH DEKAT ke angka (Solar vs Pertalite)', () => {
    const teks = 'Pertalite tetap. Solar naik jadi Rp 6.800 per liter di beberapa daerah.'
    const item = { title: 'Update BBM', snippet: teks }
    const pick = pickCommodityPrice(item, cfgBBM, kwsBBM, hints, negs)
    // "solar" berada lebih dekat ke Rp 6.800 daripada "pertalite" -> harus null
    expect(pick).toBeNull()
  })

  it('menolak kalimat yang tak menyebut nama target (grounding wajib)', () => {
    const item = { title: 'Kondisi Pasar', snippet: 'Harga BBM naik Rp 10.000 per liter.' }
    // Tak ada kata "pertalite" -> tolak
    const pick = pickCommodityPrice(item, cfgBBM, kwsBBM, hints, negs)
    expect(pick).toBeNull()
  })

  it('menolak harga di luar rentang wajar (anti outlier)', () => {
    const item = { title: 'x', snippet: 'Pertalite Rp 200.000 per liter (typo).' }
    const pick = pickCommodityPrice(item, cfgBBM, kwsBBM, hints, negs)
    expect(pick).toBeNull()
  })

  it('memilih skor tertinggi bila banyak kandidat sah', () => {
    // Kalimat pertama TIDAK menyebut satuan di window 90-char sekitar Rp.
    // Kalimat kedua menyebut "per liter" — score lebih tinggi menang.
    const gap = ' '.repeat(220) // spacer supaya window kal tidak overlap
    const item = {
      title: 'BBM',
      snippet: `Pertalite kemarin Rp 10.500 saja.${gap}Di SPBU, Pertalite dijual Rp 10.000 per liter.`,
    }
    const pick = pickCommodityPrice(item, cfgBBM, kwsBBM, hints, negs)
    // Kandidat kedua strong + hasUnit (score 3) menang atas pertama (strong tanpa unit, score 2)
    expect(pick.harga).toBe(10000)
    expect(pick.score).toBe(3)
  })
})

describe('selectRagPrices — Strategy pattern (AI-up vs AI-down)', () => {
  const picks = [
    { key: 'garam', harga: 8000, strong: true, hasUnit: true },
    { key: 'kopi',  harga: 90000, strong: false, hasUnit: true },
    { key: 'lpg',   harga: 22000, strong: true, hasUnit: false },
  ]

  it('AI-up: pakai daftar confirmed = true', () => {
    const rows = selectRagPrices(picks, { confirmOk: true, confirmed: { garam: true, kopi: true, lpg: false } })
    expect(rows.map((r) => r.key).sort()).toEqual(['garam', 'kopi'])
  })
  it('AI-down: hanya kandidat mekanis paling ketat (strong && hasUnit)', () => {
    const rows = selectRagPrices(picks, { confirmOk: false })
    expect(rows.map((r) => r.key)).toEqual(['garam'])
  })
  it('tanpa opsi -> anggap AI-down (aman)', () => {
    const rows = selectRagPrices(picks)
    expect(rows.map((r) => r.key)).toEqual(['garam'])
  })
  it('input kosong -> array kosong (tidak throw)', () => {
    expect(selectRagPrices(null, { confirmOk: true, confirmed: {} })).toEqual([])
    expect(selectRagPrices([], { confirmOk: false })).toEqual([])
  })
})
