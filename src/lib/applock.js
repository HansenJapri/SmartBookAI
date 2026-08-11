// Kunci layar (PIN) sisi-klien. Mengunci tampilan setelah 10 menit tidak aktif
// atau saat pengguna meninggalkan tab terlalu lama, lalu meminta PIN untuk
// membuka. Ini lapisan privasi tambahan untuk perangkat yang ditinggal, BUKAN
// pengganti autentikasi (sesi login Supabase tetap berlaku). PIN disimpan dalam
// bentuk hash di perangkat ini saja.

import { ambil, simpan, hapus, penyimpananTersedia } from './simpanLokal'

export const LOCK_TIMEOUT_MS = 10 * 60 * 1000 // 10 menit

const PIN = (uid) => `bukupintar_pin_${uid}`
const ACT = (uid) => `bukupintar_active_${uid}`
const LOCK = (uid) => `bukupintar_locked_${uid}`

export async function hashPin(pin) {
  const data = new TextEncoder().encode('bpai:' + String(pin))
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function hasPin(uid) { return uid ? !!ambil(PIN(uid)) : false }

/**
 * @returns {Promise<boolean>} false bila perangkat menolak penyimpanan lokal.
 *
 * Nilai baliknya BUKAN hiasan: kunci layar yang PIN-nya gagal tersimpan akan
 * tampak menyala lalu diam-diam tidak pernah mengunci apa pun. Pemanggil wajib
 * memberi tahu pengguna, bukan menganggapnya berhasil.
 */
export async function setPin(uid, pin) {
  if (!uid) return false
  const ok = simpan(PIN(uid), await hashPin(pin))
  if (!ok) return false
  markActive(uid)
  emitChange()
  return true
}
export function clearPin(uid) {
  if (!uid) return
  hapus(PIN(uid))
  hapus(LOCK(uid))
  emitChange()
}
export async function verifyPin(uid, pin) {
  return uid ? ambil(PIN(uid)) === await hashPin(pin) : false
}

export function markActive(uid) { if (uid) simpan(ACT(uid), String(Date.now())) }
export function lastActive(uid) { return uid ? (Number(ambil(ACT(uid))) || 0) : 0 }
export function isLocked(uid) { return uid ? ambil(LOCK(uid)) === '1' : false }
export function setLockedFlag(uid, v) {
  if (!uid) return
  if (v) simpan(LOCK(uid), '1')
  else hapus(LOCK(uid))
}

/** Kunci layar mustahil bekerja tanpa penyimpanan lokal (mode penyamaran). */
export function kunciLayarDidukung() { return penyimpananTersedia() }

export function requestLock(uid) { setLockedFlag(uid, true); emitChange() }

// Sinyal perubahan dalam tab yang sama (event 'storage' hanya lintas-tab).
export function emitChange() { try { window.dispatchEvent(new Event('bpai-applock')) } catch { /* abaikan */ } }
