# Runbook: AI mati, Radar kosong, Supabase dijeda

Ditulis 8 September 2026, setelah pemadaman yang berlangsung 32 hari tanpa
terdeteksi. Isinya bukan teori: setiap bagian menjawab satu hal yang benar-benar
terjadi dan satu hal yang, saat itu, tidak ada cara memeriksanya.

---

## 1. "Semua fitur AI mati" — periksa CORS DULU, bukan kunci Gemini

Ini kesimpulan paling penting dari pemadaman kemarin, dan yang paling
kontra-intuitif: **fitur AI yang mati serentak biasanya bukan masalah AI.**

Pada 8 September 2026, ketiga kunci Gemini sehat dan seluruh model masih
dilayani. Yang rusak adalah satu baris di blok CORS yang disalin ke sebelas
Edge Function. Aplikasi pindah ke domain kustom `smartbookai.id`, sementara
secret `APP_ORIGIN` masih berisi `https://smart-book-ai.vercel.app`. Origin tak
dikenal tetap dibalas `200` — tetapi dengan `Access-Control-Allow-Origin` milik
origin lain. Browser membuang respons preflight itu tanpa pernah mengirim POST.

Gejalanya sangat khas:

- Login, transaksi, semua data biasa **jalan normal** (itu lewat PostgREST/Auth,
  yang CORS-nya diurus Supabase, bukan kode kita).
- **Hanya** yang lewat Edge Function yang mati: seluruh fitur AI + harga Radar.
- Di log Supabase: deretan `OPTIONS | 200` **tanpa POST susulan**.

Kueri untuk memastikan:

```sql
select timestamp, event_message from logs
where source = 'function_edge_logs' order by timestamp desc limit 20;
```

Kalau terlihat OPTIONS tanpa POST, itu CORS. Uji langsung:

```bash
curl -s -i -X OPTIONS "https://hexaidoxmeycctpwfbst.supabase.co/functions/v1/harga-daerah" \
  -H "Origin: https://smartbookai.id" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
```

Header yang kembali **wajib sama persis** dengan origin yang dikirim. Kalau
berbeda — atau tidak ada — origin itu belum terdaftar.

**Cara menambah domain** (dua jalur, keduanya berlaku):

1. Tanpa deploy: `supabase secrets set APP_ORIGIN="https://a.com,https://b.com"`
   (dipisah koma).
2. Permanen & ter-review: tambahkan ke `ORIGIN_PRODUKSI` di
   [`supabase/functions/_shared/cors.ts`](supabase/functions/_shared/cors.ts).

`localhost`/`127.0.0.1` **port berapa pun** dan preview Vercel `smart-book-*`
sudah otomatis diizinkan — tidak perlu didaftarkan lagi.

---

## 2. "Kunci Gemini mati?" — jangan menebak, jalankan `ai-selftest`

```bash
curl -s -X POST "https://hexaidoxmeycctpwfbst.supabase.co/functions/v1/ai-selftest" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "x-selftest-token: <SELFTEST_TOKEN>" | jq .ringkasan
```

Atau masuk sebagai admin dan panggil tanpa `x-selftest-token`.

Yang dilaporkan:

- slot A/B/C: terisi dari env mana, **sidik jari** kunci (bukan kuncinya),
  diterima Google atau tidak, dan **sebab** kalau ditolak;
- setiap rute di `FEATURE_ROUTES` + `PLATFORM_ROUTES`: modelnya masih dilayani
  atau sudah dipensiunkan.

Memakai `ListModels`, jadi **tidak memakan kuota harian** yang sedang diperiksa.

Membaca hasilnya:

| Yang terlihat | Artinya | Tindakan |
|---|---|---|
| `HTTP 401 UNAUTHENTICATED` | Google tidak mengenali kunci — dicabut/dihapus | Buat kunci baru di AI Studio, `supabase secrets set GEMINI_KEY_A=...` |
| `HTTP 403` | Kunci dikenal, tapi API belum aktif / kunci dibatasi | Aktifkan Generative Language API, atau lepas pembatasan referer/IP |
| `HTTP 429` | Kunci **sah**, hanya kena batas laju | Tunggu; bukan kerusakan |
| `ruteMati` tidak kosong | Nama model sudah tidak dilayani | Perbarui `FEATURE_ROUTES` di `_shared/ai/config.ts` |

> **Catatan sidik jari:** per 8 September 2026, `GEMINI_KEY_B` dan
> `GEMINI_KEY_C` bersidik jari **sama** — keduanya kunci yang sama. Pemisahan
> slot jadi tidak memberi isolasi apa pun: satu kunci dicabut = dua slot mati
> bersamaan. Ganti salah satunya dengan kunci berbeda kalau isolasi itu memang
> diinginkan.

---

## 3. "Radar tidak menampilkan harga"

Urutannya dari hulu ke hilir; berhenti di titik pertama yang gagal.

