// ---------- KEBIJAKAN PASSWORD ----------
// Min 8 karakter, ada huruf besar, huruf kecil, angka, dan simbol unik.
const SPECIALS = '!@#$%^&*()_+-=[]{};:\'",.<>/?\\|`~'

export function checkPassword(pw) {
  const s = pw || ''
  return {
    length: s.length >= 8,
    upper: /[A-Z]/.test(s),
    lower: /[a-z]/.test(s),
    digit: /[0-9]/.test(s),
    symbol: [...s].some((c) => SPECIALS.includes(c)),
  }
}

export function isPasswordValid(pw) {
  const c = checkPassword(pw)
  return c.length && c.upper && c.lower && c.digit && c.symbol
}

export const PASSWORD_RULES = [
  ['length', 'Minimal 8 karakter'],
  ['upper', 'Ada huruf besar (A-Z)'],
  ['lower', 'Ada huruf kecil (a-z)'],
  ['digit', 'Ada angka (0-9)'],
  ['symbol', 'Ada simbol (!@#$ dst.)'],
]

// ---------- NOMOR TELEPON (Indonesia → E.164) ----------
// Terima "08xxxx", "8xxxx", "+62xxxx", "62xxxx" → kembalikan "+62xxxx"
export function normalizePhone(input) {
  let s = (input || '').replace(/[\s\-().]/g, '')
  if (!s) return null
  if (s.startsWith('+62')) s = s.slice(3)
  else if (s.startsWith('62')) s = s.slice(2)
  else if (s.startsWith('0')) s = s.slice(1)
  if (!/^\d{8,13}$/.test(s)) return null
  return '+62' + s
}

export function isPhoneValid(input) {
  return normalizePhone(input) !== null
}

// ---------- EMAIL ----------
export function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')
}
