// ============================================================
// Uji lapisan AI: blocklist guard, validasi checksum OCR, dan rate limiter.
// Modul yang diuji hidup di supabase/functions/_shared/ai/ (dipakai Edge
// Function), tetapi logikanya murni sehingga bisa diuji di sini.
// ============================================================
import { describe, it, expect, vi } from 'vitest'

import {
  checkActionAllowed,
  isTableBlocked,
} from '../../../supabase/functions/_shared/ai/guards/action-blocklist.ts'

import {
  isChecksumValid,
  sumItems,
  parseAndValidateReceipt,
  ChecksumMismatchError,
} from '../../../supabase/functions/_shared/ai/tools/ocr-parser.ts'

import {
  buildCrudTools,
  validateDraft,
  computeClarifications,
  applyAnswer,
} from '../../../supabase/functions/_shared/ai/tools/crud-tools.ts'

import {
  checkQuota,
  commitQuota,
  dailyLimitPayload,
} from '../../../supabase/functions/_shared/ai/rate-limiter.ts'

// ============================================================
// 1. BLOCKLIST GUARD
// ============================================================
describe('action-blocklist', () => {
  it('menolak semua endpoint sensitif meski dicoba lewat AI', () => {
    const attempts = [
      'update_password',
      'reset_password',
      'delete_account',
      'create_session_token',
      'update_2fa',
      'read_otp',
      'update_pin',
      'update_settings',
      'settings_billing',
      'create_api_key',
      'update_role',
      'create_webhook',
      'logout_user',
    ]
    for (const name of attempts) {
      expect(checkActionAllowed(name).blocked, `harusnya diblokir: ${name}`).toBe(true)
    }
  })

  it('menolak lewat argumen yang menunjuk tabel terlarang', () => {
    expect(checkActionAllowed('create_transaksi', { table: 'auth.users' }).blocked).toBe(true)
    expect(checkActionAllowed('create_transaksi', { endpoint: '/settings/billing' }).blocked).toBe(true)
    expect(checkActionAllowed('create_transaksi', { target: 'staff_members' }).blocked).toBe(true)
  })

  it('mengizinkan aksi bisnis yang sah', () => {
    expect(checkActionAllowed('create_transaksi', { amount: 50000 }).blocked).toBe(false)
    expect(checkActionAllowed('update_produk', { name: 'Kopi' }).blocked).toBe(false)
    expect(checkActionAllowed('create_karyawan', { name: 'Andi' }).blocked).toBe(false)
  })

  it('isTableBlocked menandai tabel sensitif', () => {
    expect(isTableBlocked('auth.users')).toBe(true)
    expect(isTableBlocked('api_keys')).toBe(true)
    expect(isTableBlocked('staff_members')).toBe(true)
    expect(isTableBlocked('transactions')).toBe(false)
    expect(isTableBlocked('products')).toBe(false)
  })

  it('tool CRUD tidak pernah mengekspos entitas sensitif', () => {
    const tools = buildCrudTools()
    const names = tools[0].functionDeclarations.map((d) => d.name)
    for (const n of names) {
      expect(checkActionAllowed(n).blocked, `tool ${n} tidak boleh lolos blocklist`).toBe(false)
    }
    // Tidak ada tool untuk hal sensitif sama sekali.
    expect(names.some((n) => /password|pin|2fa|otp|settings|billing|role/i.test(n))).toBe(false)
  })
})

// ============================================================
// 2. VALIDASI CHECKSUM OCR
// ============================================================
describe('ocr checksum', () => {
  it('menerima selisih dalam toleransi 2%', () => {
    expect(isChecksumValid(100000, 100000)).toBe(true)
    expect(isChecksumValid(99000, 100000)).toBe(true)   // selisih 1%
    expect(isChecksumValid(101500, 100000)).toBe(true)  // selisih 1.5%
  })

  it('menolak selisih di luar toleransi', () => {
    expect(isChecksumValid(90000, 100000)).toBe(false)  // selisih 10%
    expect(isChecksumValid(150000, 100000)).toBe(false)
    expect(isChecksumValid(0, 100000)).toBe(false)      // ada total tapi item kosong
  })

  it('melewati validasi bila total struk tidak terbaca', () => {
    expect(isChecksumValid(50000, 0)).toBe(true)
  })

  it('sumItems menjumlahkan total baris', () => {
    expect(sumItems([{ total: 1000 }, { total: 2500 }])).toBe(3500)
    expect(sumItems([])).toBe(0)
  })

  it('parseAndValidateReceipt melempar ChecksumMismatchError saat tidak cocok', () => {
    const bad = JSON.stringify({
      merchant: 'Toko A', total: 100000,
      items: [{ name: 'Beras', qty: 1, unit: 'kg', unit_price: 10000, total: 10000 }],
    })
    expect(() => parseAndValidateReceipt(bad)).toThrow(ChecksumMismatchError)
  })

  it('parseAndValidateReceipt sukses saat cocok', () => {
    const good = JSON.stringify({
      merchant: 'Toko B', date: '2026-07-30', total: 30000, legibility: 'cetak_jelas',
      items: [
        { name: 'Beras', qty: 1, unit: 'kg', unit_price: 20000, total: 20000 },
        { name: 'Gula', qty: 1, unit: 'kg', unit_price: 10000, total: 10000 },
      ],
    })
    const r = parseAndValidateReceipt(good)
    expect(r.total).toBe(30000)
    expect(r.items).toHaveLength(2)
    expect(r.date).toBe('2026-07-30')
  })
})

