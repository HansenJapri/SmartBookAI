// ============================================================
// deno test — kartu tarif kredit (Fase 1) diperiksa terhadap FEATURE_ROUTES.
//
// Tarif kredit sengaja hidup di TABEL, bukan di kode, supaya harga bisa
// dikalibrasi tanpa deploy ulang. Harganya: tidak ada compiler yang menjaga
// keduanya tetap sejalan. Fitur AI baru yang ditambahkan ke config.ts tanpa
// baris tarif akan berjalan normal, terasa normal, dan diam-diam GRATIS —
// tidak ada error, tidak ada gejala, hanya biaya yang tidak pernah muncul di
// laporan mana pun. Berkas ini yang menutup celah itu.
//
// Membaca berkas SQL apa adanya. Tidak butuh database, tidak butuh jaringan.
// ============================================================
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { dirname, fromFileUrl, join } from 'https://deno.land/std@0.224.0/path/mod.ts'
import { FEATURE_ROUTES } from './config.ts'

const SUPABASE_DIR = dirname(dirname(dirname(dirname(fromFileUrl(import.meta.url)))))
const MIGRASI = join(SUPABASE_DIR, 'migration_ai_credits.sql')

const sql = await Deno.readTextFile(MIGRASI)

/** Potong hanya blok INSERT ke ai_credit_rates — jangan ikut menangkap SQL lain. */
function blokSeed(): string {
  const mulai = sql.indexOf('insert into public.ai_credit_rates')
  assert(mulai >= 0, 'Blok seed ai_credit_rates tidak ditemukan di migrasi.')
  const akhir = sql.indexOf('on conflict', mulai)
  assert(akhir > mulai, 'Blok seed tidak diakhiri "on conflict" — idempotensi hilang.')
  return sql.slice(mulai, akhir)
}

interface Tarif {
  feature: string
  cost: number
  sejak: string
}

function tarifTerseed(): Tarif[] {
  const out: Tarif[] = []
  const re = /\(\s*'([a-z_]+)'\s*,\s*([\d.]+)\s*,\s*date\s*'(\d{4}-\d{2}-\d{2})'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(blokSeed())) !== null) {
    out.push({ feature: m[1], cost: Number(m[2]), sejak: m[3] })
  }
  return out
}

const TARIF = tarifTerseed()

/** Semua quotaFeature yang dipakai rute mana pun. */
const FITUR_KUOTA = [...new Set(Object.values(FEATURE_ROUTES).map((r) => r.quotaFeature))].sort()

Deno.test('seed tarif terbaca (penjaga ini tidak boleh lulus dengan tangan kosong)', () => {
  // Regex yang tidak cocok akan menghasilkan array kosong, dan array kosong
  // membuat SEMUA assertion di bawah lulus tanpa memeriksa apa pun. Pelajaran
  // yang sama sudah pernah mahal di suite ini: penjaga a11y yang berjalan
  // sebelum data termuat selalu hijau karena halamannya kosong.
  assert(TARIF.length >= 8, `Hanya ${TARIF.length} tarif terbaca — regex atau format seed berubah.`)
})

Deno.test('setiap quotaFeature punya tarif kredit', () => {
  const berTarif = new Set(TARIF.map((t) => t.feature))
  const tanpaTarif = FITUR_KUOTA.filter((f) => !berTarif.has(f))
  assertEquals(
    tanpaTarif,
    [],
    `Fitur tanpa tarif kredit: ${tanpaTarif.join(', ')}. `
    + 'Fitur ini akan berjalan GRATIS tanpa gejala apa pun — tambahkan barisnya '
    + 'ke seed ai_credit_rates di supabase/migration_ai_credits.sql.',
  )
})

Deno.test('tidak ada tarif untuk fitur yang tidak dikenal', () => {
  // Menangkap salah ketik ("voice_live" alih-alih "voice"): tarifnya ada di
  // tabel, terlihat benar saat dibaca manusia, tapi tidak pernah cocok dengan
  // fitur mana pun sehingga kreditnya tetap 0.
  const dikenal = new Set<string>(FITUR_KUOTA)
  const asing = TARIF.map((t) => t.feature).filter((f) => !dikenal.has(f))
  assertEquals(asing, [], `Tarif untuk fitur yang tidak ada di FEATURE_ROUTES: ${asing.join(', ')}`)
})

