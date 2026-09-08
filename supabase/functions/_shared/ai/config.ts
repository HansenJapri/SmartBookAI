// ============================================================
// Peta routing API key & model AI — SUMBER KEBENARAN TUNGGAL.
//
// Semua Edge Function AI WAJIB mengambil key & model dari sini lewat
// getGeminiClient(feature). Jangan hardcode key/model di tempat lain, supaya
// perubahan routing cukup dilakukan di satu berkas ini.
//
// Key disimpan sebagai secret Supabase: GEMINI_KEY_A / _B / _C.
// (GEMINI_API_KEY lama dipakai sebagai cadangan agar deployment lama tidak mati.)
// ============================================================

export type FeatureName =
  | 'insight_dashboard'
  | 'insight_stok'
  | 'chat'
  | 'crud'
  | 'ocr'
  | 'catat'
  | 'hpp_draft'
  | 'voice_live'
  | 'voice_crud'
  | 'voice_tts'

export type KeySlot = 'A' | 'B' | 'C'

export interface FeatureRoute {
  key: KeySlot
  model: string
  /** Model cadangan bila percobaan pertama gagal validasi (maks 1x retry). */
  fallbackModel?: string
  /** Nama fitur untuk penghitung kuota (workspace_ai_usage.feature). */
  quotaFeature:
    | 'insight_dashboard' | 'insight_stok' | 'chat' | 'crud' | 'ocr'
    | 'catat' | 'hpp_draft' | 'voice'
  /** Batas harian per WORKSPACE. Voice dalam DETIK, sisanya jumlah panggilan. */
  dailyCap: number
}

// Nama model sudah dicocokkan dengan daftar Rate Limit di Google AI Studio.
// Fallback SENGAJA hanya bertukar antar dua model Flash-Lite (3.5 <-> 3.1):
// keduanya bucket RPD terpisah, jadi retry tidak memakan kuota model pertama,
// dan kita tidak perlu menyentuh Gemini 3.6 Flash yang RPD-nya jauh lebih kecil
// (20/hari) dibanding Flash-Lite (500/hari).
//
// SETIAP rute WAJIB punya fallbackModel pada keluarga yang berbeda. Alasannya
// bukan kenyamanan melainkan sejarah: 10 Agustus 2026 seluruh fitur AI mati
// serentak tanpa satu baris kode pun berubah, karena Google memangkas kapasitas
// keluarga Gemini 2.5 yang sudah deprecated (2.5-flash-lite membalas 503 terus
// menerus menjelang shutdown 16 Oktober 2026). Rute bermodel tunggal berarti
// jadwal deprecation Google adalah satu-satunya hal yang menentukan apakah
// aplikasi ini hidup — fallback mengubahnya jadi degradasi, bukan kematian.
export const FEATURE_ROUTES: Record<FeatureName, FeatureRoute> = {
  insight_dashboard: {
    key: 'A',
    model: 'gemini-3.5-flash-lite',
    fallbackModel: 'gemini-3.1-flash-lite',
    quotaFeature: 'insight_dashboard',
    dailyCap: 10,
  },
  chat: {
    key: 'A',
    model: 'gemini-3.5-flash-lite',
    fallbackModel: 'gemini-3.1-flash-lite',
    quotaFeature: 'chat',
    dailyCap: 10,
  },
  insight_stok: {
    key: 'B',
    model: 'gemini-3.5-flash-lite',
    fallbackModel: 'gemini-3.1-flash-lite',
    quotaFeature: 'insight_stok',
    dailyCap: 10,
  },
  // Percakapan suara: model inilah yang mendengar dan menjawab dengan suara.
  voice_live: {
    key: 'B',
    model: 'gemini-3.1-flash-live-preview',
    quotaFeature: 'voice',
    dailyCap: 10 * 60, // 10 menit, disimpan sebagai DETIK
  },
  // Perintah suara yang MENGUBAH DATA dipisah ke model sendiri. Alasannya
  // bukan performa melainkan pembatasan: hanya sesi ini yang pernah menerima
  // deklarasi fungsi CRUD, sehingga obrolan santai di voice_live secara
  // struktural tidak punya jalur menuju tabel mana pun.
  //
  // Nilai `model` untuk kedua rute voice adalah PREFERENSI, bukan keharusan.
  // voice-live-token menanyakan ke API model apa yang benar-benar mendukung
  // bidiGenerateContent pada kunci ini dan memakai yang paling cocok. Nama Live
  // berlabel preview terlalu sering berganti akhiran untuk dipatok di sini —
  // dipatok berarti fitur mati diam-diam setiap Google mengganti namanya.
  voice_crud: {
    key: 'B',
    model: 'gemini-3.1-flash-live-preview',
    quotaFeature: 'voice',
    dailyCap: 10 * 60,
  },
  voice_tts: {
    key: 'B',
    model: 'gemini-3.1-flash-tts-preview',
    quotaFeature: 'voice',
    dailyCap: 10 * 60,
  },
  crud: {
    key: 'C',
    model: 'gemini-3.5-flash-lite',
    fallbackModel: 'gemini-3.1-flash-lite',
    quotaFeature: 'crud',
    dailyCap: 10,
  },
  ocr: {
    key: 'C',
    model: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-3.5-flash-lite',
    quotaFeature: 'ocr',
    dailyCap: 10,
  },
  // Pencatatan bahasa alami (ai-catat) dan draf HPP (ai-hpp-draft) dulu memakai
  // jalur sendiri: key & model hardcoded, plus RPC kuota terpisah `bump_ai_usage`
  // yang menghitung per-USER dan reset tengah malam UTC. Akibatnya kuota mereka
  // tidak pernah muncul di penghitung workspace, dan — karena RPC itu menaikkan
  // penghitung SEBELUM Gemini dipanggil — pengguna tetap tertagih saat AI gagal.
  //
  // Keduanya dulu dipatok `gemini-2.5-flash` "persis seperti sebelumnya" agar
  // migrasi routing tidak mengubah kualitas keluaran. Nilai itu tidak bisa
  // dipertahankan lagi: keluarga 2.5 sudah deprecated dan kapasitasnya sedang
  // dipangkas Google. Penggantinya yang setara menurut panduan migrasi resmi
  // adalah Gemini 3.5 Flash — kelas yang sama, bukan Flash-Lite, karena kedua
  // fitur ini menyusun draf terstruktur dan bukan sekadar merangkai kalimat.
  catat: {
    key: 'C',
    model: 'gemini-3.5-flash',
    fallbackModel: 'gemini-3.5-flash-lite',
    quotaFeature: 'catat',
    dailyCap: 40,
  },
  hpp_draft: {
    key: 'C',
    model: 'gemini-3.5-flash',
    fallbackModel: 'gemini-3.5-flash-lite',
    quotaFeature: 'hpp_draft',
    dailyCap: 10,
  },
}

