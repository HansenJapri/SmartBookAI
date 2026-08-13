// ============================================================
// Factory klien Gemini — satu-satunya jalan memanggil Gemini dari Edge Function.
//
// getGeminiClient(feature) me-resolve API key + model otomatis dari
// FEATURE_ROUTES, jadi tidak ada key/model yang tersebar di codebase.
//
// Juga menyediakan generateWithFallback(): menjalankan model utama, dan bila
// hasilnya gagal validasi (schema/checksum), MENCOBA SEKALI LAGI dengan model
// fallback pada bucket model berbeda (tidak memakan kuota Flash-Lite).
// ============================================================
import { FEATURE_ROUTES, resolveKey, type FeatureName, type FeatureRoute } from './config.ts'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export class GeminiKeyMissingError extends Error {
  constructor(slot: string) {
    super(`GEMINI_KEY_${slot} belum diatur sebagai secret di Supabase.`)
    this.name = 'GeminiKeyMissingError'
  }
}

/**
 * Sebab kegagalan yang BERBEDA PENANGANANNYA. Sebelum ini semua kegagalan
 * Gemini berakhir jadi satu kalimat "Layanan AI sedang tidak tersedia", dan
 * kalimat itulah yang membuat pemadaman 10 Agustus 2026 tidak terdiagnosis
 * berhari-hari: kunci yang dicabut, kuota harian yang habis, dan model yang
 * dipensiunkan Google tampak identik dari layar pengguna maupun dari log.
 */
export type GeminiFailureCode =
  /** Kunci ditolak/dicabut/dibatasi — hanya pemilik akun yang bisa memperbaiki. */
  | 'INVALID_KEY'
  /** Kuota di sisi Google habis (RPD/RPM), bukan kuota aplikasi. */
  | 'QUOTA'
  /** Nama model tidak dikenal atau sudah dipensiunkan. */
  | 'MODEL_UNAVAILABLE'
  /** Google sedang bermasalah/kapasitas dipangkas (5xx). */
  | 'UPSTREAM'
  /** Payload kita sendiri yang salah — bug aplikasi, bukan gangguan Google. */
  | 'BAD_REQUEST'
  /** Jaringan putus sebelum sempat dapat status HTTP. */
  | 'NETWORK'

export class GeminiCallError extends Error {
  readonly code: GeminiFailureCode
  readonly status: number | null
  readonly model: string
  readonly detail: string

  constructor(code: GeminiFailureCode, status: number | null, model: string, detail: string) {
    super(`Gemini ${model} gagal (${code}${status ? ` HTTP ${status}` : ''}): ${detail.slice(0, 300)}`)
    this.name = 'GeminiCallError'
    this.code = code
    this.status = status
    this.model = model
    this.detail = detail
  }

  /** Layak dicoba ke model lain? Salah payload tidak akan membaik di model lain. */
  get retryable(): boolean {
    return this.code === 'MODEL_UNAVAILABLE' || this.code === 'UPSTREAM'
      || this.code === 'QUOTA' || this.code === 'NETWORK'
  }
}

function classify(status: number, body: string): GeminiFailureCode {
  const teks = body.toUpperCase()
  if (status === 401 || status === 403) return 'INVALID_KEY'
  if (status === 400 && (teks.includes('API_KEY_INVALID') || teks.includes('API KEY NOT VALID'))) return 'INVALID_KEY'
  if (status === 429) return 'QUOTA'
  if (status === 404) return 'MODEL_UNAVAILABLE'
  if (status >= 500) return 'UPSTREAM'
  return 'BAD_REQUEST'
}

/**
 * Kalimat untuk PENGGUNA AKHIR. Pemilik warung tidak bisa berbuat apa-apa
 * dengan "HTTP 429 RESOURCE_EXHAUSTED", tapi dia sangat bisa berbuat sesuatu
 * dengan "jatah AI hari ini habis, besok normal lagi" — dan dia berhak tahu
 * yang mana dari keduanya yang sedang terjadi.
 */
