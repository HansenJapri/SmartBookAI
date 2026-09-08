// ============================================================
// Supabase Edge Function: voice-live-token
//
// Mencetak TOKEN EFEMERAL untuk sesi Gemini Live.
//
// Kenapa fungsi ini harus ada: sesi Live berjalan lewat WebSocket langsung dari
// browser ke Google. Satu-satunya cara browser membuka soket itu adalah membawa
// kredensial di URL — dan kunci proyek TIDAK BOLEH sampai ke sana. Siapa pun
// yang membuka DevTools akan melihatnya, lalu memakai kuota Gemini atas nama
// kita tanpa batas.
//
// Token yang dicetak di sini berumur menit, sekali pakai, dan dikunci ke satu
// model. Bocor pun, kerugiannya sebatas satu sesi suara.
//
// SEMUA KEGAGALAN DI SINI HARUS BISA DIBACA. Versi sebelumnya membalas
// "Sesi suara belum bisa dibuka. Coba lagi sebentar lagi." untuk enam sebab
// yang berbeda — fungsi belum ter-deploy, kuota belum terpasang, kunci belum
// diatur, model salah nama. Pesan seragam itu menyembunyikan jawaban yang
// sebetulnya sudah diketahui server, dan membuat penyebabnya harus ditebak
// satu per satu. Karena itu tiap cabang di bawah punya `code` sendiri.
//
// Deploy: supabase functions deploy voice-live-token
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { FEATURE_ROUTES, resolveKey, type FeatureName } from '../_shared/ai/config.ts'
import { checkQuota, commitQuota } from '../_shared/ai/rate-limiter.ts'
import { resolveScope } from '../_shared/ai/workspace-scope.ts'
import { corsHeaders, originDitolak } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const API_ROOT = 'https://generativelanguage.googleapis.com'
// Token efemeral hanya dilayani jalur v1alpha; v1beta masih menuntut kunci asli.
const AUTH_TOKEN_URL = `${API_ROOT}/v1alpha/auth_tokens`

const NEW_SESSION_WINDOW_SEC = 60
const SESSION_TTL_SEC = 15 * 60

const ALLOWED_FEATURES: FeatureName[] = ['voice_live', 'voice_crud']

// ---------- Penemuan model Live ----------
//
// Nama model Live berlabel preview dan berganti akhiran cukup sering
// (`-preview`, `-preview-09-2025`, dan seterusnya). Menuliskannya sebagai
// konstanta berarti fitur ini akan mati diam-diam setiap kali Google mengganti
// akhiran, dengan gejala yang menyesatkan: token tercetak normal, lalu soket
// ditutup kode 1007 di sisi klien.
//
// Jadi nama model TIDAK ditebak. Kita tanyakan ke API model apa saja yang
// benar-benar mendukung bidiGenerateContent pada kunci ini, lalu pilih yang
// paling cocok. Nilai di FEATURE_ROUTES turun pangkat menjadi PREFERENSI.

interface ModelInfo { name: string; supportedGenerationMethods?: string[] }

// Instance Edge Function tetap hangat beberapa menit; cache ini menghindari
// satu panggilan ListModels tiap kali pengguna menekan tombol suara.
let modelCache: { at: number; live: string[] } | null = null
const MODEL_CACHE_MS = 10 * 60 * 1000

