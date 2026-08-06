import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// ============================================================
// Penjaga invarian isolasi workspace di sisi KLIEN — pasangan dari
// public.tenancy_lint() di sisi database.
//
// Perbaikan berupa filter di ~40 tempat hanya bertahan selama semua orang
// ingat menuliskannya. Test ini membuat aturannya diperiksa mesin: query baru
// yang lupa memfilter workspace akan menggagalkan CI, bukan menunggu sampai
// data dua usaha tercampur di produksi.
//
// Lihat ARSITEKTUR-ISOLASI-WORKSPACE.md bagian 4.
// ============================================================

const SRC = join(process.cwd(), 'src')
const API_FILE = join('src', 'lib', 'api.js')

// Tabel yang barisnya dimiliki SATU workspace (punya kolom user_id).
// Sinkron dengan daftar v_shared di public.tenancy_lint() — yang TIDAK ada di
// sini berarti tabel bersama (profiles, feedback, legal_docs, macro_*, dst).
const TENANT_TABLES = [
  'transactions', 'categories', 'channels', 'categorization_rules',
  'suppliers', 'products', 'purchase_orders', 'stock_opnames',
  'tasks', 'employees', 'attendance', 'attendance_rules',
  'kpi_criteria', 'kpi_scores', 'kpi_bonus_rules', 'payrolls',
  'reminders', 'units', 'product_categories', 'sales_targets',
  'ingredients', 'product_boms', 'ai_insights', 'user_baseline',
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      out.push(...walk(p))
    } else if (/\.(js|jsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

const files = walk(SRC).map((p) => ({
  path: relative(process.cwd(), p).split(sep).join(sep),
  code: readFileSync(p, 'utf8'),
}))

const tableRe = new RegExp(`\\.from\\(\\s*['"\`](${TENANT_TABLES.join('|')})['"\`]\\s*\\)`, 'g')

describe('invarian isolasi workspace (klien)', () => {
  it('tabel tenant hanya diakses dari src/lib/api.js', () => {
    const pelanggaran = []
    for (const f of files) {
      if (f.path === API_FILE) continue
      for (const m of f.code.matchAll(tableRe)) {
        const baris = f.code.slice(0, m.index).split('\n').length
        pelanggaran.push(`${f.path}:${baris} -> ${m[1]}`)
      }
    }
    // Query yang hidup di dalam komponen halaman pernah melewatkan filter
    // workspace (StokHistori memanggil purchase_orders & stock_opnames
    // langsung dan menampilkan data usaha lain).
    expect(pelanggaran, `Akses tabel tenant di luar api.js:\n${pelanggaran.join('\n')}`)
      .toEqual([])
  })

  // BACA / UBAH / HAPUS adalah operasi yang bisa membocorkan atau merusak data
  // workspace lain, dan itulah yang WAJIB lewat helper. INSERT/UPSERT tidak
  // dibatasi di sini karena `user_id` harus ditulis eksplisit di payload-nya,
  // dan salahnya tertangkap di lapis skema (NOT NULL + FK komposit).
  it('di api.js, baca/ubah/hapus tabel tenant tidak boleh memakai supabase.from langsung', () => {
    const api = files.find((f) => f.path === API_FILE)
    expect(api, 'src/lib/api.js tidak ditemukan').toBeTruthy()

    const lines = api.code.split('\n')
    const pelanggaran = []
    for (const m of api.code.matchAll(tableRe)) {
      const idx = api.code.slice(0, m.index).split('\n').length - 1
      // Rantai PostgREST kadang dipecah beberapa baris; lihat jendela pendek
      // setelah .from(...) untuk menemukan operasinya.
      const jendela = lines.slice(idx, idx + 4).join('\n')
      const isRead = /\.select\(/.test(jendela) && !/\.(insert|upsert)\(/.test(jendela)
      const isMutate = /\.(update|delete)\(/.test(jendela)
      if (isRead || isMutate) {
        pelanggaran.push(`${API_FILE}:${idx + 1} -> ${m[1]}`)
      }
    }
    expect(pelanggaran, `Baca/ubah/hapus tabel tenant tanpa helper ws*:\n${pelanggaran.join('\n')}`)
      .toEqual([])
  })

  it('helper ws* sinkron — tidak boleh async (builder PostgREST itu thenable)', () => {
    const api = files.find((f) => f.path === API_FILE)
    for (const nama of ['wsSelect', 'wsUpdate', 'wsDelete']) {
      expect(api.code, `${nama} harus sinkron`).not.toMatch(
        new RegExp(`async\\s+function\\s+${nama}\\b`),
      )
      expect(api.code, `${nama} harus ada`).toMatch(
        new RegExp(`function\\s+${nama}\\s*\\(\\s*owner`),
      )
    }
  })

  // Baseline menyimpan tebakan margin pemilik usaha — angka yang tidak boleh
  // terbaca usaha lain. Isolasi nyatanya sudah diuji langsung di database
  // (pengguna asing 0 baris, pemilik hanya barisnya sendiri); test di sini
  // menjaga agar kontraknya tidak hilang dari berkas migrasi di kemudian hari.
  describe('user_baseline (task C2)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migration_baseline.sql'), 'utf8')

    it('terdaftar sebagai tabel tenant sehingga ikut dijaga guard di atas', () => {
      expect(TENANT_TABLES).toContain('user_baseline')
    })

    it('user_id wajib diisi dan ikut terhapus bersama akunnya', () => {
      expect(sql).toMatch(/user_id\s+uuid\s+not null\s+references\s+auth\.users\(id\)\s+on delete cascade/)
    })

    it('RLS dinyalakan', () => {
      expect(sql).toMatch(/alter table public\.user_baseline enable row level security/)
    })

    it('punya kebijakan pemilik yang mengikat auth.uid() di baca maupun tulis', () => {
      expect(sql).toMatch(/create policy "own user_baseline"[\s\S]*?using \(auth\.uid\(\) = user_id\)[\s\S]*?with check \(auth\.uid\(\) = user_id\)/)
    })

    it('akses staf dibatasi modul analisis, bukan dibuka untuk semua', () => {
      expect(sql).toMatch(/create policy "staff_analisis"[\s\S]*?has_access\(user_id, 'analisis'\)/)
    })

    it('satu baseline per pengguna — tebakan awal hanya bermakna sekali', () => {
      expect(sql).toMatch(/create unique index[\s\S]*?on public\.user_baseline \(user_id\)/)
    })

    it('migrasi gagal sendiri bila RLS tidak menyala', () => {
      expect(sql).toMatch(/raise exception 'RLS tidak aktif pada public\.user_baseline'/)
    })
  })

  it('resolusi pemilik tidak memakai fallback diam-diam', () => {
    const api = files.find((f) => f.path === API_FILE)
    // Komentar dibuang dulu: berkas ini SENGAJA mengutip pola lama untuk
    // menjelaskan kenapa diganti, dan kutipan itu bukan pelanggaran.
    const kode = api.code
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    // Pola lama: `data?.[0]?.owner_id || user.id` — saat verifikasi gagal,
    // pemilik efektif pindah tanpa peringatan dan tulisan mendarat di
    // workspace yang salah.
    expect(kode).not.toMatch(/owner_id\s*\|\|\s*user\.id/)
    expect(kode).not.toMatch(/catch\s*\{\s*_ownerCache\s*=\s*user\.id/)
  })
})
