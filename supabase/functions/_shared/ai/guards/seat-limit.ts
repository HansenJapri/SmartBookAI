// ============================================================
// Batas anggota (seat) per workspace.
//
// Free Plan dibatasi 2 anggota (owner + 1 staf) supaya kuota AI 10/hari yang
// dibagi bersama tidak terasa rusak. Penegakan sebenarnya ada di trigger
// database (enforce_free_seat_limit); modul ini dipakai UI/endpoint agar
// pengguna mendapat PESAN UPGRADE yang jelas sebelum menabrak error database.
// ============================================================
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const FREE_PLAN_MAX_SEATS = 2

export interface SeatStatus {
  used: number
  max: number
  canInvite: boolean
  message?: string
}

export async function checkSeatLimit(
  supabase: SupabaseClient,
  maxSeats = FREE_PLAN_MAX_SEATS,
): Promise<SeatStatus> {
  const { data, error } = await supabase.rpc('ai_seat_count')
  if (error) {
    return { used: 0, max: maxSeats, canInvite: true }
  }
  const used = Number(data ?? 1)
  const canInvite = used < maxSeats
  return {
    used,
    max: maxSeats,
    canInvite,
    message: canInvite
      ? undefined
      : `Paket Free maksimal ${maxSeats} anggota (Anda + ${maxSeats - 1} staf). `
        + 'Untuk menambah anggota, tingkatkan paket. Kuota AI juga ikut bertambah '
        + 'karena dihitung per usaha, bukan per orang.',
  }
}

/** Payload error terstruktur saat batas seat tercapai. */
export function seatLimitPayload(status: SeatStatus) {
  return {
    error: status.message ?? 'Batas anggota tercapai.',
    code: 'SEAT_LIMIT_REACHED' as const,
    used: status.used,
    max: status.max,
  }
}
