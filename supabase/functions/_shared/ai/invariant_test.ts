// ============================================================
// deno test — INVARIAN G-18, dijalankan atas seluruh supabase/functions/*/index.ts
//
// Skenario BDD "Tidak ada endpoint AI yang lolos dari penghitung kuota"
// (§4 dokumen strategi) sebelumnya hanya prosa. Berkas ini menjadikannya test.
//
// Temuan T-1 lolos berbulan-bulan justru karena tidak ada yang memeriksa hal
// sesederhana ini: dua Edge Function memanggil Gemini langsung dengan key &
// model hardcoded, memakai penghitung kuota sendiri (bump_ai_usage) yang
// per-USER dan menaikkan hitungan SEBELUM Gemini dipanggil. Setelah migrasi,
// test ini yang menjaga agar pola itu tidak kembali.
//
// Tidak memanggil AI, tidak butuh jaringan — hanya membaca berkas.
// ============================================================
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { dirname, fromFileUrl, join } from 'https://deno.land/std@0.224.0/path/mod.ts'
import { FEATURE_ROUTES } from './config.ts'

const FUNCTIONS_DIR = dirname(dirname(dirname(fromFileUrl(import.meta.url))))

/**
 * Buang komentar sebelum diperiksa. Invarian ini menilai KODE, bukan prosa —
 * tanpa ini, komentar yang menjelaskan "tidak lagi memakai bump_ai_usage"
 * justru dihitung sebagai pelanggaran.
 */
function tanpaKomentar(isi: string): string {
  return isi
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // blok /* ... */
    .replace(/(^|[^:])\/\/.*$/gm, '$1')  // baris // ... (":" dijaga agar URL utuh)
}

/** Semua folder Edge Function yang punya index.ts (abaikan _shared). */
async function edgeFunctions(): Promise<Array<{ nama: string; isi: string }>> {
  const out: Array<{ nama: string; isi: string }> = []
  for await (const entry of Deno.readDir(FUNCTIONS_DIR)) {
    if (!entry.isDirectory || entry.name.startsWith('_')) continue
    const berkas = join(FUNCTIONS_DIR, entry.name, 'index.ts')
    try {
      out.push({ nama: entry.name, isi: tanpaKomentar(await Deno.readTextFile(berkas)) })
    } catch {
      // Folder tanpa index.ts bukan Edge Function.
    }
  }
  return out.sort((a, b) => a.nama.localeCompare(b.nama))
}

/**
 * Utang teknis yang SUDAH DIKETAHUI dan belum disetujui untuk dimigrasi.
 * Bukan izin permanen: daftar ini ada supaya pelanggar BARU tetap membuat test
 * merah, sementara yang lama tidak menyembunyikan diri di balik suite hijau.
 * Kosongkan baris di sini setiap kali satu fungsi selesai dimigrasi.
 */
const PENGECUALIAN_TERCATAT: Record<string, string> = {
  'ai-admin': 'Panel admin internal, bukan jalur pengguna. Belum disetujui untuk dimigrasi.',
  'makro-harian': 'Job terjadwal (cron), bukan dipicu pengguna — kuota per-workspace tidak berlaku langsung. Perlu keputusan cap sendiri.',
  'voice-live-token': 'Menanyakan model yang mendukung bidiGenerateContent ke API sebelum menerbitkan token; bukan generateContent biasa. Perlu penanganan khusus.',
}

const FUNGSI = await edgeFunctions()

/** Memanggil Gemini langsung lewat HTTP, bukan lewat klien bersama. */
const memanggilGeminiLangsung = (isi: string) =>
  isi.includes('generativelanguage.googleapis.com')

Deno.test('prasyarat: ada Edge Function yang terbaca', () => {
  assert(FUNGSI.length > 0, `tidak ada index.ts terbaca di ${FUNCTIONS_DIR}`)
})

// ---------- Invarian 1: key tidak boleh dibaca di luar config.ts ----------

