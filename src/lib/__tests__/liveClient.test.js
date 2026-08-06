import { describe, it, expect } from 'vitest'
import { LIVE_EVENT, buildSetupFrame, liveSocketUrl, parseServerMessage } from '../liveClient'

// ============================================================
// Penerjemah pesan Gemini Live.
//
// Semua asumsi tentang bentuk balasan Live API terkumpul di sini. Kalau Google
// mengubah nama field, berkas test inilah yang gagal lebih dulu — bukan
// mikrofon pengguna di warung.
// ============================================================

describe('liveSocketUrl', () => {
  it('menyusun URL v1alpha dengan access_token', () => {
    const url = liveSocketUrl('tok-123')
    expect(url.startsWith('wss://generativelanguage.googleapis.com/ws/')).toBe(true)
    expect(url).toContain('v1alpha.GenerativeService.BidiGenerateContent')
    expect(url).toContain('access_token=tok-123')
  })

  it('meng-encode token yang memuat karakter URL', () => {
    expect(liveSocketUrl('a/b+c=')).toContain('access_token=a%2Fb%2Bc%3D')
  })
})

describe('buildSetupFrame', () => {
  it('menambahkan awalan models/ bila belum ada', () => {
    const f = buildSetupFrame({ model: 'gemini-2.5-flash-native-audio-dialog', systemInstruction: 'x' })
    expect(f.setup.model).toBe('models/gemini-2.5-flash-native-audio-dialog')
  })

  it('tidak menggandakan awalan models/', () => {
    const f = buildSetupFrame({ model: 'models/abc', systemInstruction: 'x' })
    expect(f.setup.model).toBe('models/abc')
  })

  it('TIDAK mengunci languageCode agar balasan bisa berganti bahasa', () => {
    // Mengunci bahasa di sini membuat model tetap menjawab Indonesia walau
    // pengguna beralih ke Inggris — persis kebalikan yang diinginkan.
    const f = buildSetupFrame({ model: 'm', systemInstruction: 'x' })
    expect(f.setup.generationConfig.speechConfig.languageCode).toBeUndefined()
  })

  it('menyalakan transkrip dua arah untuk mode audio', () => {
    const f = buildSetupFrame({ model: 'm', systemInstruction: 'x' })
    expect(f.setup.inputAudioTranscription).toBeDefined()
    expect(f.setup.outputAudioTranscription).toBeDefined()
  })

  it('mode teks tidak membawa konfigurasi suara', () => {
    const f = buildSetupFrame({ model: 'm', systemInstruction: 'x', audioOut: false })
    expect(f.setup.generationConfig.responseModalities).toEqual(['TEXT'])
    expect(f.setup.generationConfig.speechConfig).toBeUndefined()
  })

  it('membungkus deklarasi fungsi dalam functionDeclarations', () => {
    const f = buildSetupFrame({ model: 'm', systemInstruction: 'x', tools: [{ name: 'a' }] })
    expect(f.setup.tools).toEqual([{ functionDeclarations: [{ name: 'a' }] }])
  })

  it('tidak mengirim field tools saat tidak ada fungsi sama sekali', () => {
    const f = buildSetupFrame({ model: 'm', systemInstruction: 'x' })
    expect(f.setup.tools).toBeUndefined()
  })
})

describe('parseServerMessage', () => {
  it('setupComplete menjadi READY', () => {
    expect(parseServerMessage({ setupComplete: {} })).toEqual([{ type: LIVE_EVENT.READY }])
  })

  it('mengambil audio inlineData sebagai event AUDIO', () => {
    const ev = parseServerMessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'QUJD' } }] },
      },
    })
    expect(ev).toEqual([{ type: LIVE_EVENT.AUDIO, data: 'QUJD' }])
  })

  it('mengabaikan inlineData non-audio', () => {
    const ev = parseServerMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'image/png', data: 'x' } }] } },
    })
    expect(ev).toEqual([])
  })

  it('INTERRUPTED muncul sebelum event lain pada pesan yang sama', () => {
    // Urutan penting: audio yang mengantre harus dibuang lebih dulu, kalau
    // tidak potongan baru ikut menumpuk di belakang audio yang sudah batal.
    const ev = parseServerMessage({
      serverContent: {
        interrupted: true,
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'x' } }] },
      },
    })
    expect(ev[0].type).toBe(LIVE_EVENT.INTERRUPTED)
  })

  it('memisahkan transkrip masukan dan keluaran', () => {
    const ev = parseServerMessage({
      serverContent: {
        inputTranscription: { text: 'tambah stok beras' },
        outputTranscription: { text: 'baik, saya catat' },
      },
    })
    expect(ev).toContainEqual({ type: LIVE_EVENT.INPUT_TEXT, text: 'tambah stok beras' })
    expect(ev).toContainEqual({ type: LIVE_EVENT.OUTPUT_TEXT, text: 'baik, saya catat' })
  })

  it('turnComplete menandai giliran pengguna selesai', () => {
    const ev = parseServerMessage({ serverContent: { turnComplete: true } })
    expect(ev).toEqual([{ type: LIVE_EVENT.TURN_COMPLETE }])
  })

  it('toolCall diteruskan lengkap dengan id agar balasannya bisa dipasangkan', () => {
    const calls = [{ id: 'fc-1', name: 'create_transaksi', args: { amount: 1000 } }]
    const ev = parseServerMessage({ toolCall: { functionCalls: calls } })
    expect(ev).toEqual([{ type: LIVE_EVENT.TOOL_CALL, calls }])
  })

  it('goAway dikenali sebagai sinyal sambung ulang, bukan error', () => {
    const ev = parseServerMessage({ goAway: { timeLeft: '5s' } })
    expect(ev[0].type).toBe(LIVE_EVENT.GO_AWAY)
  })

  it('pesan kosong atau asing tidak melempar', () => {
    expect(parseServerMessage(null)).toEqual([])
    expect(parseServerMessage({})).toEqual([])
    expect(parseServerMessage({ sesuatuYangBaru: 1 })).toEqual([])
  })
})
