// ============================================================
// Bantuan test — klien Supabase palsu + scope palsu.
//
// Bukan berkas *_test.ts, jadi tidak ikut dijalankan sebagai suite; ia dipakai
// bersama oleh retrievers_test.ts dan context-builder_test.ts.
//
// Yang penting dari klien palsu ini bukan kemampuannya mengembalikan data,
// melainkan JEJAK-nya: ia mencatat setiap query yang benar-benar dieksekusi.
// Assertion terkuat di lapisan RAG berbunyi "tabel itu tidak pernah disentuh",
// bukan "hasilnya kosong" — yang bisa lulus karena sebab yang salah.
// ============================================================

import type { WorkspaceScope } from '../workspace-scope.ts'
import { ALL_MODULES } from '../workspace-scope.ts'

export interface Jejak {
  tabel: string
  kolom?: string
  filter: Record<string, unknown>
  limit?: number
}

export function fakeSupabase(isi: Record<string, any[]>, gagal: string[] = []) {
  const jejak: Jejak[] = []

  const buatQuery = (tabel: string) => {
    const q: any = { filter: {} as Record<string, unknown> }

    const selesai = () => {
      jejak.push({ tabel, kolom: q.kolom, filter: q.filter, limit: q.batas })
      if (gagal.includes(tabel)) return { data: null, error: { message: 'gagal' }, count: null }
      let baris = isi[tabel] ?? []
      for (const [k, v] of Object.entries(q.filter)) baris = baris.filter((r: any) => r[k] === v)
      if (q.inKunci) baris = baris.filter((r: any) => q.inNilai.includes(r[q.inKunci]))
      const total = baris.length
      return {
        data: typeof q.batas === 'number' ? baris.slice(0, q.batas) : baris,
        error: null,
        count: q.hitung ? total : null,
      }
    }

    q.select = (kolom: string, opsi?: any) => {
      q.kolom = kolom
      q.hitung = opsi?.count === 'exact'
      return q
    }
    q.eq = (k: string, v: unknown) => { q.filter[k] = v; return q }
    q.in = (k: string, v: unknown[]) => { q.inKunci = k; q.inNilai = v; return q }
    q.order = () => q
    q.limit = (n: number) => { q.batas = n; return selesai() }
    // Thenable supaya query tanpa .limit() (mis. pencarian nama lewat .in())
    // tetap bisa di-await, sama seperti klien Supabase sungguhan.
    q.then = (lanjut: (v: unknown) => unknown) => lanjut(selesai())
    return q
  }

  return { jejak, from: (tabel: string) => buatQuery(tabel) }
}

export const owner = (): WorkspaceScope => ({
  owner: 'u-owner', modules: [...ALL_MODULES], isOwner: true, can: () => true,
})

export const staf = (...modules: string[]): WorkspaceScope => ({
  owner: 'u-owner',
  modules: modules as any,
  isOwner: false,
  can: (m: any) => modules.includes(m),
})

/** Data contoh yang meniru workspace di laporan pengguna. */
export const ISI = () => ({
  products: [
    { user_id: 'u-owner', name: 'indomie goreng', sku: 'MAK-A4609F', category: 'Makanan', unit: 'pcs', stock: 62, min_stock: 10, price: 4000, cost_price: 3000 },
    { user_id: 'u-owner', name: 'Puding', sku: 'ROK-1', category: 'Rokok', unit: 'pack', stock: 201, min_stock: 20, price: 30000, cost_price: 21000 },
    { user_id: 'u-owner', name: 'tepung terigu', sku: 'MAK-2', category: 'Makanan', unit: 'dus', stock: 42, min_stock: 5, price: 12000, cost_price: 9000 },
  ],
  suppliers: [{ id: 's1', user_id: 'u-owner', name: 'Toko Bahan Jaya' }],
  purchase_orders: [] as any[],
  stock_opnames: [] as any[],
  ingredients: [] as any[],
  employees: [
    { id: 'e1', user_id: 'u-owner', name: 'Budi', role: 'Kasir', salary_type: 'bulanan', salary_amount: 2500000, join_date: '2025-01-05', status: 'aktif' },
  ],
  attendance: [{ user_id: 'u-owner', date: '2026-08-14', status: 'hadir', employee_id: 'e1' }],
  payrolls: [] as any[],
  kpi_scores: [] as any[],
  tasks: [{ user_id: 'u-owner', title: 'Restock indomie', status: 'antre', priority: 'tinggi', due_date: '2026-08-15', assignee_id: 'e1' }],
  reminders: [] as any[],
  transactions: [
    { user_id: 'u-owner', occurred_at: '2026-08-14', direction: 'in', amount: 45000, category: 'Penjualan', description: 'jual 3 kue', channel: 'manual', payment_status: 'belum', due_date: '2026-08-20', customer_name: 'Ibu Siti' },
  ] as any[],
  sales_targets: [] as any[],
  staff_members: [{ owner_id: 'u-owner', user_id: 'u-owner', name: 'Andi', modules: ['produk'], status: 'active' }],
  audit_logs: [] as any[],
  profiles: [] as any[],
  categories: [] as any[],
  channels: [] as any[],
  commodity_prices: [] as any[],
  macro_signals: [] as any[],
  exchange_rates: [] as any[],
})