export function pesanUntukPengguna(code: GeminiFailureCode): string {
  switch (code) {
    case 'INVALID_KEY':
      return 'Layanan AI belum aktif: kunci API Gemini ditolak Google. '
        + 'Hubungi admin aplikasi untuk memperbarui kunci di pengaturan server.'
    case 'QUOTA':
      return 'Jatah pemakaian AI di Google untuk hari ini sudah habis. '
        + 'Coba lagi besok, atau pakai form manual untuk sekarang.'
    case 'MODEL_UNAVAILABLE':
      return 'Model AI yang dipakai aplikasi sudah tidak dilayani Google. '
        + 'Hubungi admin aplikasi — pengaturan model perlu diperbarui.'
    case 'BAD_REQUEST':
      return 'Permintaan ke layanan AI ditolak. Ini kesalahan aplikasi, '
        + 'bukan kesalahan Anda — silakan laporkan lewat menu Feedback.'
    default:
      return 'Layanan AI sedang tidak tersedia. Coba lagi sebentar lagi, atau pakai form manual.'
  }
}

/** Ubah error apa pun jadi payload JSON yang seragam untuk Edge Function. */
export function payloadGagalAI(e: unknown): { error: string; code: string; detail: string } {
  if (e instanceof GeminiCallError) {
    return { error: pesanUntukPengguna(e.code), code: e.code, detail: e.detail.slice(0, 300) }
  }
  if (e instanceof GeminiKeyMissingError) {
    return {
      error: 'Layanan AI belum dikonfigurasi di server (kunci API belum diatur).',
      code: 'KEY_MISSING',
      detail: String(e).slice(0, 300),
    }
  }
  return { error: pesanUntukPengguna('UPSTREAM'), code: 'UNKNOWN', detail: String(e).slice(0, 300) }
}

export interface GenerateOptions {
  prompt?: string
  /** Bagian mentah (mis. untuk kiriman gambar/PDF pada OCR). */
  parts?: unknown[]
  temperature?: number
  maxOutputTokens?: number
  /** true = minta Gemini membalas JSON murni. */
  json?: boolean
  /** Definisi function-calling (whitelist tool). */
  tools?: unknown[]
  /** Matikan mode "thinking" agar maxOutputTokens tidak termakan. */
  disableThinking?: boolean
  systemInstruction?: string
}

export interface GenerateResult {
  text: string
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>
  finishReason: string | null
  modelUsed: string
  /** true bila hasil ini berasal dari model fallback. */
  usedFallback: boolean
}

/** Satu giliran percakapan (untuk chat multi-turn). */
export interface ChatTurn {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

export interface GeminiClient {
  feature: FeatureName
  route: FeatureRoute
  model: string
  fallbackModel?: string
  quotaFeature: FeatureRoute['quotaFeature']
  dailyCap: number
  generate(opts: GenerateOptions): Promise<GenerateResult>
  /** Varian multi-turn untuk Chat Tanya (menyertakan riwayat percakapan). */
  generateChat(contents: ChatTurn[], opts?: Omit<GenerateOptions, 'prompt' | 'parts'>): Promise<GenerateResult>
  /**
   * Jalankan lalu validasi. Bila validate() melempar/false, retry SEKALI dengan
   * fallbackModel. Bila fallback juga gagal, lempar error terakhir.
   */
  generateWithFallback<T>(
    opts: GenerateOptions,
    validate: (r: GenerateResult) => T,
  ): Promise<{ value: T; result: GenerateResult }>
}

async function callModel(
  apiKey: string,
  model: string,
  opts: GenerateOptions,
  /** Bila diisi, dipakai apa adanya sebagai "contents" (chat multi-turn). */
  contentsOverride?: ChatTurn[],
): Promise<GenerateResult> {
  const parts = opts.parts ?? [{ text: opts.prompt ?? '' }]

  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.2,
    maxOutputTokens: opts.maxOutputTokens ?? 1024,
  }
  if (opts.json) generationConfig.responseMimeType = 'application/json'
  if (opts.disableThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 }

