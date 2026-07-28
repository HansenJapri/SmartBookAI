# PANDUAN EKSEKUSI TEST — BukuPintar AI (SmartBookAI)

Panduan langkah-per-langkah untuk menjalankan **seluruh** paket test yang baru ditambahkan (Vitest unit/integration, Postman/Newman API, Playwright E2E) dan membaca hasilnya. Semua perintah ditulis untuk shell Windows (PowerShell/CMD) — sama untuk macOS/Linux kecuali penanda variabel env.

---

## 0. Ringkasan File yang Dibuat

| Path | Tipe | Fungsi |
|---|---|---|
| `src/lib/radar.js` | Helper murni (baru) | `expectedRunKey`, `priceFreshness`, `priceDelta`, `buildSignalInput`, `normalizeSignal` — ekstraksi logika Radar |
| `src/lib/ragPrice.js` | Helper murni (baru) | `isTrusted`, `domainOf`, `finalUrl`, `numberAppearsIn`, `parseRupiahMentions`, `pickCommodityPrice`, `selectRagPrices`, `TRUSTED_DOMAINS` — ekstraksi grounding RAG |
| `src/lib/aiSummary.js` | Helper murni (baru) | `buildAggregateSummary`, `SENSITIVE_FIELDS` — kontrak privasi payload LLM |
| `src/lib/__tests__/radar.test.js` | Vitest unit | 4 describe, 15 test — hari-data 06.00 WIB, freshness, delta, anti-bloat |
| `src/lib/__tests__/ragPrice.test.js` | Vitest unit | 6 describe, 26 test — allowlist, Bing redirect, grounding angka, **nearest-name-wins**, Strategy AI-up/down |
| `src/lib/__tests__/aiSummary.test.js` | Vitest unit | 8 test — total agregat, **PII tak bocor**, top kategori, WoW, low-stock |
| `src/lib/__tests__/radar.ai.integration.test.js` | Vitest integration | 6 test — facade `ai.js` (`hargaDaerah`, `makroRefresh`, `askAI`) via mock Supabase |
| `postman/BukuPintar-Edge.postman_collection.json` | Postman v2.1 | 3 folder, 11 request — kontrak HTTP edge functions |
| `postman/BukuPintar-Edge.staging.postman_environment.json` | Postman env | `base`, `anon`, `jwt`, `origin` |
| `e2e/radar.authenticated.spec.js` | Playwright | 4 skenario Radar (grounding, fallback provinsi, edge tumbang, anti-race) |
| `e2e/chatbot.authenticated.spec.js` | Playwright | 2 skenario Chatbot (human-in-loop mode Catat, tolakan lingkup mode Tanya) |

Tidak ada berkas Supabase Edge Function yang di-redeploy. Semua helper adalah cerminan lokal dari aturan yang sudah tegak di edge.

---

## 1. Prasyarat Sekali Saja

```bash
# di root repo
npm install             # jika belum: pastikan @playwright/test & vitest ter-install
npx playwright install  # unduh browser (sekali per mesin) — hanya untuk E2E
npm i -g newman         # untuk API test headless (Postman CLI)
```

Buat `.env` di root (bila belum ada) untuk Vite:

```
VITE_SUPABASE_URL=https://hexaidoxmeycctpwfbst.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key dari Supabase Dashboard>
```

> Vitest unit test **tidak** butuh `.env` (`src/lib/__tests__` mem-mock Supabase). E2E dan Postman **butuh** akun/JWT uji — dijelaskan di bagian relevan.

---

## 2. Menjalankan Vitest (Unit + Integration)

### 2.1 Semua test sekaligus

```bash
npm test
```

Ini menjalankan `vitest run` sesuai `package.json`. Waktu ~2–5 detik. Output ideal:

```
 ✓ src/lib/__tests__/radar.test.js  (15)
 ✓ src/lib/__tests__/ragPrice.test.js  (26)
 ✓ src/lib/__tests__/aiSummary.test.js  (8)
 ✓ src/lib/__tests__/radar.ai.integration.test.js  (6)
 ✓ src/lib/__tests__/api.integration.test.js  (existing)
 ✓ src/lib/__tests__/logic.test.js  (existing)
 ...
 Test Files  N passed  |  0 failed
 Tests       X passed  |  0 failed
```

### 2.2 Menjalankan satu file

```bash
npx vitest run src/lib/__tests__/ragPrice.test.js
```

### 2.3 Mode watch (saat mengembangkan)

```bash
npx vitest
```

Simpan berkas → test terkait auto-jalan. Tekan `q` untuk keluar, `p` untuk filter berkas, `t` untuk filter nama test.

