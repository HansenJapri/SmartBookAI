// ============================================================
// CRUD via prompt/voice — pembangun tool + validator + slot-filling.
//
// LAPIS PERTAHANAN PERTAMA: hanya entitas di ENTITY_SPECS yang dibuatkan tool.
// Endpoint sensitif (auth, password, 2FA, PIN, /settings/*) TIDAK PERNAH
// didaftarkan sebagai tool, jadi model tidak punya cara memanggilnya.
//
// Alur:
//   1. buildCrudTools()      -> daftar function declaration untuk Gemini
//   2. validateDraft()       -> cek tipe, enum, batas, tolak field asing
//   3. resolveReferences()   -> pastikan ID yang disebut AI benar-benar ada
//   4. computeClarifications() -> susun pertanyaan untuk field yang kosong
// ============================================================
import { getEntitySpec, ENTITY_NAMES, type EntitySpec, type FieldSpec } from './entity-schemas.ts'
import { checkActionAllowed } from '../guards/action-blocklist.ts'

export interface DraftAction {
  entity: string
  operation: 'create' | 'update' | 'delete'
  /** ID baris target (untuk update/delete). */
  targetId?: string
  values: Record<string, unknown>
}

export interface ClarificationQuestion {
  field: string
  label: string
  question: string
  required: boolean
  type: string
  /** Pilihan yang valid, bila ada. */
  options?: string[]
}

export interface ValidationIssue {
  field: string
  message: string
}

export interface ValidatedDraft {
  ok: boolean
  entity: string
  entityLabel: string
  operation: 'create' | 'update' | 'delete'
  targetId?: string
  values: Record<string, unknown>
  issues: ValidationIssue[]
  /** Pertanyaan untuk field wajib yang masih kosong. */
  missingRequired: ClarificationQuestion[]
  /** Pertanyaan untuk field opsional yang belum disinggung (ditanya sekali). */
  optionalPrompts: ClarificationQuestion[]
  /** true = harus dikonfirmasi manual di UI sebelum masuk database. */
  requiresConfirmation: boolean
  /** Modul RBAC yang dibutuhkan. */
  module: string
}

// ---------- 1. Bangun function-calling tools (whitelist saja) ----------
export function buildCrudTools(allowedEntities: string[] = ENTITY_NAMES) {
  const declarations = allowedEntities
    .map((name) => getEntitySpec(name))
    .filter((s): s is EntitySpec => Boolean(s))
    .flatMap((spec) =>
      spec.allow.map((op) => ({
        name: `${op}_${spec.entity}`,
        description:
          `${op === 'create' ? 'Membuat' : op === 'update' ? 'Mengubah' : 'Menghapus'} ${spec.label}. `
          + `Isi HANYA field yang benar-benar disebut pengguna; biarkan kosong bila tidak disebut — `
          + `sistem akan menanyakannya sendiri ke pengguna.`,
        parameters: {
          type: 'object',
          properties: {
            ...(op !== 'create'
              ? { targetId: { type: 'string', description: `ID ${spec.label} yang menjadi target.` } }
              : {}),
            ...Object.fromEntries(
              spec.fields.map((f) => [
                f.name,
                {
                  type: fieldToJsonType(f),
                  description: `${f.label}${f.required ? ' (wajib)' : ' (opsional)'}`,
                  ...(f.enumValues ? { enum: f.enumValues } : {}),
                },
              ]),
            ),
          },
          // Sengaja TIDAK memakai "required": bila pengguna tidak menyebutnya,
          // kita ingin field itu kosong supaya bisa DITANYAKAN, bukan dikarang AI.
          required: [],
        },
      })),
    )

  return [{ functionDeclarations: declarations }]
}

function fieldToJsonType(f: FieldSpec): string {
  switch (f.type) {
    case 'number':
    case 'money':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'string'
  }
}

