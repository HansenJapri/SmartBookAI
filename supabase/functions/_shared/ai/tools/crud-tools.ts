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
  /**
   * Nama yang dapat dibaca manusia untuk tiap field `ref` yang sudah
   * diresolusi, mis. { product_id: 'Nasi Goreng' }. Dipakai kartu ringkasan:
   * menampilkan UUID kepada pemilik warung sama saja dengan tidak menampilkan
   * apa-apa — ia tidak bisa memeriksa apakah produknya benar sebelum menyimpan.
   */
  refLabels?: Record<string, string>
  /**
   * Field yang pertanyaannya sudah pernah diajukan. Dipakai penyegaran
   * pertanyaan bersyarat agar sesuatu yang sengaja dilewati pengguna tidak
   * ditanyakan lagi begitu syaratnya kebetulan terpenuhi kembali.
   */
  sudahDitanya?: string[]
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
        // Hanya field opsional yang kekosongannya merusak angka atau
        // menghilangkan uang yang ditanyakan — lihat catatan panjang di kepala
        // entity-schemas.ts. Sisanya diberi nilai bawaannya dan tetap bisa
        // disunting di kartu ringkasan.
        if (perluDitanya(f, values)) optionalPrompts.push(toQuestion(f))
        else terapkanFallback(f, values)
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

/** Apakah field opsional ini layak menghabiskan satu giliran percakapan. */
function perluDitanya(f: FieldSpec, values: Record<string, unknown>): boolean {
  if (!f.tanyaBilaKosong) return false
  if (f.tanyaBila && !f.tanyaBila(values)) return false
  return true
}

/**
 * Nilai bawaan untuk field opsional yang TIDAK ditanyakan.
 *
 * Diisi di sini, bukan dibiarkan undefined, supaya kartu ringkasan menampilkan
 * apa yang benar-benar akan tersimpan. Kartu yang memperlihatkan "Channel:
 * (kosong)" lalu menyimpan "manual" membuat konfirmasi manusia kehilangan
 * artinya — yang diperiksa bukan yang ditulis.
 *
 * 'today' adalah penanda, bukan nilai: pengisian tanggal hari ini ditangani
 * occurredAtIso() di klien, yang tahu zona waktu perangkat.
 */
function terapkanFallback(f: FieldSpec, values: Record<string, unknown>) {
  if (f.fallback === undefined || f.fallback === 'today') return
  values[f.name] = f.fallback
}

/**
 * Susun ulang pertanyaan opsional bersyarat setelah sebuah jawaban masuk.
 *
 * Dibutuhkan karena syaratnya bergantung pada jawaban yang BELUM ada saat
 * daftar pertanyaan pertama kali disusun: jatuh tempo baru relevan setelah
 * pengguna menjawab "belum lunas", dan jumlah baru relevan setelah produknya
 * dipilih. Tanpa penyegaran ini, keduanya tidak akan pernah ditanyakan.
 *
 * `sudahDitanya` mencegah pertanyaan yang sengaja dilewati pengguna muncul
 * kembali — tanpa itu, melewati jatuh tempo akan menghasilkan lingkaran tak
 * berujung karena syaratnya masih terpenuhi dan nilainya masih kosong.
 */