### 2.4 Menjalankan hanya satu describe / test

```bash
npx vitest run -t "nearest name wins"
```

### 2.5 Membaca hasil

- **Hijau `✓`** = test lulus. Nol tindakan.
- **Merah `✗`** dengan diff `Expected` vs `Received` = assertion gagal. Yang perlu dilakukan: baca diff, buka file test → lihat aturan yang dites → cek helper yang bersangkutan. Perbaiki **satu** sisi (helper atau ekspektasi test) tergantung apakah aturan berubah atau kode salah.
- **Kuning `↓`** = test di-`skip` — biasanya kondisional (mis. E2E tanpa env).

### 2.6 Coverage (opsional)

```bash
npx vitest run --coverage
```

Butuh `@vitest/coverage-v8` (`npm i -D @vitest/coverage-v8`). Hasil di `coverage/index.html`. Target realistis untuk `src/lib/*.js`: ≥ 85%.

---

## 3. Cara Menerjemahkan Kegagalan Vitest ke Aksi

Tabel keputusan cepat — kalau test X gagal, artinya Y, tindakan Z:

| Test yang gagal | Artinya | Tindakan |
|---|---|---|
| `radar.test.js` > `expectedRunKey ... jam 04:00 WIB -> kunci = kemarin` | Batas hari 06:00 WIB bergeser | Periksa `WIB_OFFSET_MS` di `radar.js`; sinkronkan dgn `runKeyWIB()` di edge `makro-harian` |
| `ragPrice.test.js` > `menolak subdomain palsu (kontan.co.id.attacker.com)` | Allowlist bocor | JANGAN longgarkan test; perbaiki `isTrusted` — subdomain sah = `endsWith('.'+d)`, bukan `.includes` |
| `ragPrice.test.js` > `menolak angka milik produk tetangga` | Anti-distractor rusak | Bug krusial. `preNeg > preKw` di `pickCommodityPrice` harus lolos. Cek regex urutan |
| `aiSummary.test.js` > `tidak pernah memuat nama pelanggan / no rekening` | **PII bocor** | Prioritas P0. Cek `WHITELIST` di `aiSummary.js`; setiap kolom baru harus di-review sebelum masuk |
| `radar.ai.integration.test.js` > `meneruskan province_id dengan nama fungsi tepat` | Nama edge fn berubah | Sinkronkan `ai.js` dan Postman collection |

---

## 4. Menjalankan Postman / Newman (API kontrak)

### 4.1 Persiapan environment

Edit `postman/BukuPintar-Edge.staging.postman_environment.json`:
- `anon` → anon key dari Supabase Dashboard → Settings → API.
- `jwt` → JWT sesi akun uji. Cara mendapatkannya di 4.2.
- `origin` → `http://localhost:5173` (default) atau domain deploy Anda.

### 4.2 Mendapatkan JWT akun uji (satu kali per hari)

Buat akun uji khusus (JANGAN pakai akun produksi). Di browser dev-console halaman aplikasi:

```javascript
// setelah login manual sebagai akun uji
(await window.supabase?.auth.getSession())?.data?.session?.access_token
```

Atau via CLI dengan Node script sederhana:

```javascript
// scripts/getjwt.mjs
import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
const { data, error } = await s.auth.signInWithPassword({
  email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD,
})
if (error) { console.error(error); process.exit(1) }
console.log(data.session.access_token)
```

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... TEST_EMAIL=uji@bukupintar.test TEST_PASSWORD=... \
  node scripts/getjwt.mjs
```

Tempelkan hasilnya ke field `jwt` di env file.

### 4.3 Jalankan

```bash
newman run postman/BukuPintar-Edge.postman_collection.json \
  -e postman/BukuPintar-Edge.staging.postman_environment.json \
  --reporters cli,junit --reporter-junit-export postman/newman-report.xml
```

Output ideal:

```
BukuPintar-Edge

❏ BukuPencatatan
↳ tanya-valid (200)
  POST https://hexaidoxmeycctpwfbst.functions.supabase.co/.../BukuPencatatan [200 OK, 5.2s]
  ✓  status 200
  ✓  waktu respons < 8000ms
  ✓  reply berupa string non-kosong
  ✓  tidak memuat pesan error server
...

