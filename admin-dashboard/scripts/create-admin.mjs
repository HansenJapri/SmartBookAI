// ============================================================
//  Pembuat akun ADMIN (dijalankan SEKALI, dari sisi backend)
//  Menggunakan service_role key Supabase → akun langsung
//  terverifikasi (email_confirm) sehingga kamu tinggal login.
//
//  Cara pakai:
//    1. Pastikan migrasi SQL (supabase/migration_admin.sql) sudah dijalankan.
//    2. Isi SUPABASE_SERVICE_ROLE_KEY di admin-dashboard/.env
//       (Supabase Dashboard → Project Settings → API → service_role secret).
//    3. Dari folder admin-dashboard:  npm run create-admin
// ============================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// ---- Loader .env sederhana (tanpa dependency tambahan) ----
const __dirname = dirname(fileURLToPath(import.meta.url))
function loadEnv() {
  const env = { ...process.env }
  try {
    const raw = readFileSync(join(__dirname, '..', '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i === -1) continue
      const k = t.slice(0, i).trim()
      const v = t.slice(i + 1).trim()
      if (!(k in env) || !env[k]) env[k] = v
    }
  } catch { /* .env opsional jika sudah lewat process.env */ }
  return env
}

const env = loadEnv()
const URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

function fail(msg) { console.error('\n❌ ' + msg + '\n'); process.exit(1) }

if (!URL) fail('VITE_SUPABASE_URL tidak ditemukan di .env')
if (!SERVICE_KEY) fail(
  'SUPABASE_SERVICE_ROLE_KEY belum diisi.\n' +
  '   Buka Supabase, Project Settings, API, salin "service_role" secret,\n' +
  '   lalu tempel ke admin-dashboard/.env pada baris SUPABASE_SERVICE_ROLE_KEY=')

// Kredensial admin. Password TIDAK disimpan di dalam kode (alasan keamanan).
// Berikan lewat environment variable atau baris ADMIN_PASSWORD= di .env (sudah di-gitignore).
const ADMIN_EMAIL = env.ADMIN_EMAIL || 'hansenj5206@gmail.com'
const ADMIN_PASSWORD = env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) fail(
  'ADMIN_PASSWORD belum diisi (demi keamanan tidak lagi ditanam di kode).\n' +
  '   PowerShell:  $env:ADMIN_PASSWORD="kata-sandi-anda"; npm run create-admin\n' +
  '   atau tambah baris  ADMIN_PASSWORD=kata-sandi-anda  di admin-dashboard/.env')

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function findUserByEmail(email) {
  // listUsers dipaginasi; cari di beberapa halaman pertama.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const found = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
    if (found) return found
    if (data.users.length < 1000) break
  }
  return null
}

async function main() {
  console.log('\n🔧 Membuat / memperbarui akun admin:', ADMIN_EMAIL)

  let user = null
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,                       // ← langsung terverifikasi
    user_metadata: { business_name: 'Administrator', owner_name: 'Admin' },
  })

  if (createErr) {
    const msg = (createErr.message || '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      console.log('ℹ️  Akun sudah ada — memperbarui password & memastikan terverifikasi…')
      user = await findUserByEmail(ADMIN_EMAIL)
      if (!user) fail('Akun terdeteksi ada tapi tidak ditemukan via listUsers. Cek dashboard Supabase.')
      const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
        password: ADMIN_PASSWORD, email_confirm: true,
      })
      if (updErr) fail('Gagal memperbarui akun: ' + updErr.message)
    } else {
      fail('Gagal membuat akun: ' + createErr.message)
    }
  } else {
    user = created.user
    console.log('✅ Akun auth dibuat.')
  }

  // Daftarkan sebagai SATU-SATUNYA admin.
  const { error: admErr } = await admin
    .from('admins')
    .upsert({ user_id: user.id, email: ADMIN_EMAIL }, { onConflict: 'user_id' })
  if (admErr) fail(
    'Akun auth OK, tapi gagal menulis ke tabel public.admins:\n   ' + admErr.message +
    '\n   → Pastikan supabase/migration_admin.sql sudah dijalankan lebih dulu.')

  console.log('✅ Terdaftar di tabel admins (user_id: ' + user.id + ').')
  console.log('\n🎉 Selesai! Login ke Dashboard Admin dengan:')
  console.log('     Email    : ' + ADMIN_EMAIL)
  console.log('     Password : ' + ADMIN_PASSWORD)
  console.log('\n   Jalankan dashboard:  npm run dev   →  http://localhost:5174\n')
  console.log('   ⚠️  Demi keamanan, kamu boleh menghapus SUPABASE_SERVICE_ROLE_KEY dari .env sekarang.\n')
}

main().catch((e) => fail(e.message || String(e)))
