// ============================================================
// Diagnosa kunci & model AI — dipakai Edge Function `ai-selftest`.
//
// Berkas ini ada karena satu pertanyaan yang, selama 32 hari, tidak bisa
// dijawab siapa pun tanpa membuka dashboard dan menebak: KUNCI YANG MANA yang
// ditolak Google, dan MODEL YANG MANA yang masih dilayani?
//
// Riwayatnya: 7 Agustus 2026 adalah hari terakhir `macro_signals` berisi
// jawaban Gemini sungguhan. Sejak 8 Agustus setiap run menulis 25 baris
// fallback "stabil" tanpa driver, menandai `macro_runs.status = 'done'`, dan
// tidak menimbulkan gejala apa pun. Sebabnya baru terbaca pada 8 September di
// satu baris log yang tidak pernah dilihat siapa pun:
//
//   gemini HTTP 401: ... "status": "UNAUTHENTICATED"
//
// Yang membuatnya mahal bukan kegagalannya, melainkan ketiadaan cara memeriksa.
// Menjawab "apakah kuncinya masih hidup?" menuntut deploy fungsi percobaan,
// atau menempelkan kunci ke curl — yaitu memindahkan rahasia produksi ke
// riwayat shell. Berkas ini menjadikan pertanyaan itu satu panggilan HTTP.
//
// ATURAN KERAS: tidak satu pun fungsi di sini mengembalikan NILAI kunci.
// Yang keluar hanya sidik jari SHA-256 terpotong — cukup untuk menjawab
// "apakah slot A dan slot B berisi kunci yang sama?" dan "apakah kunci ini
// masih kunci yang sama dengan yang saya pasang kemarin?", tetapi tidak bisa
// dibalik menjadi kuncinya. Diagnosa yang membocorkan rahasia bukan diagnosa,
// melainkan kebocoran dengan alasan.
// ============================================================
import { FEATURE_ROUTES, type KeySlot } from './config.ts'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const SLOT: KeySlot[] = ['A', 'B', 'C']

/** Sidik jari kunci: 12 hex pertama SHA-256. Tidak bisa dibalik jadi kunci. */
async function sidikJari(nilai: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nilai))
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Nilai yang jelas-jelas bukan kunci. Cerminan `kunciTakMasukAkal` di config.ts
 * — sengaja diduplikasi kecil di sini supaya diagnosa bisa MELAPORKAN slot yang
 * berisi placeholder alih-alih diam-diam melewatinya seperti resolveKey().
 */
function tampakPlaceholder(v: string): boolean {
  const s = v.trim()
  return !s || s.length < 20 || /[<>]/.test(s) || /^(your|isi|ganti|xxx|todo)/i.test(s)
}

export interface StatusSlot {
  slot: string
  /** Nama env yang benar-benar terbaca. */
  sumber: string
  terisi: boolean
  panjang: number
  /** Kosong bila slot tidak terisi. */
  sidikJari: string
  /** true = isinya jelas bukan kunci (placeholder ikut ter-set). */
  placeholder: boolean
  /** Hasil uji ke Google. null bila slot kosong sehingga tidak diuji. */
  uji: HasilUji | null
}

export interface HasilUji {
  httpStatus: number | null
  diterima: boolean
  /** Ringkasan sebab kegagalan, sudah diterjemahkan ke bahasa manusia. */
  sebab: string
  /** Model yang dilayani kunci ini untuk generateContent. */
  modelTersedia: string[]
  /**
   * Model percakapan suara dua arah (bidiGenerateContent).
   *
   * Dipisah karena model Live TIDAK mendukung generateContent sama sekali.
   * Versi pertama pemeriksa ini hanya menyaring generateContent, sehingga
   * melaporkan rute voice_live "mati" padahal modelnya sehat — persis jenis
   * kesimpulan salah yang membuat orang mengganti hal yang tidak rusak.
   */
  modelSuaraTersedia: string[]
}

/**
 * Tanya Google: kunci ini masih sah, dan model apa yang dilayaninya?
 *
 * Dipakai endpoint ListModels, bukan generateContent, karena ListModels
 * TIDAK memakan kuota harian model mana pun. Diagnosa yang menghabiskan jatah
 * yang sedang didiagnosa akan mengubah hasilnya sendiri.
 */