// ============================================================
// 3. RATE LIMITER
// ============================================================
function fakeSupabase(rpcImpl) {
  return { rpc: vi.fn(rpcImpl) }
}

describe('rate limiter per workspace', () => {
  it('mengizinkan saat pemakaian masih di bawah cap', async () => {
    const sb = fakeSupabase(async () => ({
      data: [{ allowed: true, used: 3, cap: 10, reset_at: '2026-07-31T07:00:00Z' }],
      error: null,
    }))
    const s = await checkQuota(sb, 'chat', 10)
    expect(s.allowed).toBe(true)
    expect(s.used).toBe(3)
  })

  it('menolak saat cap tercapai', async () => {
    const sb = fakeSupabase(async () => ({
      data: [{ allowed: false, used: 10, cap: 10, reset_at: '2026-07-31T07:00:00Z' }],
      error: null,
    }))
    const s = await checkQuota(sb, 'chat', 10)
    expect(s.allowed).toBe(false)

    const payload = dailyLimitPayload('chat', s)
    expect(payload.code).toBe('DAILY_LIMIT_REACHED')
    expect(payload.feature).toBe('chat')
    expect(payload.resetAt).toBeTruthy()
  })

  it('gagal-aman (menolak) bila kuota tidak terbaca', async () => {
    const sb = fakeSupabase(async () => ({ data: null, error: { message: 'boom' } }))
    const s = await checkQuota(sb, 'crud', 10)
    expect(s.allowed).toBe(false)
  })

  it('commit voice memakai satuan detik', async () => {
    const sb = fakeSupabase(async () => ({ data: 125, error: null }))
    await commitQuota(sb, 'voice', 125)
    expect(sb.rpc).toHaveBeenCalledWith('ai_quota_commit', expect.objectContaining({
      p_feature: 'voice', p_units: 125,
    }))
  })

  it('commit fitur biasa menambah 1', async () => {
    const sb = fakeSupabase(async () => ({ data: 1, error: null }))
    await commitQuota(sb, 'ocr')
    expect(sb.rpc).toHaveBeenCalledWith('ai_quota_commit', expect.objectContaining({
      p_feature: 'ocr', p_units: 1,
    }))
  })

  it('commit meneruskan token ke RPC (basis biaya, bukan sekadar jumlah panggilan)', async () => {
    const sb = fakeSupabase(async () => ({ data: 1, error: null }))
    await commitQuota(sb, 'ocr', 1, {
      model: 'gemini-3.1-flash-lite',
      promptTokens: 1200, completionTokens: 340, totalTokens: 1540, wastedTokens: 880,
    })
    expect(sb.rpc).toHaveBeenCalledWith('ai_quota_commit', expect.objectContaining({
      p_prompt_tokens: 1200,
      p_completion_tokens: 340,
      p_total_tokens: 1540,
      p_wasted_tokens: 880,
      p_model: 'gemini-3.1-flash-lite',
    }))
  })

  it('commit units=0 mencatat token tanpa menaikkan kuota', async () => {
    const sb = fakeSupabase(async () => ({ data: 0, error: null }))
    await commitQuota(sb, 'insight_dashboard', 0, { totalTokens: 700, wastedTokens: 700 })
    expect(sb.rpc).toHaveBeenCalledWith('ai_quota_commit', expect.objectContaining({
      p_units: 0, p_wasted_tokens: 700,
    }))
  })

  it('pesan batas voice ditampilkan dalam menit', async () => {
    const s = { allowed: false, used: 600, cap: 600, resetAt: null }
    expect(dailyLimitPayload('voice', s).error).toContain('10 menit/hari')
  })
})