// ---------- 2. Validasi draft ----------
export function validateDraft(
  toolName: string,
  args: Record<string, unknown>,
): ValidatedDraft | { ok: false; blocked: true; reason: string } {
  // Jaring pengaman kedua: cek blocklist sebelum apa pun diproses.
  const block = checkActionAllowed(toolName, args)
  if (block.blocked) {
    return { ok: false, blocked: true, reason: block.reason ?? 'Aksi ditolak.' }
  }

  const m = /^(create|update|delete)_(.+)$/.exec(toolName)
  if (!m) {
    return { ok: false, blocked: true, reason: `Nama tool tidak dikenal: ${toolName}` }
  }
  const operation = m[1] as 'create' | 'update' | 'delete'
  const entity = m[2]

  const spec = getEntitySpec(entity)
  if (!spec) {
    return { ok: false, blocked: true, reason: `Entitas tidak diizinkan: ${entity}` }
  }
  if (!spec.allow.includes(operation)) {
    return { ok: false, blocked: true, reason: `Operasi ${operation} tidak diizinkan untuk ${spec.label}.` }
  }

  const issues: ValidationIssue[] = []
  const values: Record<string, unknown> = {}
  const known = new Set(spec.fields.map((f) => f.name))

  // Tolak field asing — jangan pernah diteruskan ke database.
  for (const k of Object.keys(args)) {
    if (k === 'targetId') continue
    if (!known.has(k)) {
      issues.push({ field: k, message: `Field "${k}" tidak dikenal untuk ${spec.label} dan diabaikan.` })
    }
  }

  for (const f of spec.fields) {
    const raw = args[f.name]
    if (raw === undefined || raw === null || raw === '') continue

    const parsed = coerceField(f, raw, issues)
    if (parsed !== undefined) values[f.name] = parsed
  }

  const targetId = typeof args.targetId === 'string' ? args.targetId : undefined
  if (operation !== 'create' && !targetId) {
    issues.push({ field: 'targetId', message: `Operasi ${operation} butuh ID target.` })
  }

  // Field wajib yang masih kosong -> pertanyaan (khusus create).
  const missingRequired: ClarificationQuestion[] = []
  const optionalPrompts: ClarificationQuestion[] = []

  if (operation === 'create') {
    for (const f of spec.fields) {
      const filled = values[f.name] !== undefined
      if (f.required && !filled) {
        missingRequired.push(toQuestion(f))
      } else if (!f.required && !filled) {
        // Permintaan pengguna: field opsional tetap ditanyakan SEKALI.
        optionalPrompts.push(toQuestion(f))
      }
    }
  }

  // Konfirmasi manual wajib untuk: delete, update, dan create yang menyentuh uang/stok.
  const touchesFinancial = spec.fields.some((f) => f.financial && values[f.name] !== undefined)
  const requiresConfirmation =
    operation === 'delete' ||
    operation === 'update' ||
    spec.confirmOnCreate ||
    touchesFinancial

  return {
    ok: missingRequired.length === 0 && issues.filter((i) => i.field === 'targetId').length === 0,
    entity: spec.entity,
    entityLabel: spec.label,
    operation,
    targetId,
    values,
    issues,
    missingRequired,
    optionalPrompts,
    requiresConfirmation,
    module: spec.module,
  }
}

function toQuestion(f: FieldSpec): ClarificationQuestion {
  return {
    field: f.name,
    label: f.label,
    question: f.ask,
    required: f.required,
    type: f.type,
    options: f.enumValues,
  }
}

function coerceField(f: FieldSpec, raw: unknown, issues: ValidationIssue[]): unknown {
  switch (f.type) {
    case 'number':
    case 'money': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.-]/g, ''))
      if (!Number.isFinite(n)) {
        issues.push({ field: f.name, message: `${f.label} harus berupa angka.` })
        return undefined
      }
      const rounded = f.type === 'money' ? Math.round(n) : n
      if (f.min !== undefined && rounded < f.min) {
        issues.push({ field: f.name, message: `${f.label} minimal ${f.min}.` })
        return undefined
      }
      if (f.max !== undefined && rounded > f.max) {
        issues.push({ field: f.name, message: `${f.label} melebihi batas wajar (${f.max}).` })
        return undefined
      }
      return rounded
    }
    case 'boolean':
      return Boolean(raw)
    case 'enum': {
      const v = String(raw).trim()
      if (f.enumValues && !f.enumValues.includes(v)) {
        // Bukan error fatal: field akan ditanyakan ulang ke pengguna.
        issues.push({ field: f.name, message: `${f.label} "${v}" bukan pilihan yang sah.` })
        return undefined
      }
      return v
    }
    case 'date': {
      const v = String(raw).trim()
      if (!/^\d{4}-\d{2}-\d{2}/.test(v)) {
        issues.push({ field: f.name, message: `${f.label} harus format YYYY-MM-DD.` })
        return undefined
      }
      return v
    }
    case 'ref':
      return String(raw).trim()
    default: {
      const v = String(raw).trim()
      if (f.max && v.length > f.max) return v.slice(0, f.max)
      return v
    }
  }
}

