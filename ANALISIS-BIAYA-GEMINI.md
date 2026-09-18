# Analisis Biaya Gemini API — SmartBookAI

> **Tarif resmi terakhir diperiksa: 18 September 2026**
> Sumber: [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) ·
> [docs/models](https://ai.google.dev/gemini-api/docs/models) · [docs/billing](https://ai.google.dev/gemini-api/docs/billing)
>
> Diperbarui otomatis setiap hari pukul **15:00 WIB** oleh tugas terjadwal
> `perbarui-harga-gemini`. Pukul 15:00 WIB dipilih bukan sembarangan: itu juga
> saat penghitung kuota harian direset (tengah malam Pacific), jadi angka
> pemakaian yang dibaca selalu merupakan hari yang sudah utuh.

---

## 0. Ringkasan untuk yang tidak membaca sisanya

1. **Satu akun Free memakan paling banyak ~$1,45–$2,18 per bulan** dalam tagihan
   Gemini. Batasnya bukan token, melainkan 300 kredit — lihat §3.3.
2. **Tarif yang dipakai sistem sampai 17 September 2026 SALAH**, meleset 3–10×
   terlalu rendah. Sudah dikoreksi; seluruh biaya historis ikut terhitung ulang.
3. **Biaya suara (voice) tidak terlacak sama sekali** dalam angka USD di
   dashboard admin — bukan nol, melainkan tidak terhitung. Lihat §4.1.
4. **`hpp_draft` 6,2× lebih mahal per panggilan daripada `crud`** meski
   memakai 3,6× LEBIH SEDIKIT token. Token bukan proksi biaya.

---

## 1. Peta Fitur → Model → Tarif Resmi

### 1.1 Tarif resmi Google (USD per 1 juta token)

| Model | Masukan | Keluaran | Catatan |
|---|---:|---:|---|
| `gemini-3.5-flash-lite` | $0,30 | $2,50 | Model utama mayoritas fitur |
| `gemini-3.1-flash-lite` | $0,25 | $1,50 | Masukan **audio** ditagih $0,50 |
| `gemini-3.5-flash` | $1,50 | $9,00 | Kelas menengah, dipakai keluaran terstruktur |
| `gemini-3.1-flash-tts-preview` | $1,00 | $20,00 | **Keluaran termahal** di seluruh rute aplikasi |
| `gemini-3.1-flash-live-preview` | — | — | ⚠ **Tidak punya harga terbit** (lihat §1.3) |
| `gemini-3.8-live` *(penerus)* | $3,00 audio · $0,75 teks | $12,00 audio · $4,50 teks | Juga per menit: $0,005 masuk / $0,018 keluar |

### 1.2 Peta rute

Sumber kebenaran: `supabase/functions/_shared/ai/config.ts` → `FEATURE_ROUTES`.

| Fitur | Model utama | Model cadangan | Slot kunci | Batas harian | Tarif kredit |
|---|---|---|:---:|---:|---:|
| Chat Tanya AI | `gemini-3.5-flash-lite` | `gemini-3.1-flash-lite` | A | 10 kali | 1 |
| Insight AI Dashboard | `gemini-3.5-flash-lite` | `gemini-3.1-flash-lite` | A | 10 kali | 2 |
| Insight AI Stok | `gemini-3.5-flash-lite` | `gemini-3.1-flash-lite` | B | 10 kali | 2 |
| Pencatatan via AI (`crud`) | `gemini-3.5-flash-lite` | `gemini-3.1-flash-lite` | C | 10 kali | 1 |
| Baca struk (`ocr`) | `gemini-3.1-flash-lite` | `gemini-3.5-flash-lite` | C | 10 kali | 3 |
| Catat kalimat biasa | `gemini-3.5-flash` | `gemini-3.5-flash-lite` | C | 40 kali | 2 |
| Draf HPP | `gemini-3.5-flash` | `gemini-3.5-flash-lite` | C | 10 kali | 3 |
| Suara — percakapan | `gemini-3.1-flash-live-preview` | *(tidak ada)* | B | 10 menit | 5 / menit |
| Suara — TTS | `gemini-3.1-flash-tts-preview` | *(tidak ada)* | B | 10 menit | 5 / menit |
| *(platform)* Makro harian | `gemini-3.5-flash` | `gemini-3.1-flash-lite` | A | 1 / hari | — |

### 1.3 ⚠ Dua peringatan model

**`gemini-3.1-flash-live-preview` adalah model LEGACY.** Google menandainya
*"Legacy audio-to-audio preview model. We recommend updating to Gemini 3.8
Live"* dan **tidak menerbitkan harganya** di halaman pricing. Biaya suara di
sistem ini memakai tarif `gemini-3.8-live` sebagai **proksi**, bukan angka
resmi untuk model tersebut.

Ini risiko yang sudah pernah terwujud: pada 10 Agustus 2026 seluruh fitur AI
mati serentak tanpa satu baris kode berubah, karena Google memangkas kapasitas
keluarga yang sudah deprecated. Kedua rute suara **tidak punya `fallbackModel`**
— satu-satunya rute di seluruh aplikasi yang begitu. Migrasi ke `gemini-3.8-live`
layak dijadwalkan sebelum Google memutuskannya untuk kita.

**Tarif promo yang akan naik.** `gemini-3.6-flash`, `gemini-3.7-flash`, dan
`gemini-3.8-flash` kini $0,75/$3,75 **hanya sampai 31 Desember 2026**, lalu
naik **2×** menjadi $1,50/$7,50 pada 1 Januari 2027. Belum ada rute yang
memakainya, tapi bila nanti dipakai, anggarannya harus disusun pada tarif 2027.

---

## 2. Panduan Batas Anggaran Akun (Spending Limit)

Ada **tiga lapis** kendali, dan hanya dua yang benar-benar menghentikan biaya.

### 2.1 Melihat pemakaian — Google AI Studio

| Tujuan | Lokasi |
|---|---|
| Pemakaian & kuota | **Dashboard → Usage** |
| Biaya berjalan & plafon | **Spend** |

### 2.2 Menetapkan plafon biaya — AI Studio *(menghentikan biaya)*

**Spend → Monthly spend cap → Edit spend cap**

Plafon ini **menolak permintaan baru** setelah tercapai. Dua keterbatasan yang
disebut Google sendiri: fiturnya masih **eksperimental dan terbatas cakupannya**,
dan ada **kelebihan pemakaian pada jendela ±10 menit** karena latensi
penghitungan — jadi ia plafon lunak, bukan sakelar.

Selain itu ada plafon otomatis per tingkat penagihan yang **menjeda layanan
untuk SELURUH proyek** sampai siklus berikutnya:

| Tier | Plafon bulanan |
|---|---:|
| Free | — |
| Tier 1 | $250 |
| Tier 2 | $2.000 |
| Tier 3 | $20.000 – $100.000+ |

### 2.3 Budget & Alerts — Google Cloud Console *(TIDAK menghentikan biaya)*

**Billing → Budgets & alerts → Create budget**

- Dapat dibatasi ke satu **proyek** atau satu **layanan** (pilih *Generative
  Language API* untuk memisahkan biaya Gemini dari layanan lain).
- Ambang peringatan bawaan: **50%, 90%, 100%** dari nilai anggaran.
- **Anggaran ini hanya mengirim peringatan.** Kata Google sendiri: anggaran
  *"don't automatically cap usage or spending"* — ia memberi tahu, tidak
  mencegah. Menyangka sebaliknya adalah cara termahal untuk salah paham.
- Untuk membuatnya **bertindak**: pada wizard, **Manage notifications →
  connect a Pub/Sub topic to this budget**, lalu sambungkan ke fungsi yang
  mematikan penagihan secara terprogram. Butuh peran *Pub/Sub Admin*.

### 2.4 Penghentian keras

Satu-satunya rem yang pasti: **matikan billing pada proyek** lewat pengaturan
proyek di Cloud Console. Proyek turun ke Free Tier dan tidak bisa menagih apa pun.

### 2.5 Lapis milik aplikasi ini sendiri

Di luar kendali Google, SmartBookAI punya plafonnya sendiri per akun —
**Dashboard Admin → Kuota AI → Atur**: paket, kredit bulanan, anggaran token
bulanan, dan rem darurat harian. Ini yang berlaku *per pelanggan*; plafon
Google berlaku *per proyek*. Keduanya perlu, karena satu akun yang lepas
kendali tidak boleh menghabiskan plafon proyek milik semua akun.

---

## 3. Tabel Konversi Token Maksimal ke USD

### 3.1 Rasio input vs output — DIUKUR, bukan diasumsikan

Rasio ini menentukan segalanya, karena tarif keluaran **5–20× lebih mahal**
daripada masukan. Diambil dari `workspace_ai_usage` pada 18 September 2026:

| Fitur | Panggilan tercatat | Token/panggilan | Porsi masukan | Basis |
|---|---:|---:|---:|---|
| `crud` | 17 | 7.433 | **99,4%** | ✅ terukur |
| `chat` | 2 | 4.316 | **97,6%** | ⚠ terukur, sampel kecil |
| `hpp_draft` | 1 | 2.094 | **27,5%** | ⚠ terukur, sampel 1 |
| `catat`, `ocr`, `insight_*`, `makro` | 0 | — | — | ❌ **belum terukur** |
| `voice_*` | — | — | — | ❌ **tidak dicatat** (§4.1) |

Dua profil yang sangat berbeda:
- **Fitur ber-RAG** (`crud`, `chat`) hampir seluruhnya masukan — konteks
  agregat dikirim ulang tiap panggilan, jawabannya pendek.
- **Fitur penyusun draf** (`hpp_draft`) justru 72,5% keluaran — sisi yang mahal.

### 3.2 Biaya maksimal per fitur bila batas harian ditabrak habis

| Fitur | Model | Token maks/hari | Biaya/panggilan | **Maks USD/hari** | Basis |
|---|---|---:|---:|---:|---|
| Pencatatan via AI (`crud`) | 3.5-flash-lite | 74.330 | $0,002328 | **$0,0233** | ✅ terukur |
| Chat Tanya AI | 3.5-flash-lite | 43.160 | $0,001523 | **$0,0152** | ⚠ sampel kecil |
| Draf HPP | 3.5-flash | 20.940 | $0,014526 | **$0,1453** | ⚠ sampel 1 |
| Suara (10 menit) | 3.1-live *(proksi 3.8)* | tidak dicatat | $0,023/menit | **$0,2300** | ⚠ proksi |
| Catat kalimat biasa | 3.5-flash | belum terukur | — | **belum terukur** | ❌ |
| Baca struk (`ocr`) | 3.1-flash-lite | belum terukur | — | **belum terukur** | ❌ |
| Insight Dashboard | 3.5-flash-lite | belum terukur | — | **belum terukur** | ❌ |
| Insight Stok | 3.5-flash-lite | belum terukur | — | **belum terukur** | ❌ |

> Sel "belum terukur" **sengaja dibiarkan kosong**. Mengisinya dengan tebakan
> akan menghasilkan total yang terlihat seperti jawaban padahal bukan — dan
> angka inilah yang dipakai memutuskan harga paket.

**Yang paling menonjol:** `hpp_draft` memakai **3,6× lebih sedikit token**
daripada `crud`, tapi berbiaya **6,2× lebih mahal per panggilan**. Sebabnya
gabungan dua hal: model yang 5× lebih mahal per token masukan, dan keluaran
yang 72,5% — sisi yang ditagih 6× lipat masukan. Membatasi token tidak
membatasi biaya.

### 3.3 Plafon sebenarnya: kredit, bukan token

Untuk paket Free (**300 kredit/bulan**), tiap fitur punya "biaya per kredit"
yang berbeda. Yang termahal per kredit menentukan biaya maksimum akun:

| Fitur | Kredit/unit | Unit maks dari 300 kredit | Biaya/unit | Biaya/kredit | **Maks USD/bulan** |
|---|---:|---:|---:|---:|---:|
| Draf HPP | 3 | 100 panggilan | $0,014526 | **$0,004842** | **$1,45** |
| Suara | 5/menit | 60 menit | $0,023 | $0,004600 | $1,38 |
| Pencatatan via AI | 1 | 300 panggilan | $0,002328 | $0,002328 | $0,70 |
| Chat Tanya AI | 1 | 300 panggilan | $0,001523 | $0,001523 | $0,46 |

> **Biaya maksimum satu akun Free ≈ $1,45/bulan** (≈ Rp24.000), tercapai bila
> seluruh 300 kredit dibelanjakan di Draf HPP.
>
> Bila `catat` ternyata berperilaku seperti `hpp_draft` — model sama, keluaran
> terstruktur sama — biayanya $0,007263/kredit dan plafonnya naik jadi
> **$2,18/bulan**. Itu **skenario, bukan pengukuran**: `catat` belum pernah
> dipakai sekali pun. Mengukurnya adalah pekerjaan paling bernilai berikutnya,
> karena `catat` berbatas 40 panggilan/hari — tertinggi di seluruh aplikasi.

### 3.4 Plafon token per paket → rentang USD

Plafon token yang terpasang **tidak membatasi biaya dengan ketat**, karena
nilainya bergantung pada fitur mana yang membakarnya:

| Paket | Token/bulan | Termurah (3.1-lite, 99% masuk) | Termahal (3.5-flash, 72,5% keluar) | Rentang |
|---|---:|---:|---:|---:|
| Free | 2.500.000 | $0,66 | **$17,34** | 26× |
| Pro | 10.000.000 | $2,63 | **$69,38** | 26× |
| Bisnis | 35.000.000 | $9,19 | **$242,81** | 26× |
| Enterprise | tanpa batas | — | **tanpa batas** | — |

| Paket | Token/hari (rem darurat) | Termurah | Termahal |
|---|---:|---:|---:|
| Free | 625.000 | $0,16 | **$4,34** |
| Pro | 2.000.000 | $0,53 | **$13,88** |
| Bisnis | 7.000.000 | $1,84 | **$48,56** |

**Cara membaca tabel ini:** plafon token Free dikalibrasi pas untuk `crud`
(300 panggilan = 2,23 juta token, nyaris menyentuh 2,5 juta), tapi praktis
tidak pernah mengikat untuk fitur lain — 100 panggilan Draf HPP hanya memakai
8,4% plafonnya. Jadi **kredit yang mengikat lebih dulu**, hampir selalu.

---

## 4. Keterbatasan yang Diakui Terbuka

### 4.1 ⚠ Biaya suara tidak masuk hitungan USD sama sekali

`voice-live-token` memanggil `commitQuota(supabase, feature, seconds)` **tanpa
argumen telemetri**, sehingga `prompt_tokens` dan `completion_tokens` untuk
seluruh pemakaian suara tercatat **nol**. Akibatnya `ai_usd_range()` — sumber
seluruh angka USD di Dashboard Admin — mengembalikan **$0 untuk suara, berapa
pun pemakaiannya**.

Ini bukan "suara itu gratis", melainkan "suara tidak terhitung". Angka
$0,23/hari dan $1,38/bulan di §3.2–3.3 dihitung **manual di dokumen ini**, dan
tidak akan pernah muncul di layar admin sampai telemetri suara dipasang.

Kredit tetap terpotong dengan benar (5 kredit/menit), jadi pelanggan tetap
dibatasi — yang buta hanya sisi biayanya.

### 4.2 Sampel pengukuran masih sangat kecil

`hpp_draft` diukur dari **satu** panggilan, `chat` dari **dua**. Angka
token/panggilan bisa bergeser jauh begitu pemakaian nyata bertambah, dan
seluruh tabel §3 ikut bergeser. Perlakukan sebagai orde besaran, bukan
presisi dua desimal.

### 4.3 Model per baris pemakaian hanya "yang terakhir"

`workspace_ai_usage.last_model` menyimpan model **terakhir** hari itu untuk
fitur itu. Bila fallback sempat aktif di tengah hari, sebagian token
sebenarnya milik model cadangan dan dihargai keliru. Kesalahannya kecil karena
rantai fallback sengaja berpindah antar model sekelas, tapi bukan nol.

### 4.4 Token retry dihargai pada tarif keluaran

`wasted_tokens` (percobaan yang dibuang lalu diulang) tetap ditagih Google
tetapi tidak terpecah masukan/keluaran. Ia dihargai pada tarif **keluaran** —
yang lebih mahal — dengan sengaja: untuk alat anggaran, menaksir terlalu
tinggi lebih aman daripada terlalu rendah. Pada data nyata, token retry
mencapai **9,6%** dari total token akun teraktif.

---

## 5. Riwayat Koreksi

| Tanggal | Perubahan |
|---|---|
| 2026-09-17 | Tabel `ai_model_prices` dibuat dengan harga **placeholder** bertanda PERIKSA. |
| 2026-09-18 | Diganti tarif **resmi**. Seed lama meleset 3–10× terlalu rendah: flash-lite keluaran $0,40 → **$2,50**; 3.5-flash keluaran $2,50 → **$9,00**; TTS keluaran $2,00 → **$20,00**. Biaya tercatat akun teraktif naik dari $0,022 → **$0,087**. Baris `gemini-3.1-flash` dihapus (model tidak ada di dokumentasi mana pun). |

Harga disimpan dengan `effective_from`, jadi perubahan tarif **berlaku ke
depan** dan biaya bulan lalu tetap dihitung dengan harga bulan lalu. Koreksi
18 September dikerjakan sebagai perbaikan **di tempat** pada baris 2026-01-01,
bukan baris baru — karena angka lama bukan harga yang pernah berlaku,
melainkan placeholder yang salah sejak awal.

Koreksi harga dilakukan lewat **Dashboard Admin → Kuota AI → 💲 Harga model**,
bukan SQL Editor.