async function listLiveModels(apiKey: string): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.live

  const res = await fetch(`${API_ROOT}/v1beta/models?pageSize=200`, {
    headers: { 'x-goog-api-key': apiKey },
  })
  if (!res.ok) {
    throw new Error(`ListModels HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const data = await res.json()
  const live = ((data?.models ?? []) as ModelInfo[])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('bidiGenerateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''))

  modelCache = { at: Date.now(), live }
  return live
}

/**
 * Pilih model Live terbaik untuk sebuah fitur.
 *
 * Urutan: nama yang dikonfigurasi (kalau memang ada) -> kandidat yang cocok
 * dengan sifat yang dibutuhkan fitur -> model Live apa pun yang tersedia.
 */
function pickModel(feature: FeatureName, preferred: string, available: string[]): string | null {
  if (available.includes(preferred)) return preferred

  // Percakapan butuh audio native supaya intonasinya wajar; jalur perintah
  // hanya butuh Live biasa dan justru lebih baik memakai model paling cepat.
  const wants = feature === 'voice_live'
    ? [/native-?audio/i, /live/i]
    : [/flash.*live/i, /live/i]

  for (const rx of wants) {
    // Versi stabil didahulukan daripada yang berlabel preview/exp.
    const hits = available.filter((m) => rx.test(m))
    const stable = hits.filter((m) => !/preview|exp/i.test(m))
    if (stable.length) return stable.sort()[0]
    if (hits.length) return hits.sort()[0]
  }
  return available[0] ?? null
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') {
    originDitolak(origin, 'voice-live-token')
    return new Response('ok', { headers: cors })
  }
  if (req.method !== 'POST') return json({ error: 'Method tidak didukung.', code: 'BAD_METHOD' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Harus masuk (login).', code: 'NO_AUTH' }, 401)
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return json({ error: 'Sesi tidak valid. Coba keluar lalu masuk lagi.', code: 'BAD_SESSION' }, 401)

    const body = await req.json().catch(() => ({}))
    const feature = (body?.feature ?? 'voice_live') as FeatureName
    if (!ALLOWED_FEATURES.includes(feature)) {
      return json({ error: 'Fitur suara tidak dikenal.', code: 'BAD_FEATURE' }, 400)
    }

    try {
      await resolveScope(supabase, body?.owner)
    } catch (e) {
      return json({
        error: String((e as Error)?.message || 'Akses workspace tidak sah.'),
        code: 'BAD_SCOPE',
      }, 403)
    }

    const route = FEATURE_ROUTES[feature]
    const apiKey = resolveKey(route.key)
    if (!apiKey) {
      return json({
        error: `Kunci Gemini belum diatur. Set secret GEMINI_KEY_${route.key} di Supabase → Edge Functions → Secrets.`,
        code: 'NO_API_KEY',
      }, 500)
    }

    // ---------- Pelaporan pemakaian ----------
    // Kuota suara dihitung dalam DETIK dan baru diketahui setelah sesi selesai.
    // Angka dari klien dijepit ke umur satu sesi: yang berbahaya bukan laporan
    // yang terlalu kecil, melainkan angka liar yang menghabiskan kuota seluruh
    // workspace dalam satu panggilan.
    if (body?.action === 'usage') {
      const seconds = Math.max(0, Math.min(SESSION_TTL_SEC, Math.round(Number(body?.seconds) || 0)))
      if (seconds > 0) await commitQuota(supabase, route.quotaFeature, seconds)
      return json({ ok: true, seconds })
    }

    // ---------- Diagnosa ----------
    // Menjawab "kenapa suara tidak mau menyala?" dalam satu panggilan, tanpa
    // menebak. Tidak mencetak token dan tidak memakai kuota.
    if (body?.action === 'diagnose') {
      const out: Record<string, unknown> = {
        ok: true,
        feature,
        keySlot: route.key,
        apiKeyPresent: true,
        configuredModel: route.model,
      }
      try {
        const live = await listLiveModels(apiKey)
        out.liveModelsAvailable = live
        out.chosenModel = pickModel(feature, route.model, live)
        out.configuredModelExists = live.includes(route.model)
      } catch (e) {
        out.listModelsError = String((e as Error)?.message).slice(0, 300)
      }
      const q = await checkQuota(supabase, route.quotaFeature, route.dailyCap)
      out.quota = q
      out.quotaSystemInstalled = !q.unavailable
      return json(out)
    }

    // ---------- Kuota ----------
    // Diperiksa SEBELUM token dicetak: token yang terlanjur ada berarti sesi
    // bisa dibuka, dan sesi yang terbuka langsung memakan detik kuota.
    const quota = await checkQuota(supabase, route.quotaFeature, route.dailyCap)
    if (quota.unavailable) {
      // Bukan kuota habis — penghitungnya sendiri tidak terbaca.
      return json({
        error: 'Sistem kuota AI belum terpasang di database. Jalankan '
          + 'supabase/migration_ai_workspace_quota.sql di Supabase → SQL Editor, lalu coba lagi.',
        code: 'QUOTA_SYSTEM_MISSING',
      }, 503)
    }
    if (!quota.allowed) {
      return json({
        error: `Kuota suara harian workspace Anda sudah habis (${Math.round(quota.cap / 60)} menit/hari). `
          + 'Kuota dibagi bersama seluruh anggota dan direset otomatis besok.',
        code: 'DAILY_LIMIT_REACHED',
        feature: route.quotaFeature,
        used: quota.used,
        cap: quota.cap,
        resetAt: quota.resetAt,
      }, 429)
    }

    // ---------- Pilih model ----------
    let model: string
    try {
      const live = await listLiveModels(apiKey)
      if (!live.length) {
        return json({
          error: 'Kunci Gemini ini tidak punya akses ke model Live (bidiGenerateContent). '
            + 'Periksa apakah Live API sudah aktif untuk proyek Google AI Studio Anda.',
          code: 'NO_LIVE_MODEL',
        }, 502)
      }
      const picked = pickModel(feature, route.model, live)
      if (!picked) {
        return json({
          error: `Tidak ada model Live yang cocok untuk ${feature}. Tersedia: ${live.join(', ')}`,
          code: 'NO_MATCHING_MODEL',
          available: live,
        }, 502)
      }
      model = picked
    } catch (e) {
      return json({
        error: 'Gagal membaca daftar model Gemini: ' + String((e as Error)?.message).slice(0, 200),
        code: 'LIST_MODELS_FAILED',
      }, 502)
    }

    const now = Date.now()
    const res = await fetch(AUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(now + SESSION_TTL_SEC * 1000).toISOString(),
        newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_SEC * 1000).toISOString(),
        // Model dikunci di token. Kalau klien nanti mengirim setup dengan model
        // lain, Google yang menolak — pembatasan ini tidak bergantung pada
        // kejujuran kode frontend.
        liveConnectConstraints: { model: `models/${model}` },
      }),
    })

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400)
      console.error('auth_tokens gagal', res.status, detail)
      // Detail Google ikut dikirim. Ini endpoint ber-auth milik pemilik aplikasi
      // sendiri, dan menyembunyikannya justru yang membuat kegagalan jadi
      // tebak-tebakan berjam-jam.
      return json({
        error: `Google menolak permintaan token (HTTP ${res.status}). ${detail}`,
        code: 'TOKEN_MINT_FAILED',
        model,
      }, 502)
    }

    const data = await res.json()
    const token = data?.name ?? data?.token
    if (!token) {
      console.error('auth_tokens tanpa field name', JSON.stringify(data).slice(0, 300))
      return json({
        error: 'Token diterima tapi bentuknya tidak dikenali. Cek log Edge Function.',
        code: 'TOKEN_SHAPE_UNKNOWN',
      }, 502)
    }

    // Kuota TIDAK di-commit di sini — lihat action 'usage'. Mencatat di muka
    // akan menagih pengguna yang koneksinya putus sebelum sempat bicara.
    return json({
      token,
      model,
      expiresAt: new Date(now + SESSION_TTL_SEC * 1000).toISOString(),
      quota: { used: quota.used, cap: quota.cap, resetAt: quota.resetAt },
    })
  } catch (e) {
    console.error('voice-live-token error', e)
    return json({
      error: 'Kesalahan tak terduga di server suara: ' + String((e as Error)?.message).slice(0, 200),
      code: 'UNEXPECTED',
    }, 500)
  }
})