```bash
# 1. Sumber resmi SP2KP Kemendag masih hidup?
curl -s "https://api-sp2kp.kemendag.go.id/report/api/latest-price-dates?tipe_komoditas_id=1"

# 2. Edge function-nya sendiri?  (curl TIDAK tunduk CORS — ini memisahkan
#    "server rusak" dari "browser diblokir")
curl -s -X POST "https://hexaidoxmeycctpwfbst.supabase.co/functions/v1/harga-daerah" \
  -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"province_id":0}' | head -c 300
```

```sql
-- 3. Cache-nya terisi?
select run_date, province_id, count(*), max(price_date)
from commodity_prices group by 1,2 order by 1 desc limit 5;
```

Kalau 1 dan 2 sehat tapi layar tetap kosong → **kembali ke bagian 1 (CORS)**.

---

## 4. Sinyal AI Radar palsu — kolom `ai_status`

Dulu, kegagalan Gemini tetap menulis 25 baris `direction='stabil', est 0..0` dan
menandai run `done`. Baris itu **tidak bisa dibedakan** dari "AI menilai harga
memang stabil", dan tampil di Radar sebagai "Perkiraan 30 hari: ±0%" selama 32
hari.

Sekarang:

- `macro_signals.ai_status` = `ok` hanya bila arah & estimasi benar-benar dari
  Gemini. UI **tidak menampilkan perkiraan** untuk nilai selain `ok`.
- `macro_runs.ai_status` / `ai_detail` / `ai_model` / `ai_tokens` merekam sebab
  teknisnya.
- Status run `done_tanpa_ai` (bukan `done`) membuat pemicu berikutnya boleh
  mencoba ulang, dibatasi jendela stale 10 menit.

```sql
-- Kapan terakhir AI makro benar-benar berhasil?
select run_date, ai_status, ai_model, ai_tokens, left(ai_detail, 120)
from macro_runs order by run_date desc limit 10;
```

---

## 5. Supabase gratis dijeda setelah 7 hari

**Yang perlu diluruskan:** cron yang hanya `insert into ...` **tidak cukup**.
pg_cron berjalan di dalam database dan tidak melahirkan satu pun permintaan API,
sedangkan aktivitas yang dihitung Supabase adalah permintaan yang masuk lewat
gerbang proyek (REST, Auth, Storage, Edge Function).

Karena itu rantainya dibuat memutar:

```
pg_cron -> pg_net (HTTP keluar) -> Edge Function keepalive -> PostgREST -> Postgres
```

- Jadwal: `0 2 1,7,13,19,25,31 * *` — jarak **terjauh 6 hari**, selalu di bawah
  ambang 7 hari, dengan margin satu hari penuh.
- Token cron dibuat **di dalam Postgres** dan disimpan di `service_config`;
  perintah cron memanggil `panggil_keepalive()` yang membacanya, jadi tidak ada
  rahasia yang tertulis di `cron.job.command`.

Uji manual:

```sql
select public.panggil_keepalive('uji-manual');
select id, beat_at, sumber, sehat, catatan from service_heartbeat
order by id desc limit 5;
```

Setiap detak juga merekam kesehatan (kunci Gemini, umur harga, umur kurs), jadi
`service_heartbeat` sekaligus menjadi jejak historis: "sejak kapan ini rusak?"
menjadi satu kueri, bukan penggalian log.

```sql
-- Ringkasan kesehatan kapan saja, tanpa memanggil apa pun
select public.ringkasan_kesehatan();
```

> **Dua proyek lain di akun ini** — `dashboard-database` dan `Datasense AI` —
> sudah berstatus INACTIVE karena tidak punya cron apa pun. Keduanya harus
> di-restore lewat Supabase Dashboard **lebih dulu** sebelum pola yang sama bisa
> dipasang di sana (pg_cron tidak berjalan di proyek yang dijeda).

---

## 6. Penjaga otomatis

`supabase/functions/_shared/ai/invariant_test.ts` — `deno test --allow-read --allow-env`.
Membaca berkas, tidak menyentuh jaringan. Test yang menjaga agar pemadaman
kemarin tidak bisa terulang diam-diam:

| Invarian | Menangkap |
|---|---|
| Tidak ada `ALLOWED_ORIGINS` lokal | Daftar origin tercecer lagi ke banyak berkas |
| Tidak ada `? origin : X[0]` | Membalas Allow-Origin milik origin **lain** |
| Semua fungsi ber-CORS pakai `_shared/cors.ts` | Fungsi baru menyalin pola lama |
| Tidak ada `Deno.env.get('GEMINI_*')` di luar `config.ts` | Kunci dibaca sendiri-sendiri |
| Tidak ada nama model di-hardcode | Rute tercecer di luar `config.ts` |
| Tidak ada rute ke keluarga model pensiun | `gemini-1.*`, `2.0`, `2.5` |
| Setiap rute (termasuk platform) punya `fallbackModel` berbeda | Cron/fitur bermodel tunggal |

Semuanya sudah dibuktikan **bisa merah**: bug lama dikembalikan sementara, test
gagal, lalu berkas dikembalikan.
