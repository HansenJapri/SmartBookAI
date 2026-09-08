# Deploy BukuPintar AI ke Vercel

## A. Persiapan (sekali saja)
Pastikan sudah selesai di Supabase:
1. Jalankan `supabase/schema.sql` ✅ (sudah)
2. Jalankan `supabase/migration_auth.sql` (telepon unik)
3. Pasang SMTP Resend (agar OTP email & reset password terkirim)
4. Tambahkan `{{ .Token }}` pada template *Confirm signup* & *Reset Password*

## B. Deploy via Vercel CLI (paling cepat)
```bash
npm i -g vercel
vercel login          # ikuti instruksi (verifikasi via email)
vercel --prod         # deploy; jawab default; framework: Vite terdeteksi otomatis
```

Saat diminta Environment Variables (atau set di dashboard setelahnya), isi:
```
VITE_SUPABASE_URL   = https://vbzmtnpmtgrhovmwjqqk.supabase.co
VITE_SUPABASE_ANON_KEY = (anon key Anda)
VITE_PHONE_OTP      = false
```
Set lewat CLI:
```bash
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel env add VITE_PHONE_OTP production
vercel --prod    # deploy ulang agar env terpakai
```

## C. Deploy via Dashboard (alternatif, tanpa CLI)
1. Push project ini ke GitHub (repo baru).
2. Buka [vercel.com](https://vercel.com) → **Add New → Project** → import repo.
3. Framework otomatis terdeteksi **Vite**. Build: `npm run build`, Output: `dist`.
4. **Environment Variables** → tambahkan 3 variabel di atas.
5. **Deploy**.

## D. WAJIB setelah dapat domain Vercel
Agar email & redirect bekerja di domain produksi, di Supabase:
**Authentication → URL Configuration**
- **Site URL**: `https://nama-app-anda.vercel.app`
- **Redirect URLs**: tambahkan `https://nama-app-anda.vercel.app/reset-password`

Tanpa ini, link reset password dari email tidak mengarah ke domain yang benar.

## Catatan
- `vercel.json` sudah menyiapkan rewrite SPA → semua rute (mis. `/daftar`, `/app`)
  tidak akan 404 saat di-refresh.
- `VITE_SUPABASE_ANON_KEY` aman ditaruh di frontend (memang dirancang publik &
  dilindungi Row Level Security di database).