// ============================================================
// 4. SLOT-FILLING CRUD (regulasi input per fitur)
// ============================================================
describe('crud slot-filling', () => {
  it('menanyakan field wajib yang kosong, tidak menebaknya', () => {
    const d = validateDraft('create_transaksi', { direction: 'in' })
    expect(d.ok).toBe(false)
    const missing = d.missingRequired.map((q) => q.field)
    expect(missing).toContain('amount')
    expect(missing).toContain('description')
    expect(missing).toContain('category')
  })

  // Kebijakan ini BERUBAH. Sebelumnya setiap field opsional yang kosong
  // ditanyakan satu per satu "agar data selengkap input manual" — dan kalimat
  // sesederhana "jual kopi 50rb" berubah menjadi delapan giliran percakapan
  // sebelum satu baris pun tersimpan. Pengguna berhenti di tengah, sehingga
  // yang tersimpan justru NIHIL: hasil yang lebih buruk daripada catatan yang
  // beberapa kolomnya kosong. Kelengkapan tetap dijamin kartu ringkasan, yang
  // menampilkan seluruh field dan bisa disunting sebelum Simpan.
  it('hanya menanyakan field opsional yang salahnya merusak angka', () => {
    const d = validateDraft('create_transaksi', {
      direction: 'in', amount: 50000, description: 'Jual kopi', category: 'Penjualan',
    })
    const optional = d.optionalPrompts.map((q) => q.field)

    // Ditanyakan: penjualan kredit yang tercatat lunas adalah tagihan yang
    // tidak akan pernah ditagih.
    expect(optional).toContain('payment_status')
    // Tidak ditanyakan: punya nilai bawaan yang masuk akal, dan tetap bisa
    // disunting di kartu ringkasan.
    expect(optional).not.toContain('channel')
    expect(optional).not.toContain('product_id')
    expect(optional).not.toContain('customer_name')
    expect(optional).toHaveLength(1)
  })

  it('field opsional yang tidak ditanyakan tetap diisi nilai bawaannya', () => {
    const d = validateDraft('create_transaksi', {
      direction: 'in', amount: 50000, description: 'Jual kopi', category: 'Penjualan',
    })
    // Kartu ringkasan harus memperlihatkan apa yang benar-benar akan tersimpan.
    expect(d.values.channel).toBe('manual')
  })

  it('menolak field asing tanpa meneruskannya ke database', () => {
    const d = validateDraft('create_produk', { name: 'Kopi', is_admin: true, price: 1000, unit: 'pcs', stock: 5 })
    expect(d.values.is_admin).toBeUndefined()
    expect(d.issues.some((i) => i.field === 'is_admin')).toBe(true)
  })

  it('menandai aksi finansial & destruktif butuh konfirmasi manual', () => {
    const create = validateDraft('create_transaksi', {
      direction: 'out', amount: 90000, description: 'Beli gula', category: 'Bahan',
    })
    expect(create.requiresConfirmation).toBe(true)

    const del = validateDraft('delete_produk', { targetId: 'abc' })
    expect(del.requiresConfirmation).toBe(true)
  })

  it('membuat produk baru (non-finansial ringan) tetap butuh nama & harga', () => {
    const d = validateDraft('create_produk', { name: 'Teh Botol' })
    const missing = d.missingRequired.map((q) => q.field)
    expect(missing).toContain('price')
    expect(missing).toContain('stock')
    expect(missing).toContain('unit')
  })

  it('applyAnswer mengisi jawaban dan menghapus pertanyaan', () => {
    let d = validateDraft('create_transaksi', { direction: 'in' })
    d = applyAnswer(d, 'amount', '45rb')
    expect(d.values.amount).toBe(45)  // "45rb" -> angka mentah; normalisasi ribuan dilakukan model
    d = applyAnswer(d, 'amount', 45000)
    expect(d.values.amount).toBe(45000)
    expect(d.missingRequired.some((q) => q.field === 'amount')).toBe(false)
  })

  it('applyAnswer menghormati kata "lewati" untuk field opsional', () => {
    let d = validateDraft('create_transaksi', {
      direction: 'in', amount: 10000, description: 'x', category: 'Penjualan',
    })
    d = applyAnswer(d, 'channel', 'lewati')
    expect(d.values.channel).toBe('manual') // memakai fallback
  })

  it('computeClarifications mengajukan yang wajib lebih dulu', () => {
    const d = validateDraft('create_karyawan', { name: 'Andi' })
    const plan = computeClarifications(d)
    expect(plan.needsClarification).toBe(true)
    expect(plan.next.required).toBe(true)
    expect(['salary_type', 'salary_amount']).toContain(plan.next.field)
    expect(plan.spokenPrompt.length).toBeGreaterThan(0)
  })

  it('menolak operasi yang tidak diizinkan untuk entitas', () => {
    const r = validateDraft('delete_absensi', { targetId: 'x' })
    expect(r.blocked).toBe(true)
  })

  it('menolak entitas yang tidak terdaftar', () => {
    const r = validateDraft('create_users', { email: 'x@y.z' })
    expect(r.blocked).toBe(true)
  })
})