// ---------- 3. Validasi referensi (ID benar-benar ada) ----------
export async function resolveReferences(
  supabase: { from: (t: string) => any },
  draft: ValidatedDraft,
): Promise<ValidationIssue[]> {
  const spec = getEntitySpec(draft.entity)
  if (!spec) return [{ field: 'entity', message: 'Entitas tidak dikenal.' }]

  const problems: ValidationIssue[] = []

  for (const f of spec.fields) {
    if (f.type !== 'ref' || !f.refTable) continue
    const id = draft.values[f.name]
    if (!id) continue

    const { data, error } = await supabase
      .from(f.refTable)
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (error || !data) {
      problems.push({ field: f.name, message: `${f.label} yang disebut tidak ditemukan di data Anda.` })
      delete draft.values[f.name]
    }
  }

  // Target update/delete juga harus ada.
  if (draft.operation !== 'create' && draft.targetId) {
    const { data, error } = await supabase
      .from(spec.table)
      .select('id')
      .eq('id', draft.targetId)
      .maybeSingle()
    if (error || !data) {
      problems.push({ field: 'targetId', message: `${spec.label} yang ingin diubah/dihapus tidak ditemukan.` })
    }
  }

  return problems
}

// ---------- 4. Susun pertanyaan lanjutan untuk pengguna ----------
export interface ClarificationPlan {
  needsClarification: boolean
  /** Pertanyaan berikutnya yang harus diajukan (satu per satu agar tidak membingungkan). */
  next: ClarificationQuestion | null
  /** Semua pertanyaan yang tersisa. */
  pending: ClarificationQuestion[]
  /** Ringkasan enak dibaca untuk ditampilkan/diucapkan. */
  spokenPrompt: string
}

export function computeClarifications(draft: ValidatedDraft): ClarificationPlan {
  // Wajib dulu, baru opsional.
  const pending = [...draft.missingRequired, ...draft.optionalPrompts]
  const next = pending[0] ?? null

  let spokenPrompt = ''
  if (next) {
    const opts = next.options?.length ? ` Pilihannya: ${next.options.join(', ')}.` : ''
    spokenPrompt = `${next.question}${opts}`
  }

  return {
    needsClarification: pending.length > 0,
    next,
    pending,
    spokenPrompt,
  }
}

/** Terapkan jawaban pengguna untuk satu field ke draft yang sedang berjalan. */
export function applyAnswer(
  draft: ValidatedDraft,
  field: string,
  answer: unknown,
): ValidatedDraft {
  const spec = getEntitySpec(draft.entity)
  if (!spec) return draft

  const f = spec.fields.find((x) => x.name === field)
  if (!f) return draft

  const skipped = typeof answer === 'string'
    && /^(lewati|skip|tidak|nggak|gak|engga|enggak|kosong|-)$/i.test(answer.trim())

  if (skipped) {
    if (f.fallback !== undefined && f.fallback !== 'today') draft.values[f.name] = f.fallback
  } else {
    const issues: ValidationIssue[] = []
    const parsed = coerceField(f, answer, issues)
    if (parsed !== undefined) draft.values[f.name] = parsed
    else draft.issues.push(...issues)
  }

  draft.missingRequired = draft.missingRequired.filter((q) => q.field !== field)
  draft.optionalPrompts = draft.optionalPrompts.filter((q) => q.field !== field)
  draft.ok = draft.missingRequired.length === 0

  return draft
}