  const body: Record<string, unknown> = {
    contents: contentsOverride ?? [{ role: 'user', parts }],
    generationConfig,
  }
  if (opts.tools) body.tools = opts.tools
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new GeminiCallError('NETWORK', null, model, String(e))
  }

  if (!res.ok) {
    const detail = await res.text()
    throw new GeminiCallError(classify(res.status, detail), res.status, model, detail)
  }

  const data = await res.json()
  const cand = data?.candidates?.[0]
  const rawParts = cand?.content?.parts ?? []

  const text = rawParts
    .map((p: Record<string, unknown>) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim()

  const functionCalls = rawParts
    .filter((p: Record<string, unknown>) => p.functionCall)
    .map((p: Record<string, unknown>) => {
      const fc = p.functionCall as { name: string; args?: Record<string, unknown> }
      return { name: fc.name, args: fc.args ?? {} }
    })

  return {
    text,
    functionCalls,
    finishReason: cand?.finishReason ?? null,
    modelUsed: model,
    usedFallback: false,
  }
}

export function getGeminiClient(feature: FeatureName): GeminiClient {
  const route = FEATURE_ROUTES[feature]
  if (!route) throw new Error(`Fitur AI tidak dikenal: ${feature}`)

  const apiKey = resolveKey(route.key)
  if (!apiKey) throw new GeminiKeyMissingError(route.key)

  const chain = [route.model, ...(route.fallbackModel ? [route.fallbackModel] : [])]

  /**
   * Jalankan rantai model sampai ada yang berhasil.
   *
   * Kegagalan TRANSPOR (model dipensiunkan, kuota Google habis, 5xx) pindah ke
   * model berikutnya; kegagalan payload (400) tidak, karena permintaan yang
   * salah bentuk akan ditolak sama persis oleh model mana pun dan retry hanya
   * menggandakan latensi. Setiap kegagalan DICATAT ke log Edge Function: log
   * yang sunyi adalah alasan pemadaman kemarin baru ketahuan setelah pengguna
   * yang mengeluh, bukan setelah grafik yang berubah.
   */
  async function jalankanRantai(
    opts: GenerateOptions,
    contents: ChatTurn[] | undefined,
    mulaiDari = 0,
  ): Promise<GenerateResult> {
    let terakhir: unknown
    for (let i = mulaiDari; i < chain.length; i++) {
      const model = chain[i]
      try {
        const result = await callModel(apiKey!, model, opts, contents)
        result.usedFallback = i > 0
        if (i > 0) console.warn(`[ai:${feature}] berhasil dengan model cadangan ${model}`)
        return result
      } catch (e) {
        terakhir = e
        const bisaLanjut = e instanceof GeminiCallError && e.retryable && i < chain.length - 1
        console.error(`[ai:${feature}] ${model} gagal: ${String(e).slice(0, 300)}`)
        if (!bisaLanjut) throw e
      }
    }
    throw terakhir
  }

  return {
    feature,
    route,
    model: route.model,
    fallbackModel: route.fallbackModel,
    quotaFeature: route.quotaFeature,
    dailyCap: route.dailyCap,

    generate: (opts) => jalankanRantai(opts, undefined),

    generateChat(contents, opts = {}) {
      return jalankanRantai(opts, contents)
    },

    async generateWithFallback(opts, validate) {
      // Percobaan 1 — rantai model normal (sudah menangani kegagalan transpor).
      let result = await jalankanRantai(opts, undefined)
      try {
        return { value: validate(result), result }
      } catch (gagalValidasi) {
        // Model menjawab, tapi jawabannya tidak lolos schema/checksum. Ini kasus
        // yang berbeda dari kegagalan transpor: yang perlu diganti bukan
        // saluran, melainkan model yang menyusun jawabannya.
        const berikutnya = chain.indexOf(result.modelUsed) + 1
        if (berikutnya <= 0 || berikutnya >= chain.length) throw gagalValidasi
        console.warn(`[ai:${feature}] hasil ${result.modelUsed} gagal validasi, coba ${chain[berikutnya]}`)
        result = await jalankanRantai(opts, undefined, berikutnya)
        result.usedFallback = true
        return { value: validate(result), result }
      }
    },
  }
}