┌─────────────────────────┬──────────┬──────────┐
│                         │ executed │   failed │
├─────────────────────────┼──────────┼──────────┤
│              iterations │        1 │        0 │
│                requests │       11 │        0 │
│            test-scripts │       11 │        0 │
│      prerequest-scripts │        1 │        0 │
│              assertions │       25 │        0 │
```

### 4.4 Membaca kegagalan Postman/Newman

- **Timeout / connection refused** = env `base` salah atau Edge belum deploy.
- **status 401 padahal test butuh 200** = JWT expired (biasanya 1 jam). Ambil ulang.
- **kuota `bump_ai_usage` 60 → 429** pada tanya-valid = akun uji sudah dipakai 60x hari ini. Ganti akun atau tunggu reset harian.
- **CORS preflight ≠ origin yang dikirim** = `APP_ORIGIN` di secret Supabase tidak menyertakan origin uji Anda. Tambahkan `APP_ORIGIN=<origin>` di dashboard fungsi → deploy ulang.

### 4.5 Rate-limit test (429) — sengaja dipisah

Test `message-terlalu-panjang` aman untuk CI (ditolak sebelum menyentuh kuota). Uji 429 nyata (memancing limit) TIDAK ada dalam koleksi ini karena akan menghabiskan kuota harian akun uji. Bila ingin: jalankan `tanya-valid` 61x berturut dengan Runner terpisah pada akun uji khusus.

---

## 5. Menjalankan Playwright (E2E ter-login)

### 5.1 Setup akun uji

Buat akun email khusus test di aplikasi (mis. `e2e@bukupintar.test`). Simpan kredensialnya sebagai env var:

```powershell
# PowerShell
$env:E2E_EMAIL="e2e@bukupintar.test"
$env:E2E_PASSWORD="password-uji-yang-kuat"
```

```bash
# bash/zsh
export E2E_EMAIL="e2e@bukupintar.test"
export E2E_PASSWORD="password-uji-yang-kuat"
```

Bila env ini KOSONG, semua test ter-login akan `skip` dengan aman (CI tetap hijau).

### 5.2 Jalankan seluruh E2E

```bash
npm run test:e2e
```

Alur otomatis di `playwright.config.js`:
1. `npm run build && npm run preview` menyalakan server di `:5173`.
2. Proyek `setup` (`auth.setup.js`) login sekali, simpan sesi ke `e2e/.auth/user.json`.
3. Proyek `chromium` (publik) menjalankan spec tanpa auth.
4. Proyek `chromium-auth` menjalankan spec ter-login (termasuk file baru Anda) memakai storageState.

### 5.3 Jalankan hanya satu file

```bash
npx playwright test e2e/radar.authenticated.spec.js
```

### 5.4 Mode debug / UI

```bash
npx playwright test --ui              # visual test runner
npx playwright test --debug           # step-through, pause di setiap aksi
npx playwright test --headed          # buka browser terlihat (bukan headless)
```

### 5.5 Lihat laporan HTML

```bash
npx playwright show-report
```

Terbuka di `http://localhost:9323`. Test yang gagal punya trace + screenshot + video (config: `trace: on-first-retry`).

### 5.6 Membaca kegagalan Playwright

- **`locator.click: element is not visible`** = selector kena elemen tersembunyi. Buka trace viewer → time-travel → periksa DOM snapshot pada waktu klik.
- **`expect(...).toBeVisible: timeout 5000ms exceeded`** = elemen tak muncul dalam 5s. Bisa karena route stub belum kena. Jalankan ulang dengan `--trace on` untuk lihat network log.
- **Test `radar.spec.js` / `chatbot.spec.js` (bukan `.authenticated`)** = **selalu skip**. Ini stub sengaja, isi nyata ada di `.authenticated.spec.js`.
- **Sesi kadaluarsa** (`main#main-content not found` di test ter-login) = hapus `e2e/.auth/user.json`, jalankan ulang → `auth.setup.js` login lagi.

---

## 6. Alur Pengujian Ideal (Urutan Dieksekusi)

Dari yang paling cepat & paling murah ke yang paling lambat/mahal — hentikan di lapisan pertama yang merah.

```
1. Vitest unit             (npm test)              ~3 detik   — logika helper
2. Vitest integration      (masuk di npm test)     ~3 detik   — facade ai.js
3. Postman/Newman API      (newman run ...)        ~30 detik  — kontrak HTTP edge
4. Playwright E2E          (npm run test:e2e)      ~2-5 menit — perilaku UI end-to-end
```

Alasan urutan ini: **fail-fast**. Kalau unit test gagal, tidak ada gunanya jalankan E2E (waste). Kalau kontrak API putus, E2E hampir pasti ikut merah.

### Sebagai gerbang CI (rekomendasi minimum)

