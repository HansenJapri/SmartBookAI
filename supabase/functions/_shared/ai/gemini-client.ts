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

  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Gemini ${model} HTTP ${res.status}: ${detail.slice(0, 300)}`)
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

  const generate = (opts: GenerateOptions) => callModel(apiKey, route.model, opts)

  return {
    feature,
    route,
    model: route.model,
    fallbackModel: route.fallbackModel,
    quotaFeature: route.quotaFeature,
    dailyCap: route.dailyCap,
    generate,

    generateChat(contents, opts = {}) {
      return callModel(apiKey, route.model, opts, contents)
    },

    async generateWithFallback(opts, validate) {
      // Percobaan 1 — model utama.
      let firstErr: unknown
      try {
        const result = await callModel(apiKey, route.model, opts)
        return { value: validate(result), result }
      } catch (e) {
        firstErr = e
      }

      // Percobaan 2 — model fallback (maksimal 1x, sesuai spesifikasi).
      if (!route.fallbackModel) throw firstErr
      const result = await callModel(apiKey, route.fallbackModel, opts)
      result.usedFallback = true
      return { value: validate(result), result }
    },
  }
}