// ============================================================
// RUTE PLATFORM — pekerjaan terjadwal yang bukan milik workspace mana pun.
//
// Dipisah dari FEATURE_ROUTES karena bedanya nyata, bukan kosmetik: rute
// platform TIDAK punya quotaFeature dan TIDAK punya dailyCap per-workspace,
// sebab tidak ada workspace yang bisa ditagih untuk cron harian yang hasilnya
// dipakai bersama seluruh pengguna.
//
// Rute ini lahir dari kegagalan yang berlangsung 32 hari. `makro-harian`
// tidak pernah ikut migrasi G-18: ia membaca GEMINI_API_KEY sendiri dan memaku
// `const MODEL = 'gemini-2.5-flash'`. Ketika kunci lama itu dicabut Google,
// pipeline balas 401 setiap pagi, menulis 25 baris sinyal "stabil" palsu, dan
// menandai dirinya `done`. Satu-satunya fungsi yang lolos dari router terpusat
// adalah satu-satunya fungsi yang mati diam-diam — itu bukan kebetulan.
//
// Sekarang ia memakai slot kunci dan rantai model yang sama dengan fitur lain,
// jadi satu kunci yang dicabut atau satu model yang dipensiunkan tidak lagi
// bisa mematikannya sendirian.
export type PlatformFeatureName = 'makro'

export interface PlatformRoute {
  key: KeySlot
  model: string
  /** WAJIB ada, dan pada model berbeda — alasannya sama dengan FEATURE_ROUTES. */
  fallbackModel: string
}

export const PLATFORM_ROUTES: Record<PlatformFeatureName, PlatformRoute> = {
  // Sinyal arah harga 30 hari dari judul berita (1 panggilan/hari, ~25 komoditas).
  //
  // Flash penuh, bukan Flash-Lite: keluarannya JSON terstruktur untuk 25
  // komoditas sekaligus dengan aturan keras soal grounding ke berita. Ini kelas
  // tugas yang sama dengan `catat` dan `hpp_draft`, bukan sekadar merangkai
  // kalimat. Cadangannya sengaja melompat keluarga (3.5 -> 3.1) supaya
  // pemangkasan kapasitas satu keluarga tidak menghabiskan kedua percobaan.
  makro: {
    key: 'A',
    model: 'gemini-3.5-flash',
    fallbackModel: 'gemini-3.1-flash-lite',
  },
}

/**
 * Nilai yang BUKAN kunci sungguhan, walau secret-nya terisi.
 *
 * Pemeriksaan ini SENGAJA longgar dan hanya menyaring yang jelas-jelas bukan
 * kunci. Google memakai lebih dari satu format ("AIza..." untuk kunci AI Studio
 * biasa, "AQ.…" untuk token yang diterbitkan belakangan), jadi mencocokkan
 * awalan tertentu justru berisiko menolak kunci yang sah — kegagalan yang jauh
 * lebih membingungkan daripada yang hendak dicegah.
 *
 * Penjaga ini ada karena kejadian nyata: contoh perintah `supabase secrets set
 * GEMINI_KEY_A=<key>` disalin apa adanya, sehingga ketiga slot terisi teks
 * "<key>". Tanpa pemeriksaan, nilai itu TRUTHY — jadi ia menang atas
 * GEMINI_API_KEY yang justru masih sah, dan seluruh fitur AI mati justru karena
 * upaya memperbaikinya. Slot yang isinya jelas bukan kunci diperlakukan sama
 * dengan slot kosong: mundur ke cadangan, bukan memaksakan yang salah.
 */
function kunciTakMasukAkal(nilai: string): boolean {
  const v = nilai.trim()
  if (!v) return true
  if (v.length < 20) return true
  if (/[<>]/.test(v)) return true               // placeholder <key>, <your-key>
  if (/^(your|isi|ganti|xxx|todo)/i.test(v)) return true
  return false
}

/** Ambil nilai API key untuk slot tertentu dari environment. */
export function resolveKey(slot: KeySlot): string | undefined {
  const direct = Deno.env.get(`GEMINI_KEY_${slot}`)
  if (direct && !kunciTakMasukAkal(direct)) return direct
  if (direct) {
    console.error(
      `[ai] GEMINI_KEY_${slot} terisi nilai yang bukan kunci API (mis. placeholder). `
      + 'Slot diabaikan, memakai GEMINI_API_KEY. Perbaiki atau hapus secret ini.',
    )
  }
  // Cadangan: proyek lama hanya punya satu key project-wide.
  const cadangan = Deno.env.get('GEMINI_API_KEY')
  return cadangan && !kunciTakMasukAkal(cadangan) ? cadangan : undefined
}
