// ============================================================
// deno test — peta routing model & kuota.
//
// config.ts adalah sumber kebenaran tunggal untuk key, model, dan batas harian.
// Kalau isinya bergeser diam-diam (mis. cap turun, quotaFeature dua fitur
// bertabrakan), yang terasa adalah tagihan atau pengguna kena limit palsu —
// bukan test yang merah. Berkas ini menutup celah itu.
// ============================================================
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { FEATURE_ROUTES, type FeatureName } from './config.ts'

const NAMA_FITUR = Object.keys(FEATURE_ROUTES) as FeatureName[]

Deno.test('setiap rute punya key, model, quotaFeature, dan dailyCap yang masuk akal', () => {
  for (const nama of NAMA_FITUR) {
    const r = FEATURE_ROUTES[nama]
    assert(['A', 'B', 'C'].includes(r.key), `${nama}: slot key tidak sah (${r.key})`)
    assert(r.model.startsWith('gemini-'), `${nama}: nama model mencurigakan (${r.model})`)
    assert(r.quotaFeature.length > 0, `${nama}: quotaFeature kosong`)
    assert(r.dailyCap > 0, `${nama}: dailyCap harus > 0`)
  }
})

Deno.test('fallbackModel tidak boleh sama dengan model utama', () => {
  // Retry ke model yang sama memakan bucket kuota yang persis baru saja gagal —
  // biaya bertambah tanpa menaikkan peluang berhasil.
  for (const nama of NAMA_FITUR) {
    const r = FEATURE_ROUTES[nama]
    if (!r.fallbackModel) continue
    assert(r.fallbackModel !== r.model, `${nama}: fallbackModel sama dengan model utama`)
  }
})

Deno.test('dua fitur yang berbagi quotaFeature wajib punya dailyCap sama', () => {
  // Berbagi penghitung tapi beda batas = perilaku bergantung fitur mana yang
  // kebetulan dipanggil lebih dulu. Rute voice memang sengaja berbagi.
  const capPerFitur = new Map<string, { cap: number; asal: string }>()
  for (const nama of NAMA_FITUR) {
    const r = FEATURE_ROUTES[nama]
    const ada = capPerFitur.get(r.quotaFeature)
    if (ada) {
      assertEquals(
        r.dailyCap, ada.cap,
        `quotaFeature "${r.quotaFeature}" dipakai ${ada.asal} (cap ${ada.cap}) dan ${nama} (cap ${r.dailyCap})`,
      )
    } else {
      capPerFitur.set(r.quotaFeature, { cap: r.dailyCap, asal: nama })
    }
  }
})

// ---------- Rute hasil migrasi G-18 ----------
// Sebelumnya kedua fitur ini memakai key & model hardcoded plus penghitung
// kuota sendiri. Nilai di bawah mengunci hasil migrasinya.

Deno.test('rute "catat" ada dan memakai penghitung kuota sendiri', () => {
  const r = FEATURE_ROUTES.catat
  assert(r, 'rute "catat" hilang — ai-catat akan kehilangan routing')
  assertEquals(r.quotaFeature, 'catat')
  assertEquals(r.dailyCap, 40)
  // Model dipertahankan persis seperti sebelum migrasi supaya kualitas
  // keluaran tidak ikut berubah bersama perubahan routing.
  assertEquals(r.model, 'gemini-2.5-flash')
})

Deno.test('rute "hpp_draft" ada dan memakai penghitung kuota sendiri', () => {
  const r = FEATURE_ROUTES.hpp_draft
  assert(r, 'rute "hpp_draft" hilang — ai-hpp-draft akan kehilangan routing')
  assertEquals(r.quotaFeature, 'hpp_draft')
  assertEquals(r.dailyCap, 10)
  assertEquals(r.model, 'gemini-2.5-flash')
})

Deno.test('catat & hpp_draft TIDAK berbagi penghitung dengan crud atau ocr', () => {
  // Kalau digabung, satu sesi pencatatan bisa menghabiskan jatah baca struk —
  // pengguna kehabisan kuota di fitur yang belum pernah mereka sentuh.
  const terpisah = new Set([
    FEATURE_ROUTES.catat.quotaFeature,
    FEATURE_ROUTES.hpp_draft.quotaFeature,
    FEATURE_ROUTES.crud.quotaFeature,
    FEATURE_ROUTES.ocr.quotaFeature,
  ])
  assertEquals(terpisah.size, 4)
})
