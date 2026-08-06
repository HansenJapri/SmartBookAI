# Mitigasi Kerentanan Dependensi

> **Terakhir diperbarui** 5 Agustus 2026 · **Sumber** `npm audit --omit=dev`
> Dokumen ini memenuhi syarat Q-11 di `STRATEGI-QA-SMARTBOOKAI.md` §5.2:
> kerentanan *high* boleh ada **hanya bila mitigasinya tertulis**.
> Kerentanan *critical* tidak punya pengecualian (G-11) dan harus nol.

## Ringkasan status

| Paket | Severity | Status | Tindakan |
|---|---|---|---|
| `jspdf` | ~~critical~~ | **Selesai** | Naik 2.5.2 → 4.2.1 |
| `jspdf-autotable` | ~~high~~ | **Selesai** | Naik 3.8.4 → 5.0.8 |
| `dompurify` | ~~moderate~~ | **Selesai** | Ikut naik bersama jspdf |
| `react-router-dom` | high (sisa) | **Diterima, dimitigasi** | Naik 6.26.2 → 7.18.2; sisa advisory tidak berlaku |
| `xlsx` | high | **Diterima, dimitigasi** | Tidak ada perbaikan di registry npm |

Hasil `npm audit --omit=dev` setelah tindakan: **0 critical**, 3 high — seluruhnya
dijelaskan di bawah. **G-11 LULUS.**

---

## 1. `xlsx` (SheetJS) — high, tanpa perbaikan di npm

**Advisory**

| ID | Isu | Rentang terdampak |
|---|---|---|
| GHSA-4r6h-8v6p-xvw6 | Prototype Pollution | `< 0.19.3` |
| GHSA-5pgg-2g8v-p4x9 | ReDoS | `< 0.20.2` |

Versi terpasang `0.18.5`. Keduanya berlaku.

**Kenapa tidak sekadar dinaikkan.** SheetJS berhenti menerbitkan ke registry npm
sejak v0.20.x; versi terbaru hanya tersedia di `cdn.sheetjs.com`. `npm audit`
melaporkan *no fix available* karena memang tidak ada versi lebih baru di npm.
Pindah registri berarti menambah sumber paket di luar npm ke rantai pasok build —
keputusan yang lebih besar daripada satu `npm update`, dan harus diputuskan sadar.

**Paparan nyata di aplikasi ini**

| Jalur | Berkas | Sumber data | Terpapar? |
|---|---|---|---|
| Baca file Excel saat impor | `src/lib/csvImport.js:207` (`XLSX.read`) | **Berkas yang diunggah pengguna** | **Ya** |
| Tulis laporan Laba/Rugi | `src/pages/Reports.jsx:154` (`XLSX.utils`, `writeFile`) | Data milik pengguna sendiri | Tidak |
| Tulis Rekap Pajak | `src/pages/Reports.jsx:234` | Data milik pengguna sendiri | Tidak |

Hanya **satu** jalur memproses masukan yang tidak tepercaya: `XLSX.read()` saat
pengguna mengunggah berkas impor.

**Mitigasi yang berlaku**

1. **Berjalan di browser pengguna, bukan di server.** `xlsx` di-*import* dinamis
   di sisi klien. Prototype pollution atau ReDoS di sini merusak tab browser
   pengguna yang mengunggah berkasnya sendiri — bukan server, bukan pengguna lain.
   Tidak ada jalur `xlsx` di Edge Function mana pun.
2. **Tidak ada eskalasi lintas-tenant.** Parsing terjadi sebelum data menyentuh
   Supabase. RLS tetap menjadi batas otorisasi; hasil parsing yang rusak paling
   jauh membuat impor gagal, tidak memberi akses ke workspace lain.
3. **Penyerang = pengguna itu sendiri.** Untuk memicu, seseorang harus mengunggah
   berkas jahat ke akunnya sendiri. Bukan permukaan serangan jarak jauh.
4. **Impor selalu lewat pratinjau + centang manual.** Tidak ada baris yang
   tersimpan tanpa pengguna mencentangnya (alur E-4).

**Risiko sisa.** Tab browser pengguna bisa hang (ReDoS) bila mereka mengunggah
berkas yang dibuat khusus. Dampak: gangguan pada diri sendiri, bisa dipulihkan
dengan memuat ulang halaman.

**Rencana.** Tinjau ulang saat SheetJS kembali ke npm, atau bila jalur impor
dipindahkan ke server (yang akan mengubah penilaian ini sepenuhnya karena ReDoS
lalu menjadi masalah ketersediaan bersama). Alternatif yang layak dipertimbangkan
bila ingin lepas dari `xlsx`: `exceljs`.

**Tenggat tinjau ulang: 5 November 2026.**

---

## 2. `react-router-dom` — high, advisory sisa tidak berlaku

**Yang sudah diperbaiki.** Versi 6.26.2 terkena dua advisory yang **berlaku
langsung** untuk aplikasi SPA ini:

- Open redirect via backslash di `<Link>` dan `useNavigate` (bypass CVE-2025-68470)
- Arbitrary constructor injection via `deserializeErrors()`

Rentang terdampaknya `6.0.0 – 7.17.0` — **mencakup seluruh baris 6.x**. Artinya
tidak ada perbaikan yang tersedia tanpa naik ke React Router 7. Naik ke `7.18.2`
menutup keduanya.

> **Catatan jujur:** ini kenaikan versi MAYOR (6 → 7), bukan perbaikan
> non-breaking seperti yang semula diperkirakan. Perkiraan awal itu keliru —
> `npm audit` menandainya `fixAvailable: true`, padahal satu-satunya jalan keluar
> memang lintas mayor. Verifikasi yang sudah dijalankan: 565 unit/integration test
> lulus, build produksi sukses, dan seluruh test guard rute E2E lulus di tiga
> engine. Aplikasi ini memakai `BrowserRouter` dengan API yang tidak berubah di v7.

**Advisory yang tersisa.** `7.18.2` terkena GHSA baru: *RSC Mode CSRF Bypass
Allows Action Execution Before 400 Response* (rentang `>=7.12.0 <8.3.0`).

**Kenapa tidak berlaku di sini.** Advisory itu khusus **React Router RSC mode**
(React Server Components). Aplikasi ini adalah SPA murni Vite:

- Tidak memakai RSC — tidak ada `@vitejs/plugin-rsc` maupun server runtime React Router.
- Tidak memakai SSR — `index.html` statis, hidrasi penuh di klien.
- Tidak ada `action` server-side; seluruh mutasi lewat REST Supabase yang dijaga RLS.

Tidak ada permukaan yang bisa dicapai advisory ini.

**Kenapa saran `npm audit` tidak diikuti.** `npm audit` menyarankan turun ke
`7.11.0`. Itu justru **memperburuk keadaan**: menghindari advisory RSC yang tidak
berlaku, dengan harga mengembalikan open redirect yang **berlaku**.

**Rencana.** Naik ke `8.3.0` begitu rilis stabil dan jalur migrasinya jelas.

**Tenggat tinjau ulang: 5 November 2026.**

---

## Cara memverifikasi ulang

```bash
npm audit --omit=dev
```

Ambang yang berlaku: **0 critical** (G-11, tanpa pengecualian). Setiap *high*
yang muncul dan tidak tercatat di dokumen ini berarti Q-11 gagal — tambahkan
analisisnya di sini atau perbaiki paketnya.