Deno.test('tidak ada tarif ganda untuk fitur yang sama pada tanggal yang sama', () => {
  const kunci = TARIF.map((t) => `${t.feature}@${t.sejak}`)
  const ganda = kunci.filter((k, i) => kunci.indexOf(k) !== i)
  assertEquals(ganda, [], `Baris seed bertabrakan (akan tertelan "on conflict do nothing"): ${ganda.join(', ')}`)
})

Deno.test('tidak ada tarif nol — gratis harus keputusan, bukan kelalaian', () => {
  const nol = TARIF.filter((t) => t.cost <= 0).map((t) => t.feature)
  assertEquals(nol, [], `Tarif 0 kredit: ${nol.join(', ')}. Kalau memang disengaja, tulis alasannya di kolom note.`)
})

Deno.test('seed memakai tanggal TETAP, bukan current_date', () => {
  // current_date membuat migrasi yang dijalankan ulang di hari berbeda
  // menyisipkan baris tarif BARU yang menang atas kalibrasi admin —
  // perubahan harga yang tidak pernah diminta siapa pun.
  assert(
    !/current_date/i.test(blokSeed()),
    'Seed tarif memakai current_date: menjalankan ulang migrasi akan membatalkan kalibrasi tarif admin.',
  )
})

Deno.test('voice ditarifkan per menit, dan itu dinyatakan di catatannya', () => {
  const v = TARIF.find((t) => t.feature === 'voice')
  assert(v, 'Tarif voice tidak ada.')
  // Satu-satunya fitur yang satuan tarifnya BUKAN "per panggilan". Salah baca
  // di sini menagih pengguna 60× lipat, dan angkanya sendiri tidak terlihat
  // aneh — 5 memang wajar untuk keduanya.
  assert(
    /per menit/i.test(blokSeed().split('\n').find((b) => b.includes("'voice'")) ?? ''),
    'Baris tarif voice tidak menyatakan satuannya per MENIT — satuannya harus eksplisit di seed.',
  )
})

Deno.test('rumus kredit voice memakai pembagian 60, bukan pembulatan ke atas', () => {
  // Voice commit terjadi sekali per SESI, dan satu workspace bisa membuka
  // banyak sesi pendek dalam sehari. Pembulatan ke atas per commit menagih
  // empat sesi 30 detik sebagai 4 × 5 = 20 kredit untuk pemakaian 2 menit.
  assert(
    /units\s*\/\s*60\.0/.test(sql),
    'Rumus kredit voice tidak memakai akrual pecahan (units / 60.0).',
  )
  assert(
    !/ceil\s*\(\s*units/i.test(sql),
    'Rumus kredit voice memakai pembulatan ke atas — menagih berlebih untuk sesi pendek.',
  )
})

Deno.test('backfill menandai dirinya sebagai estimasi', () => {
  // Kredit hasil backfill diturunkan dari tarif hari ini, bukan diukur saat
  // pemakaian terjadi. Tanpa penanda, angka terkaan tidak bisa dibedakan dari
  // angka pengukuran — dan yang pertama tidak boleh dipakai menagih.
  assert(
    /credits_estimated\s*=\s*true/.test(sql),
    'Backfill tidak menandai baris sebagai credits_estimated.',
  )
  // Alias tabel (`u.`) opsional di kedua sisi — SQL-nya boleh ditulis dengan
  // atau tanpa prefiks, yang dijaga di sini adalah SYARATNYA, bukan gayanya.
  assert(
    /where[\s\S]{0,200}(\w+\.)?credits_used\s*=\s*0[\s\S]{0,120}not\s+(\w+\.)?credits_estimated/i.test(sql),
    'Backfill tidak idempoten: menjalankan ulang bisa menggandakan kredit.',
  )
})