function segarkanPertanyaanOpsional(draft: ValidatedDraft) {
  if (draft.operation !== 'create') return
  const spec = getEntitySpec(draft.entity)
  if (!spec) return

  const ditanya = new Set(draft.sudahDitanya || [])
  for (const f of spec.fields) {
    if (f.required || !f.tanyaBilaKosong) continue
    if (ditanya.has(f.name)) continue
    if (draft.values[f.name] !== undefined) continue
    if (draft.optionalPrompts.some((q) => q.field === f.name)) continue
    if (!perluDitanya(f, draft.values)) continue
    draft.optionalPrompts.push(toQuestion(f))
  }

  // Syarat bisa berubah ke arah sebaliknya: pengguna mengoreksi "belum lunas"
  // menjadi "lunas", dan jatuh tempo yang sempat mengantre kehilangan alasannya.
  //
  // Penarikan ini SENGAJA hanya menyentuh field ber-`tanyaBila`. Antrean
  // pertanyaan juga memuat titipan dari resolveReferences() — nama produk yang
  // ambigu atau tidak ditemukan, yang ditanyakan ulang justru karena pengguna
  // menyebutnya. Field-field itu tidak punya `tanyaBilaKosong`, jadi aturan
  // yang lebih luas ("buang yang tidak perlu ditanya") akan menghapusnya, dan
  // produk yang gagal dikenali hilang tanpa pernah ditanyakan lagi.
  draft.optionalPrompts = draft.optionalPrompts.filter((q) => {
    const f = spec.fields.find((x) => x.name === q.field)
    if (!f || !f.tanyaBila) return true
    return perluDitanya(f, draft.values)
  })
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
      const v = parseTanggalManusiawi(raw)
      if (!v) {
        issues.push({
          field: f.name,
          message: `${f.label} belum terbaca sebagai tanggal. Contoh yang dikenali: `
            + '2026-09-30, 30/09/2026, atau 30 September 2026.',
        })
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

const BULAN_ID: Record<string, number> = {
  januari: 1, jan: 1, february: 2, februari: 2, feb: 2, pebruari: 2,
  maret: 3, mar: 3, march: 3, april: 4, apr: 4, mei: 5, may: 5,
  juni: 6, jun: 6, june: 6, juli: 7, jul: 7, july: 7,
  agustus: 8, agu: 8, agt: 8, aug: 8, august: 8,
  september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, oct: 10, october: 10,
  november: 11, nov: 11, nop: 11, desember: 12, des: 12, dec: 12, december: 12,
}

/**
 * Terjemahkan jawaban tanggal dari BAHASA MANUSIA ke YYYY-MM-DD.
 *
 * Versi sebelumnya hanya menerima YYYY-MM-DD dan menolak selain itu. Terdengar
 * wajar sampai seseorang benar-benar dijawab olehnya: ketika asisten bertanya
 * "Kapan jatuh temponya?", jawaban paling alami adalah "30 September 2026" —
 * dan itulah yang ditolak. Keluhan formatnya pun tidak pernah sampai ke layar,
 * jadi pertanyaannya sekadar muncul lagi, tanpa sebab yang terlihat.
 *
 * Akibatnya rantai putus di tengah: draft tidak pernah dinyatakan siap,
 * tombol Simpan tidak pernah muncul, dan transaksi piutang yang sudah diketik
 * lengkap tidak pernah masuk ke Piutang & Utang. Terlapor 9 September 2026.
 *
 * Yang dikenali: 2026-09-30, 30/09/2026, 30-9-2026, "30 September 2026",
 * "30 sep 2026", "hari ini", "besok", "lusa".
 *
 * SENGAJA TIDAK memakai `new Date(string)`: parser bawaan JS menafsirkan
 * "03/09/2026" sebagai 9 Maret (bulan dulu, gaya Amerika), sementara pengguna
 * Indonesia menulisnya sebagai 3 September. Menebak salah pada tanggal jatuh
 * tempo berarti menagih pelanggan di bulan yang keliru.
 */
export function parseTanggalManusiawi(raw: unknown): string | null {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return null

  const pad = (n: number) => String(n).padStart(2, '0')
  const dariOffset = (hari: number) => {
    // Hari berjalan menurut WIB, bukan UTC: sebelum pukul 07.00 WIB keduanya
    // berbeda tanggal, dan "hari ini" yang meleset sehari pada catatan piutang
    // langsung menggeser umur tagihannya.
    const t = new Date(Date.now() + 7 * 3600 * 1000 + hari * 86400000)
    return t.toISOString().slice(0, 10)
  }

  if (/^(hari ini|sekarang|today)$/.test(v)) return dariOffset(0)
  if (/^(besok|esok|tomorrow)$/.test(v)) return dariOffset(1)
  if (/^(lusa)$/.test(v)) return dariOffset(2)
  if (/^(kemarin|yesterday)$/.test(v)) return dariOffset(-1)

  // 2026-09-30 (dengan atau tanpa bagian waktu)
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const [, y, m, d] = iso
    return sahkanTanggal(Number(y), Number(m), Number(d)) ? `${y}-${pad(Number(m))}-${pad(Number(d))}` : null
  }

  // 30/09/2026, 30-9-2026, 30.09.2026  -> HARI dulu (konvensi Indonesia)
  const dmy = v.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/)
  if (dmy) {
    const d = Number(dmy[1]); const m = Number(dmy[2]); const y = Number(dmy[3])
    return sahkanTanggal(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null
  }

  // "30 september 2026" / "30 sep 2026" / "1 des 2026"
  const teks = v.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/)
  if (teks) {
    const d = Number(teks[1])
    const m = BULAN_ID[teks[2]]
    const y = Number(teks[3])
    if (m && sahkanTanggal(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`
    return null
  }

  return null
}

/** Tanggal yang benar-benar ada — menolak 31 Februari dan sejenisnya. */
function sahkanTanggal(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

// ---------- 3. Resolusi referensi (nama -> ID, lalu pastikan ID itu ada) ----------

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const adalahUuid = (v: unknown) => typeof v === 'string' && POLA_UUID.test(v.trim())

/** Escape wildcard PostgREST agar nama ber-% atau _ dicocokkan harfiah. */
const literal = (s: string) => s.replace(/([%_\\])/g, '\\$1')

/**
 * Nama yang dilihat model & pengguna DITERJEMAHKAN ke ID di sini.
 *
 * INI PENYEBAB UTAMA "AI CRUD error". Model tidak pernah diberi satu pun ID —
 * prompt sistem hanya memuat NAMA ("Produk: [\"Nasi Goreng\"]"), dan daftar
 * pilihan di kartu slot-filling juga berisi nama. Jadi `product_id` sampai ke
 * sini berisi "Nasi Goreng", bukan UUID. Versi sebelumnya langsung menjalankan
 *
 *     supabase.from('products').select('id').eq('id', 'Nasi Goreng')
 *
 * pada kolom bertipe uuid. Postgres menolaknya dengan 22P02 ("invalid input
 * syntax for type uuid"), cabang `if (error || !data)` menghapus nilainya, dan
 * akibatnya berbeda-beda tergantung field:
 *
 *   - product_id pada transaksi (opsional) -> tautan produk RAIB diam-diam,
 *     sehingga "catat penjualan 5 nasi goreng" tidak pernah memotong stok;
 *   - employee_id / criteria_id / product_id PO (wajib) -> field wajib menjadi
 *     kosong SETELAH daftar pertanyaan disusun, jadi tidak pernah ditanyakan
 *     ulang. Draft dinyatakan `ready`, lalu penyimpanan gagal di database
 *     dengan galat NOT NULL yang tidak berarti apa-apa bagi pengguna.
 *
 * Sekarang: UUID diverifikasi seperti biasa, sedangkan teks dicari berdasarkan
 * kolom namanya. Nilai yang tidak juga terselesaikan dikembalikan ke antrean
 * pertanyaan (lihat `resolveReferences`) — bukan dibuang lalu dilupakan.
 */
async function resolveSatuRef(
  supabase: { from: (t: string) => any },
  f: FieldSpec,
  nilai: unknown,
  ownerId?: string,
): Promise<{ id?: string; issue?: ValidationIssue; kandidat?: string[] }> {
  const kolomNama = f.refLabelColumn || 'name'
  const scoped = (q: any) => (ownerId ? q.eq('user_id', ownerId) : q)

  if (adalahUuid(nilai)) {
    const { data, error } = await scoped(
      supabase.from(f.refTable!).select(`id, ${kolomNama}`).eq('id', String(nilai).trim()),
    ).maybeSingle()
    if (error || !data) {
      return { issue: { field: f.name, message: `${f.label} yang disebut tidak ditemukan di data Anda.` } }
    }
    return { id: (data as any).id }
  }

  const teks = String(nilai ?? '').trim()
  if (!teks) return {}

  // Cocok persis dulu (tanpa peduli huruf besar/kecil), baru cocok sebagian.
  // Dua tahap, bukan satu `ilike %teks%`: pengguna yang mengetik "Kopi" saat
  // punya "Kopi" dan "Kopi Susu" bermaksud yang pertama, dan menyodorkan
  // pilihan untuk sesuatu yang sudah jelas hanya memperlambat.
  const persis = await scoped(
    supabase.from(f.refTable!).select(`id, ${kolomNama}`).ilike(kolomNama, literal(teks)).limit(5),
  )
  let baris: any[] = persis?.data ?? []

  if (!baris.length) {
    const sebagian = await scoped(
      supabase.from(f.refTable!).select(`id, ${kolomNama}`).ilike(kolomNama, `%${literal(teks)}%`).limit(5),
    )
    baris = sebagian?.data ?? []
  }

  if (baris.length === 1) return { id: baris[0].id }

  if (baris.length > 1) {
    const kandidat = baris.map((b) => String(b[kolomNama]))
    // Menebak salah satunya akan menautkan catatan ke baris yang keliru, dan
    // kekeliruan itu baru ketahuan berbulan-bulan kemudian lewat stok yang
    // tidak cocok. Lebih baik bertanya sekali.
    return {
      kandidat,
      issue: {
        field: f.name,
        message: `Ada ${baris.length} ${f.label.toLowerCase()} yang cocok dengan "${teks}": ${kandidat.join(', ')}. Pilih salah satu.`,
      },
    }
  }

  return {
    issue: {
      field: f.name,
      message: `${f.label} "${teks}" belum ada di data Anda. Pilih dari daftar, atau buat dulu lewat menunya.`,
    },
  }
}

/**
 * Terjemahkan `targetId` update/delete dari NAMA menjadi id baris, lalu isi
 * field yang tidak disebut pengguna dengan nilai baris itu.
 *
 * Dua pekerjaan sekaligus karena keduanya jawaban atas keluhan yang sama:
 * asisten memperlakukan "ubah" seolah-olah "buat baru". Ia tidak tahu baris
 * mana yang dimaksud (targetId kosong → gagal di Postgres), dan ia menanyakan
 * ulang harga jual yang SUDAH tersimpan di produk itu. Form manual tidak pernah
 * begitu: menekan ikon pensil memuat data lama dulu, dan pengguna hanya
 * mengubah yang perlu. Aturan itu yang ditiru di sini.
 */
export async function resolveTarget(
  supabase: { from: (t: string) => any },
  draft: ValidatedDraft,
  ownerId?: string,
): Promise<ValidationIssue[]> {
  if (draft.operation === 'create') return []
  const spec = getEntitySpec(draft.entity)
  if (!spec?.targetLabelColumn) return []

  const kolom = spec.targetLabelColumn
  // Nama target boleh datang lewat `targetId` (model diminta menaruh nama di
  // sana) atau lewat field nama di values — mis. "ubah stok indomie goreng"
  // sering menaruh "indomie goreng" di `name`, bukan di targetId.
  const petunjuk = draft.targetId ?? draft.values[kolom] ?? draft.values.name
  const semu: FieldSpec = {
    name: 'targetId',
    label: spec.label,
    type: 'ref',
    required: true,
    ask: `${spec.label} mana yang dimaksud?`,
    refTable: spec.table,
    refLabelColumn: kolom,
  }

  const hasil = await resolveSatuRef(supabase, semu, petunjuk, ownerId)
  draft.issues = (draft.issues || []).filter((i) => i.field !== 'targetId')

  if (!hasil.id) {
    delete draft.targetId
    const issue = hasil.issue ?? {
      field: 'targetId',
      message: `Sebutkan ${spec.label.toLowerCase()} mana yang ingin diubah.`,
    }
    draft.issues.push(issue)
    if (!draft.missingRequired.some((q) => q.field === 'targetId')) {
      draft.missingRequired.push({
        field: 'targetId',
        label: spec.label,
        question: semu.ask,
        required: true,
        type: 'ref',
        ...(hasil.kandidat?.length ? { options: hasil.kandidat } : {}),
      })
    }
    return [issue]
  }

  draft.targetId = hasil.id
  draft.refLabels = { ...(draft.refLabels || {}), targetId: String(petunjuk ?? '') }

  // ---- Prefill: baris lama jadi nilai awal, bukan pertanyaan baru ----
  const kolomField = spec.fields.map((f) => f.name)
  const { data: lama } = await supabase
    .from(spec.table)
    .select(['id', ...kolomField].join(', '))
    .eq('id', hasil.id)
    .maybeSingle()

  if (lama) {
    for (const f of spec.fields) {
      const disebut = draft.values[f.name]
      if (disebut !== undefined && disebut !== null && disebut !== '') continue
      const nilaiLama = (lama as Record<string, unknown>)[f.name]
      if (nilaiLama === undefined || nilaiLama === null || nilaiLama === '') continue
      draft.values[f.name] = nilaiLama
      // Field yang sudah terisi dari baris lama tidak perlu ditanyakan lagi.
      draft.missingRequired = draft.missingRequired.filter((q) => q.field !== f.name)
      draft.optionalPrompts = draft.optionalPrompts.filter((q) => q.field !== f.name)
    }
    // Label ref ikut diperbarui supaya kartu menampilkan nama, bukan UUID.
    for (const f of spec.fields) {
      if (f.type !== 'ref' || !draft.values[f.name]) continue
      if (draft.refLabels?.[f.name]) continue
      const { data: ref } = await supabase
        .from(f.refTable!)
        .select(`id, ${f.refLabelColumn || 'name'}`)
        .eq('id', draft.values[f.name])
        .maybeSingle()
      if (ref) {
        draft.refLabels = {
          ...(draft.refLabels || {}),
          [f.name]: String((ref as any)[f.refLabelColumn || 'name']),
        }
      }
    }
  }

  return []
}

export async function resolveReferences(
  supabase: { from: (t: string) => any },
  draft: ValidatedDraft,
  /**
   * Pemilik workspace yang sedang aktif. Query DIIKAT ke sini, tidak cukup
   * bersandar pada RLS: staf yang aktif di dua usaha lolos RLS untuk KEDUANYA,
   * sehingga tanpa filter ini produk milik usaha yang sedang tidak dipilih bisa
   * dianggap sah. `loadContext` sudah mengikat dengan cara yang sama.
   */
  ownerId?: string,
): Promise<ValidationIssue[]> {
  const spec = getEntitySpec(draft.entity)
  if (!spec) return [{ field: 'entity', message: 'Entitas tidak dikenal.' }]

  const problems: ValidationIssue[] = []
  const scoped = (q: any) => (ownerId ? q.eq('user_id', ownerId) : q)

  // Resolusi dijalankan ulang setiap putaran, jadi keluhan dari putaran
  // sebelumnya harus dibuang — kalau tidak, nama produk yang sudah diperbaiki
  // tetap membawa pesan "belum ada di data Anda" selamanya.
  const namaRefField = new Set(spec.fields.filter((f) => f.type === 'ref').map((f) => f.name))
  draft.issues = (draft.issues || []).filter((i) => !namaRefField.has(i.field))

  for (const f of spec.fields) {
    if (f.type !== 'ref' || !f.refTable) continue
    const nilai = draft.values[f.name]
    if (!nilai) continue

    const hasil = await resolveSatuRef(supabase, f, nilai, ownerId)
    if (hasil.id) {
      draft.values[f.name] = hasil.id
      // Label disimpan terpisah supaya kartu ringkasan di klien menampilkan
      // "Nasi Goreng", bukan UUID yang tidak bisa diperiksa siapa pun.
      draft.refLabels = { ...(draft.refLabels || {}), [f.name]: String(nilai) }
      continue
    }

    problems.push(hasil.issue!)
    delete draft.values[f.name]

    // Dikembalikan ke antrean pertanyaan. Tanpa ini, field WAJIB yang gagal
    // diresolusi hilang dari daftar pertanyaan (daftar itu sudah disusun di
    // validateDraft, sebelum resolusi berjalan) sehingga draft dinyatakan siap
    // lalu gagal di database. Field opsional pun perlu ditanyakan lagi: pengguna
    // menyebut nama produk dengan sengaja, dan mengabaikannya diam-diam berarti
    // penjualannya tidak memotong stok tanpa ada yang tahu.
    const antre = f.required ? draft.missingRequired : draft.optionalPrompts
    if (!antre.some((q) => q.field === f.name)) {
      const q = toQuestion(f)
      if (hasil.kandidat?.length) q.options = hasil.kandidat
      // Pertanyaan ulang menyebut SEBABNYA; mengulang pertanyaan yang sama
      // persis membuat pengguna mengetik jawaban yang sama persis pula.
      q.question = `${hasil.issue!.message}`
      antre.unshift(q)
    }
  }

  draft.ok = draft.missingRequired.length === 0

  // Target update/delete juga harus ada. `targetId` selalu berupa UUID (model
  // hanya bisa menyebutkannya bila ia memang sudah melihat barisnya), jadi
  // pencarian berdasarkan nama tidak berlaku di sini.
  if (draft.operation !== 'create' && draft.targetId) {
    if (!adalahUuid(draft.targetId)) {
      problems.push({ field: 'targetId', message: `${spec.label} yang ingin diubah/dihapus tidak dikenali.` })
    } else {
      const { data, error } = await scoped(
        supabase.from(spec.table).select('id').eq('id', draft.targetId),
      ).maybeSingle()
      if (error || !data) {
        problems.push({ field: 'targetId', message: `${spec.label} yang ingin diubah/dihapus tidak ditemukan.` })
      }
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

// "tidak" SENGAJA tidak ada di daftar ini. Dulu ia termasuk, sehingga menjawab
// "tidak" pada "Sudah lunas atau belum dibayar?" dibaca sebagai perintah
// MELEWATI field itu — bukan sebagai jawaban — lalu diam-diam jatuh ke nilai
// bawaan 'lunas'. Piutang yang tercatat lunas adalah tagihan yang tidak akan
// pernah ditagih. Kata untuk melewati harus berarti melewati dan tidak lain.
const POLA_LEWATI = /^(lewati|skip|kosong|kosongkan|nanti saja|nanti|-)$/i

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

  // Keluhan lama tentang field ini dibuang sebelum jawaban baru dinilai.
  // Draft bolak-balik antara klien dan server tiap putaran, jadi tanpa ini
  // pengguna terus melihat "Nominal harus berupa angka" untuk nominal yang
  // baru saja ia perbaiki.
  draft.issues = (draft.issues || []).filter((i) => i.field !== field)

  const skipped = typeof answer === 'string' && POLA_LEWATI.test(answer.trim())

  let diterima = false
  if (skipped) {
    // Field WAJIB tidak bisa dilewati — itulah arti "wajib". Membiarkannya
    // membuat draft dinyatakan siap dengan lubang di dalamnya, lalu gagal di
    // database dengan pesan yang tidak menunjuk ke apa pun.
    if (f.required) {
      draft.issues.push({ field: f.name, message: `${f.label} wajib diisi dan tidak bisa dilewati.` })
    } else {
      if (f.fallback !== undefined && f.fallback !== 'today') draft.values[f.name] = f.fallback
      diterima = true
    }
  } else {
    const issues: ValidationIssue[] = []
    const parsed = coerceField(f, answer, issues)
    if (parsed !== undefined) {
      draft.values[f.name] = parsed
      diterima = true
    } else {
      draft.issues.push(...issues)
    }
  }

  // HANYA jawaban yang benar-benar diterima yang menutup pertanyaannya.
  //
  // Sebelumnya pertanyaan selalu dicoret, apa pun hasilnya. Akibatnya: jawaban
  // yang ditolak coerceField — "seratus ribu" pada kolom nominal, satuan yang
  // tidak ada di daftar, tanggal yang bukan YYYY-MM-DD — membuat field wajibnya
  // tetap KOSONG sekaligus tidak pernah ditanyakan lagi. Draft lalu dinyatakan
  // `ready`, dan yang tersimpan adalah transaksi Rp 0 atau kegagalan mentah
  // dari database. Kegagalan diam yang paling mahal: pengguna sudah menekan
  // Simpan dan mengira catatannya masuk.
  if (diterima) {
    draft.missingRequired = draft.missingRequired.filter((q) => q.field !== field)
    draft.optionalPrompts = draft.optionalPrompts.filter((q) => q.field !== field)
    draft.sudahDitanya = [...new Set([...(draft.sudahDitanya || []), field])]
  }

  // Jawaban barusan bisa MEMBUKA pertanyaan bersyarat ("belum lunas" -> jatuh
  // tempo) atau menutupnya kembali. Dihitung ulang di sini, bukan sekali di awal.
  segarkanPertanyaanOpsional(draft)

  draft.ok = draft.missingRequired.length === 0

  return draft
}