export async function ujiKunci(apiKey: string): Promise<HasilUji> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': apiKey },
    })
  } catch (e) {
    return { httpStatus: null, diterima: false, sebab: `Jaringan gagal: ${String(e).slice(0, 120)}`, modelTersedia: [], modelSuaraTersedia: [] }
  }

  if (!res.ok) {
    const teks = (await res.text()).slice(0, 400)
    const besar = teks.toUpperCase()
    let sebab: string
    if (res.status === 401) {
      sebab = 'HTTP 401 UNAUTHENTICATED — Google tidak mengenali kunci ini sama sekali. '
        + 'Biasanya kunci sudah dihapus/dicabut di AI Studio, atau proyek Google-nya dihapus. '
        + 'Tidak ada perbaikan di sisi kode: kunci harus dibuat ulang.'
    } else if (res.status === 403) {
      sebab = 'HTTP 403 — kunci dikenali tapi ditolak. Umumnya Generative Language API belum '
        + 'diaktifkan di proyek Google-nya, atau kunci dibatasi ke referer/IP tertentu.'
    } else if (res.status === 400 && (besar.includes('API_KEY_INVALID') || besar.includes('API KEY NOT VALID'))) {
      sebab = 'HTTP 400 API_KEY_INVALID — bentuk kuncinya salah (mis. terpotong saat disalin, '
        + 'atau ikut terbawa tanda kutip/spasi).'
    } else if (res.status === 429) {
      sebab = 'HTTP 429 — kunci SAH, hanya sedang kena batas laju. Coba lagi sebentar lagi.'
    } else {
      sebab = `HTTP ${res.status}: ${teks.slice(0, 200)}`
    }
    return { httpStatus: res.status, diterima: false, sebab, modelTersedia: [], modelSuaraTersedia: [] }
  }

  const data = await res.json().catch(() => ({}))
  const semua = (data?.models ?? []) as Array<Record<string, unknown>>
  const dukung = (metode: string) => semua
    .filter((m) => Array.isArray(m.supportedGenerationMethods)
      && (m.supportedGenerationMethods as string[]).includes(metode))
    .map((m) => String(m.name ?? '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort()

  return {
    httpStatus: 200,
    diterima: true,
    sebab: 'Kunci diterima Google.',
    modelTersedia: dukung('generateContent'),
    modelSuaraTersedia: dukung('bidiGenerateContent'),
  }
}

/**
 * Periksa satu slot: apa yang ter-set, dan apakah Google menerimanya.
 *
 * Slot yang kosong SENGAJA tetap dilaporkan (bukan dilewati) beserta env mana
 * yang akhirnya dipakai. Kejadian nyata yang dicatat di config.ts — ketiga slot
 * terisi teks "<key>" sehingga menang atas GEMINI_API_KEY yang masih sah —
 * hanya bisa terlihat kalau slot kosong dan slot placeholder bisa dibedakan.
 */
export async function periksaSlot(slot: KeySlot, ujiKeGoogle = true): Promise<StatusSlot> {
  const langsung = Deno.env.get(`GEMINI_KEY_${slot}`)
  const cadangan = Deno.env.get('GEMINI_API_KEY')

  let nilai = ''
  let sumber = '(tidak ada)'
  let placeholder = false

  if (langsung && !tampakPlaceholder(langsung)) {
    nilai = langsung
    sumber = `GEMINI_KEY_${slot}`
  } else if (langsung) {
    // Terisi tapi isinya bukan kunci — laporkan apa adanya, jangan sembunyikan.
    placeholder = true
    sumber = `GEMINI_KEY_${slot} (placeholder, diabaikan) -> GEMINI_API_KEY`
    if (cadangan && !tampakPlaceholder(cadangan)) nilai = cadangan
  } else if (cadangan && !tampakPlaceholder(cadangan)) {
    nilai = cadangan
    sumber = 'GEMINI_API_KEY (cadangan)'
  }

  return {
    slot,
    sumber,
    terisi: Boolean(nilai),
    panjang: nilai.length,
    sidikJari: nilai ? await sidikJari(nilai) : '',
    placeholder,
    uji: nilai && ujiKeGoogle ? await ujiKunci(nilai) : null,
  }
}

export interface StatusModel {
  fitur: string
  slot: string
  model: string
  fallbackModel: string | null
  modelHidup: boolean | null
  fallbackHidup: boolean | null
}

export interface Diagnosa {
  waktu: string
  slot: StatusSlot[]
  rute: StatusModel[]
  ringkasan: string[]
}

/**
 * Diagnosa penuh: kunci mana yang hidup, lalu SETIAP rute di FEATURE_ROUTES
 * dicocokkan ke daftar model yang benar-benar dilayani kunci slotnya.
 *
 * Pencocokan rute inilah bagian yang paling sering terlewat. Kunci yang sah
 * tetap membuat sebuah fitur mati kalau nama modelnya sudah tidak dilayani —
 * persis pemadaman 10 Agustus 2026 — dan dari layar pengguna kedua kegagalan
 * itu terlihat sama.
 */
export async function diagnosaLengkap(): Promise<Diagnosa> {
  const slot: StatusSlot[] = []
  for (const s of SLOT) slot.push(await periksaSlot(s))

  const modelPerSlot = new Map<string, string[] | null>()
  const suaraPerSlot = new Map<string, string[] | null>()
  for (const s of slot) {
    modelPerSlot.set(s.slot, s.uji?.diterima ? s.uji.modelTersedia : null)
    suaraPerSlot.set(s.slot, s.uji?.diterima ? s.uji.modelSuaraTersedia : null)
  }

  // Rute percakapan suara memakai bidiGenerateContent, bukan generateContent —
  // mencocokkannya ke daftar yang salah membuat model sehat terlihat pensiun.
  const RUTE_SUARA = ['voice_live', 'voice_crud']

  const rute: StatusModel[] = Object.entries(FEATURE_ROUTES).map(([fitur, r]) => {
    const tersedia = (RUTE_SUARA.includes(fitur) ? suaraPerSlot : modelPerSlot).get(r.key) ?? null
    const hidup = (m: string | undefined) =>
      !m ? null : tersedia === null ? null : tersedia.includes(m)
    return {
      fitur,
      slot: r.key,
      model: r.model,
      fallbackModel: r.fallbackModel ?? null,
      modelHidup: hidup(r.model),
      fallbackHidup: hidup(r.fallbackModel),
    }
  })

  const ringkasan: string[] = []
  for (const s of slot) {
    if (!s.terisi) ringkasan.push(`Slot ${s.slot}: TIDAK ADA kunci sama sekali (${s.sumber}).`)
    else if (s.placeholder) ringkasan.push(`Slot ${s.slot}: GEMINI_KEY_${s.slot} berisi placeholder, bukan kunci. Hapus atau perbaiki secret itu.`)
    else if (!s.uji?.diterima) ringkasan.push(`Slot ${s.slot} (${s.sumber}, sidik jari ${s.sidikJari}): DITOLAK. ${s.uji?.sebab ?? ''}`)
    else ringkasan.push(`Slot ${s.slot} (${s.sumber}, sidik jari ${s.sidikJari}): OK, ${s.uji.modelTersedia.length} model teks + ${s.uji.modelSuaraTersedia.length} model suara.`)
  }
  const ruteMati = rute.filter((r) => r.modelHidup === false && r.fallbackHidup !== true)
  if (ruteMati.length) {
    ringkasan.push(
      `Rute TANPA satu pun model hidup: ${ruteMati.map((r) => `${r.fitur} (${r.model})`).join(', ')}. `
      + 'Perbarui nama model di FEATURE_ROUTES (_shared/ai/config.ts).',
    )
  }
  const sidik = slot.filter((s) => s.terisi).map((s) => s.sidikJari)
  if (sidik.length > 1 && new Set(sidik).size === 1) {
    ringkasan.push(
      'Ketiga slot memakai kunci yang SAMA PERSIS. Rotasi per-slot tidak memberi isolasi kuota '
      + 'apa pun — satu kunci dicabut berarti seluruh fitur AI mati bersamaan, seperti yang sudah terjadi.',
    )
  }

  return { waktu: new Date().toISOString(), slot, rute, ringkasan }
}