const membacaKeyLangsung = (isi: string) =>
  /Deno\.env\.get\(\s*['"`]GEMINI_(API_)?KEY/.test(isi)

Deno.test("tidak ada Deno.env.get('GEMINI_API_KEY') di luar _shared/ai/config.ts", () => {
  const pelanggar = FUNGSI
    .filter((f) => membacaKeyLangsung(f.isi) && !PENGECUALIAN_TERCATAT[f.nama])
    .map((f) => f.nama)
  assertEquals(pelanggar, [], `Key AI hanya boleh di-resolve lewat resolveKey() di config.ts. Pelanggar: ${pelanggar.join(', ')}`)
})

Deno.test('utang key langsung persis sebatas yang sudah tercatat', () => {
  // Mengunci CAKUPAN utang, bukan menyembunyikannya: kalau ada fungsi baru yang
  // membaca key sendiri, daftar ini tidak lagi cocok dan test merah.
  const pembacaKey = FUNGSI.filter((f) => membacaKeyLangsung(f.isi)).map((f) => f.nama)
  assertEquals(pembacaKey, ['ai-admin', 'makro-harian'])
})

// ---------- Invarian 2: yang memanggil Gemini WAJIB lewat router + kuota ----------

for (const f of FUNGSI) {
  if (!memanggilGeminiLangsung(f.isi)) continue
  if (PENGECUALIAN_TERCATAT[f.nama]) continue

  Deno.test(`${f.nama}: memanggil Gemini langsung → wajib lewat getGeminiClient()`, () => {
    assert(
      f.isi.includes('getGeminiClient('),
      `${f.nama} menyentuh generativelanguage.googleapis.com tanpa getGeminiClient().`,
    )
  })

  Deno.test(`${f.nama}: memanggil Gemini langsung → wajib checkQuota() sebelum`, () => {
    assert(
      f.isi.includes('checkQuota('),
      `${f.nama} memanggil Gemini tanpa checkQuota() — biaya tidak terbatasi.`,
    )
  })
}

Deno.test('daftar pengecualian tidak memuat fungsi yang sudah bersih', () => {
  // Menjaga daftar utang tetap jujur: begitu sebuah fungsi selesai dimigrasi,
  // barisnya WAJIB dihapus, bukan ditinggal menumpuk.
  const sudahBersih = Object.keys(PENGECUALIAN_TERCATAT).filter((nama) => {
    const f = FUNGSI.find((x) => x.nama === nama)
    return f && f.isi.includes('getGeminiClient(') && f.isi.includes('checkQuota(')
  })
  assertEquals(sudahBersih, [], `Sudah patuh, hapus dari PENGECUALIAN_TERCATAT: ${sudahBersih.join(', ')}`)
})

// ---------- Invarian 3: penghitung kuota lama tidak boleh dipakai lagi ----------

Deno.test('tidak ada Edge Function yang masih memakai RPC bump_ai_usage', () => {
  // bump_ai_usage menghitung per-USER dan menaikkan penghitung SEBELUM Gemini
  // dipanggil — pengguna tertagih walau AI gagal. Digantikan checkQuota/commitQuota.
  const pelanggar = FUNGSI.filter((f) => f.isi.includes('bump_ai_usage')).map((f) => f.nama)
  assertEquals(pelanggar, [], `Penghitung kuota lama masih dipakai di: ${pelanggar.join(', ')}`)
})

// ---------- Invarian 4: commitQuota hanya setelah sukses ----------

for (const f of FUNGSI) {
  if (!f.isi.includes('checkQuota(')) continue
  if (PENGECUALIAN_TERCATAT[f.nama]) continue

  Deno.test(`${f.nama}: memakai checkQuota() → wajib punya commitQuota()`, () => {
    assert(
      f.isi.includes('commitQuota('),
      `${f.nama} mengecek kuota tapi tidak pernah mencatat pemakaian — kuota tak pernah habis.`,
    )
  })

  Deno.test(`${f.nama}: commitQuota() muncul SETELAH checkQuota() dalam alur`, () => {
    // Urutan tekstual bukan bukti alur eksekusi, tapi cukup menangkap
    // pembalikan yang paling mahal: menaikkan penghitung lebih dulu, lalu
    // baru memanggil AI — persis kesalahan bump_ai_usage yang dibuang.
    assert(
      f.isi.indexOf('commitQuota(') > f.isi.indexOf('checkQuota('),
      `${f.nama} memanggil commitQuota() sebelum checkQuota().`,
    )
  })
}

// ---------- Invarian 5: model tidak boleh dipatok di luar config.ts ----------

Deno.test('tidak ada nama model Gemini yang di-hardcode di Edge Function', () => {
  const pelanggar: string[] = []
  for (const f of FUNGSI) {
    if (PENGECUALIAN_TERCATAT[f.nama]) continue
    // Nama model dalam literal string, mis. const MODEL = 'gemini-2.5-flash'.
    // Rute resmi hidup di FEATURE_ROUTES; nama tersebar berarti perubahan
    // routing harus dikejar ke banyak berkas.
    const cocok = f.isi.match(/['"`]gemini-[a-z0-9.\-]+['"`]/gi)
    if (cocok) pelanggar.push(`${f.nama} (${[...new Set(cocok)].join(', ')})`)
  }
  assertEquals(pelanggar, [], `Model harus datang dari FEATURE_ROUTES di config.ts. Pelanggar: ${pelanggar.join('; ')}`)
})

// ---------- Invarian 6: rute tidak boleh menunjuk model yang dipensiunkan ----------

/**
 * Keluarga model yang sudah deprecated di Gemini API. Google memangkas
 * kapasitasnya JAUH sebelum tanggal shutdown resmi — gemini-2.5-flash-lite
 * membalas 503 terus-menerus sejak awal Agustus 2026 padahal shutdown-nya
 * 16 Oktober 2026. Menunggu tanggal resmi berarti menunggu fitur mati duluan.
 */
const KELUARGA_PENSIUN = ['gemini-1.', 'gemini-2.0', 'gemini-2.5']

Deno.test('tidak ada rute AI yang memakai keluarga model yang sudah deprecated', () => {
  const pelanggar: string[] = []
  for (const [fitur, rute] of Object.entries(FEATURE_ROUTES)) {
    for (const m of [rute.model, rute.fallbackModel].filter(Boolean) as string[]) {
      if (KELUARGA_PENSIUN.some((p) => m.startsWith(p))) pelanggar.push(`${fitur} -> ${m}`)
    }
  }
  assertEquals(pelanggar, [], `Rute menunjuk model deprecated: ${pelanggar.join('; ')}`)
})

Deno.test('setiap rute teks punya fallbackModel di model yang berbeda', () => {
  // Rute suara dikecualikan: voice-live-token menanyakan model yang benar-benar
  // mendukung bidiGenerateContent ke API saat token diterbitkan, jadi ia sudah
  // punya mekanisme pemulihannya sendiri dan tidak bergantung pada nilai statis.
  const rutaSuara = ['voice_live', 'voice_crud', 'voice_tts']
  const tanpaCadangan = Object.entries(FEATURE_ROUTES)
    .filter(([fitur]) => !rutaSuara.includes(fitur))
    .filter(([, r]) => !r.fallbackModel || r.fallbackModel === r.model)
    .map(([fitur]) => fitur)
  assertEquals(
    tanpaCadangan,
    [],
    `Rute bermodel tunggal mati total begitu Google memensiunkan modelnya: ${tanpaCadangan.join(', ')}`,
  )
})
