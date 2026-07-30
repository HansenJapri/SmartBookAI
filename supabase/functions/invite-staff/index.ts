// Supabase Edge Function — kirim email undangan staf (OPSIONAL).
// Deploy:  supabase functions deploy invite-staff
// Secret:  supabase secrets set RESEND_API_KEY=re_...
//          supabase secrets set INVITE_FROM="SmartBook AI <undangan@domain-anda.com>"
//          supabase secrets set APP_URL=https://smart-book-ai.vercel.app
//
// Undangan sudah SAH tanpa fungsi ini — barisnya tersimpan di staff_members dan
// muncul di aplikasi staf begitu dia login. Fungsi ini hanya memberi tahu lebih
// cepat lewat email. Karena itu semua kegagalan dikembalikan sebagai 200 dengan
// { sent: false, reason }, supaya klien tidak menampilkan error untuk hal yang
// tidak menggagalkan pengundangan.
//
// KEAMANAN:
// - Wajib JWT pemanggil; owner_id diambil dari JWT, BUKAN dari body.
// - Body hanya boleh berisi invite_id. Alamat tujuan diambil dari baris database
//   milik pemanggil — jadi fungsi ini tidak bisa dipakai mengirim email ke
//   alamat sembarangan (open relay).
// - Isi email tidak memuat token atau tautan penerimaan otomatis. Staf tetap
//   harus login dan menekan "Terima" di dalam aplikasi.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const INVITE_FROM = Deno.env.get('INVITE_FROM') || 'SmartBook AI <onboarding@resend.dev>'
const APP_URL = Deno.env.get('APP_URL') || 'https://smart-book-ai.vercel.app'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MODULE_LABEL: Record<string, string> = {
  operasional: 'Operasional',
  transaksi: 'Transaksi & Keuangan',
  produk: 'Gudang & Produk',
  hr: 'HR & Karyawan',
  analisis: 'Analisis & Laporan',
}

// Escape supaya nama usaha yang mengandung < atau & tidak merusak HTML email.
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ sent: false, reason: 'method_not_allowed' }, 405)

  try {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ sent: false, reason: 'unauthorized' }, 401)

    // Klien memakai JWT pemanggil, jadi RLS tetap berlaku: baris yang tidak
    // dimiliki pemanggil tidak akan terbaca sama sekali.
    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ sent: false, reason: 'unauthorized' }, 401)

    const body = await req.json().catch(() => ({}))
    const inviteId = String(body?.invite_id || '')
    if (!/^[0-9a-f-]{36}$/i.test(inviteId)) return json({ sent: false, reason: 'bad_invite_id' }, 400)

    const { data: row, error } = await supabase
      .from('staff_members')
      .select('id, email, modules, status, owner_id')
      .eq('id', inviteId)
      .eq('owner_id', user.id)          // hanya undangan milik pemanggil
      .eq('status', 'invited')
      .maybeSingle()
    if (error) return json({ sent: false, reason: 'lookup_failed' })
    if (!row) return json({ sent: false, reason: 'not_found_or_not_owner' }, 404)

    if (!RESEND_API_KEY) return json({ sent: false, reason: 'email_not_configured' })

    const { data: profile } = await supabase
      .from('profiles').select('business_name').eq('id', user.id).maybeSingle()
    const business = String(profile?.business_name || '').trim() || 'usaha di SmartBook AI'
    const mods = (row.modules || []).map((k: string) => MODULE_LABEL[k] || k).join(', ') || '-'

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: INVITE_FROM,
        to: [row.email],
        subject: `Undangan bergabung sebagai staf di ${business}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.6">
            <h2 style="margin:0 0 12px">Undangan staf — ${esc(business)}</h2>
            <p>Anda diundang bergabung sebagai <b>staf</b> di <b>${esc(business)}</b> pada aplikasi pembukuan SmartBook AI.</p>
            <p><b>Akses yang diberikan:</b> ${esc(mods)}</p>
            <p>Cara menerima:</p>
            <ol>
              <li>Masuk (atau daftar) di SmartBook AI memakai email <b>${esc(row.email)}</b> — harus email ini, bukan yang lain.</li>
              <li>Undangan akan muncul sebagai kartu di halaman utama. Tekan <b>Terima</b>.</li>
              <li>Setelah itu Anda bisa berpindah antara usaha sendiri dan ${esc(business)} lewat pengalih usaha di sidebar.</li>
            </ol>
            <p style="margin:20px 0">
              <a href="${APP_URL}/masuk" style="background:#001ec1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Masuk ke SmartBook AI</a>
            </p>
            <p style="color:#666;font-size:13px">Usaha Anda sendiri tetap milik Anda dan tidak terpengaruh. Jika Anda tidak mengenal pengirim undangan ini, abaikan saja email ini — tidak ada akses yang aktif sampai Anda menekan Terima.</p>
          </div>`,
      }),
    })

    if (!res.ok) {
      return json({ sent: false, reason: 'provider_error', status: res.status })
    }
    return json({ sent: true })
  } catch (_e) {
    // Sengaja tidak membocorkan detail internal ke klien.
    return json({ sent: false, reason: 'unexpected_error' })
  }
})
