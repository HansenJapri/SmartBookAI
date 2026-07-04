// Kunci layar (PIN) sisi-klien. Mengunci tampilan setelah 10 menit tidak aktif
// atau saat pengguna meninggalkan tab terlalu lama, lalu meminta PIN untuk
// membuka. Ini lapisan privasi tambahan untuk perangkat yang ditinggal, BUKAN
// pengganti autentikasi (sesi login Supabase tetap berlaku). PIN disimpan dalam
// bentuk hash di perangkat ini saja.

export const LOCK_TIMEOUT_MS = 10 * 60 * 1000 // 10 menit

const PIN = (uid) => `bukupintar_pin_${uid}`
const ACT = (uid) => `bukupintar_active_${uid}`
const LOCK = (uid) => `bukupintar_locked_${uid}`

export async function hashPin(pin) {
  const data = new TextEncoder().encode('bpai:' + String(pin))
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function hasPin(uid) { return uid ? !!localStorage.getItem(PIN(uid)) : false }
export async function setPin(uid, pin) {
  if (!uid) return
  localStorage.setItem(PIN(uid), await hashPin(pin))
  markActive(uid)
  emitChange()
}
export function clearPin(uid) {
  if (!uid) return
  localStorage.removeItem(PIN(uid))
  localStorage.removeItem(LOCK(uid))
  emitChange()
}
export async function verifyPin(uid, pin) {
  return uid ? localStorage.getItem(PIN(uid)) === await hashPin(pin) : false
}

export function markActive(uid) { if (uid) localStorage.setItem(ACT(uid), String(Date.now())) }
export function lastActive(uid) { return uid ? (Number(localStorage.getItem(ACT(uid))) || 0) : 0 }
export function isLocked(uid) { return uid ? localStorage.getItem(LOCK(uid)) === '1' : false }
export function setLockedFlag(uid, v) {
  if (!uid) return
  if (v) localStorage.setItem(LOCK(uid), '1')
  else localStorage.removeItem(LOCK(uid))
}

export function requestLock(uid) { setLockedFlag(uid, true); emitChange() }

// Sinyal perubahan dalam tab yang sama (event 'storage' hanya lintas-tab).
export function emitChange() { try { window.dispatchEvent(new Event('bpai-applock')) } catch { /* abaikan */ } }
