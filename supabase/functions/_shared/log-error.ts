// ============================================================
// Pencatat error sisi SERVER ke tabel `error_logs`.
//
// Pasangan dari src/lib/errorLog.js. Keduanya menulis ke tabel yang sama lewat
// RPC yang sama, sehingga tab "Log Error" memuat SATU daftar — bukan satu
// daftar untuk browser dan satu lagi untuk server yang harus dibaca bergantian.
//
// Ini penting justru karena kegagalan yang paling mahal melintasi keduanya.
// Pemadaman 8 September 2026 terlihat sebagai "tombol tidak merespons" di
// browser dan sebagai `OPTIONS 200 tanpa POST` di server; tidak satu pun sisi
// menjelaskan apa-apa sendirian.
//
// ATURAN yang sama dengan sisi klien:
//   1. TIDAK PERNAH MELEMPAR — pencatat yang bisa gagal akan menjatuhkan
//      handler yang sedang menangani error lain.
//   2. TIDAK PERNAH mengirim isi data pengguna ke `konteks`.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Normalisasi pesan sebelum jadi sidik jari — cermin normalkan() di klien. */
function normalkan(pesan: string): string {
  return String(pesan || '')
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/\b\d[\d.,]*\b/g, '<n>')
    .replace(/["'`].*?["'`]/g, '<s>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/** djb2 — cukup untuk menggabungkan kejadian, bukan untuk kriptografi. */
function sidikJari(bagian: Array<string | null | undefined>): string {
  const s = bagian.filter(Boolean).join('|')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export interface LogErrorOpts {
  /** Nama fitur SEPERTI DIKENAL PENGGUNA ("Radar Harga", "AI Catat"). */
  fitur: string
  /** Yang sedang dikerjakan ("menarik harga SP2KP", "memanggil Gemini"). */
  aksi?: string
  error: unknown
  kode?: string | null
  tingkat?: 'error' | 'fatal' | 'warn'
  /** HANYA bentuk & besaran. Jangan pernah isi data pengguna. */
  konteks?: Record<string, unknown>
  /** 'edge' untuk permintaan pengguna, 'cron' untuk pekerjaan terjadwal. */
  sumber?: 'edge' | 'cron'
}

export async function catatErrorServer(o: LogErrorOpts): Promise<void> {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return

    const e = o.error as { message?: string; code?: string; stack?: string } | string | null
    const pesan = typeof e === 'string' ? e : (e?.message || String(e ?? '')).slice(0, 2000)
    if (!pesan) return

    const kode = o.kode ?? (typeof e === 'object' && e ? e.code ?? null : null)
    const sumber = o.sumber ?? 'edge'
    const sidik = sidikJari([sumber.slice(0, 2), o.fitur, kode, normalkan(pesan)])

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    await svc.rpc('catat_error', {
      p_sidik: sidik,
      p_pesan: pesan,
      p_sumber: sumber,
      p_fitur: o.fitur,
      p_aksi: o.aksi ?? null,
      p_kode: kode ? String(kode).slice(0, 60) : null,
      p_tingkat: o.tingkat ?? 'error',
      p_halaman: null,
      p_jejak: (typeof e === 'object' && e?.stack ? String(e.stack) : '').slice(0, 4000) || null,
      p_konteks: o.konteks ?? {},
      p_user_agent: null,
    })
  } catch {
    // Bisu, dengan sengaja. Lihat aturan 1 di kepala berkas.
  }
}