```yaml
# .github/workflows/test.yml (referensi, TIDAK dibuat file ini)
- run: npm ci
- run: npm test                     # gate 1: Vitest
- run: newman run postman/...       # gate 2: kontrak API (butuh secret JWT)
- run: npx playwright install --with-deps
- run: npm run test:e2e             # gate 3: E2E (butuh E2E_EMAIL/PASSWORD)
```

---

## 7. Peta Cakupan Test → Aturan yang Dilindungi

| Aturan bisnis / keamanan | Test yang mengunci | Kalau test hilang, risiko |
|---|---|---|
| Batas hari data 06:00 WIB | `radar.test.js > expectedRunKey` | Radar tampilkan data usang pagi hari |
| Harga stale ditandai | `radar.test.js > priceFreshness` | UI menampilkan harga 3 hari lalu sebagai "terbaru" |
| Delta % tak jalan tanpa baseline | `radar.test.js > priceDelta` | Persentase palsu (baseline=0 → NaN/Infinity) |
| Payload LLM tak membengkak | `radar.test.js > buildSignalInput` | Biaya token meledak; JSON terpotong |
| Kontrak output LLM ternormalisasi | `radar.test.js > normalizeSignal` | UI crash karena `direction` = "meledak" |
| Allowlist domain berita | `ragPrice.test.js > isTrusted (subdomain palsu)` | RAG memakan sumber palsu; source grounding batal |
| Angka wajib terverifikasi di teks | `ragPrice.test.js > numberAppearsIn` | Halusinasi angka harga |
| Anti-distractor (nearest name wins) | `ragPrice.test.js > pickCommodityPrice` | Harga Solar tertukar jadi Pertalite |
| Fallback aman saat LLM tumbang | `ragPrice.test.js > selectRagPrices AI-down` | Angka tanpa satuan/konfirmasi tetap tersimpan |
| **PII tidak bocor ke LLM** | `aiSummary.test.js > tidak pernah memuat nama pelanggan` | Pelanggaran UU PDP |
| Facade ai.js memanggil edge yg benar | `radar.ai.integration.test.js` | Nama edge salah → 404 senyap |
| Kontrak HTTP edge (status codes) | `Postman` folder BukuPencatatan/harga-daerah | Klien gagal membaca error; UI hang |
| Idempotensi pipeline harian | `Postman makro-harian trigger-kedua` | Kerja ganda + biaya AI ganda |
| Human-in-the-loop mode Catat | `chatbot.authenticated.spec.js > mode Catat` | AI menyimpan transaksi tanpa persetujuan |
| Tolakan lingkup baku | `chatbot.authenticated.spec.js > mode Tanya` | Asisten bicara di luar keuangan usaha |
| Source grounding di UI | `radar.authenticated.spec.js > lineage sumber` | Angka tampil tanpa link sumber |
| Degradasi anggun saat edge tumbang | `radar.authenticated.spec.js > Edge tumbang` | White screen saat outage |
| Race condition provinsi | `radar.authenticated.spec.js > anti race` | Data provinsi salah menempel |

---

## 8. Troubleshooting Cepat

| Gejala | Kemungkinan sebab | Fix |
|---|---|---|
| `Cannot find module '../radar'` di Vitest | Helper belum ada / salah path | Konfirmasi `src/lib/radar.js` (bukan `radar.jsx`) |
| `vi.mock is hoisted; import 'supabase' error` | Import supabase di top-level test | Jangan; gunakan pola `const api = await import(...)` seperti `api.integration.test.js` |
| `newman: command not found` | Belum install global | `npm i -g newman` |
| `502 Bad Gateway` di Postman `BukuPencatatan` | `GEMINI_API_KEY` belum diset di secret Supabase | Set di dashboard → Edge Functions → Secrets |
| Playwright `net::ERR_CERT_AUTHORITY_INVALID` | HTTPS lokal | Test kita HTTP `:5173`, tidak seharusnya terjadi |
| E2E `chromium` fail di `radar.spec.js`/`chatbot.spec.js` | File stub tak sengaja diaktifkan | Isi harus `test.skip('placeholder ...')` — jangan diubah |

---

## 9. Kapan Menambah Test Baru

Aturan praktisnya: **satu test per aturan yang benar-benar dipedulikan bisnis**. Bukan satu test per baris kode.

- Aturan baru muncul di edge function atau helper? Tulis unit test dulu (Vitest), baru implementasi (TDD).
- API baru muncul? Tambah folder di Postman collection dengan minimal 3 request: happy + validasi input + auth/otorisasi.
- Alur UI baru yang berisiko uang/data? Tambah E2E `.authenticated.spec.js` dengan network stub — jangan uji jaringan sungguhan (flaky).

Selesai.
