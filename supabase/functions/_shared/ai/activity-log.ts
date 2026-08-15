// ============================================================
// LOG AKTIVITAS AI — siapa memakai fitur AI apa, kapan, berhasil atau tidak.
//
// Terpisah dari audit_logs, dan itu disengaja. audit_logs adalah jejak
// PERUBAHAN DATA: kolomnya table_name / action (INSERT/UPDATE/DELETE) / row_id
// / changed. Mode Tanya tidak mengubah apa pun, jadi memasukkannya ke sana
// merusak makna tabel itu sekaligus membanjirinya — satu baris per pertanyaan.
//
// TIDAK MENYIMPAN TEKS PERTANYAAN. Menyimpannya berarti pemilik usaha bisa
// membaca setiap kalimat yang diketik stafnya ke asisten; itu pengawasan
// karyawan, menimbulkan kewajiban PDP tersendiri, dan tidak dibutuhkan untuk
// menjawab "fitur AI dipakai siapa, kapan, berhasil atau tidak".
//
// `meta` hanya boleh memuat metadata terstruktur — nama domain, nama entitas,
// operasi. Jangan pernah menaruh kalimat pengguna di sana.
// ============================================================

export type HasilAktivitas = 'ok' | 'gagal' | 'limit'

/**
 * Catat satu pemakaian fitur AI.
 *
 * TIDAK PERNAH MELEMPAR. Kegagalan mencatat jejak tidak boleh menggagalkan
 * jawaban yang sudah berhasil dibuat — pengguna kehilangan jawabannya, dan
 * kuotanya sudah terpakai. Kegagalan di sini ditelan diam-diam dengan sengaja;
 * yang hilang adalah satu baris jejak, bukan pekerjaan pengguna.
 */
export async function catatAktivitasAI(
  supabase: any,
  opsi: {
    owner: string
    feature: string
    outcome?: HasilAktivitas
    meta?: Record<string, unknown>
    /**
     * Telemetri teknis. Kolomnya sengaja TERPISAH dari `meta`, bukan diselipkan
     * ke dalamnya: angka yang akan diagregasi (rata-rata latency, p95, total
     * token) harus bisa di-index dan dijumlahkan SQL biasa. Menyimpannya di
     * jsonb berarti setiap grafik admin membayar ongkos parse di setiap baris.
     */
    model?: string
    keySlot?: string
    latencyMs?: number
    tokensIn?: number
    tokensOut?: number
    usedFallback?: boolean
    /** GeminiFailureCode saat outcome='gagal' — sebab, bukan sekadar "gagal". */
    errorCode?: string
  },
): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser()
    const actor = data?.user?.id
    if (!actor || !opsi.owner) return

    const n = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null

    await supabase.from('ai_activity_log').insert({
      owner_id: opsi.owner,
      actor_id: actor,
      feature: opsi.feature,
      outcome: opsi.outcome ?? 'ok',
      meta: opsi.meta ?? null,
      model: opsi.model ?? null,
      key_slot: opsi.keySlot ?? null,
      latency_ms: n(opsi.latencyMs),
      tokens_in: n(opsi.tokensIn),
      tokens_out: n(opsi.tokensOut),
      used_fallback: typeof opsi.usedFallback === 'boolean' ? opsi.usedFallback : null,
      error_code: opsi.errorCode ?? null,
    })
  } catch {
    // sengaja diabaikan — lihat catatan di atas
  }
}
