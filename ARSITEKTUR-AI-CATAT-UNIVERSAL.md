# ARSITEKTUR — AI CATAT SEBAGAI UNIVERSAL ACTION AGENT

**Versi:** 1.0 · **Tanggal:** 3 Agustus 2026
**Basis:** pembacaan kode aktual + inspeksi skema database produksi (`hexaidoxmeycctpwfbst`, 42 tabel) per 3 Agustus 2026.
**Status:** dokumen desain — belum ada migrasi yang dijalankan.

---

## 0. KEPUTUSAN YANG MENGUNCI DESAIN INI

| # | Pertanyaan | Keputusan pemilik produk |
|---|---|---|
| 1 | Arti `status: "READY"` | **(a) Draft → konfirmasi manual.** AI tidak pernah menulis ke database sendiri untuk aksi finansial |
| 2 | Aksi komposit satu kalimat | **Dibuka.** Satu kalimat boleh memicu beberapa penulisan, dalam satu transaksi database atomik |
| 3 | Entitas pelanggan | **Buat tabel `customers`** — CRM jadi entitas sungguhan, bukan kolom teks |
| 4 | Cakupan modul | **(a) Semua** — 10 entitas terdaftar + tambahan stok, gaji, opname |
| 5 | Field opsional | **Isi diam-diam dengan default cerdas**, tampilkan kartu ringkasan yang tiap barisnya bisa diedit |

Konsekuensi keputusan 1 terhadap spesifikasi asli: contoh `user_message` yang berbunyi *"✅ Transaksi berhasil dicatat!"* **tidak boleh dipakai pada status READY**, karena pada saat itu data belum tersimpan. Kontrak respons di bagian 8 memisahkan dua peristiwa: `READY` (siap simpan) dan `SAVED` (sudah tersimpan).

---

## 1. TEMUAN AUDIT — KONFLIK YANG HARUS DIBERESKAN DULU

Sembilan konflik ditemukan antara skema regulasi AI (`entity-schemas.ts`) dan skema database sebenarnya. Empat di antaranya membuat aksi AI **pasti gagal** begitu dijalankan.

### K1 🔴 Mesin universalnya sudah ada tapi tidak tersambung ke UI

`ai-crud` (10 entitas, slot-filling, guard RBAC) **tidak pernah dipanggil dari mana pun di aplikasi**.

- `src/components/Chatbot.jsx:3` mengimpor `catatAI` — yaitu `ai-catat` lama, khusus transaksi.
- `crudAI()` ada di `src/lib/ai.js:100`, tapi tidak ada satu pun berkas `.jsx` yang memanggilnya.

**Inilah akar keluhan "AI Catat terlalu dangkal".** Kemampuannya sudah dibangun, pintunya belum dipasang. Ini juga berarti K2–K5 di bawah belum pernah meledak di produksi — karena jalurnya belum pernah dilewati pengguna.

### K2 🔴 Nama tabel absensi salah

`ATTENDANCE.table = 'attendances'` (jamak). Tabel sebenarnya bernama **`attendance`** (tunggal).
Dipakai di `crud-tools.ts:289` (`.from(spec.table)`) untuk memvalidasi target update. Akibat: setiap perintah ubah absensi lewat AI gagal dengan "data tidak ditemukan" — padahal datanya ada.

### K3 🔴 Enum status tugas bertabrakan dengan CHECK constraint

| | Nilai |
|---|---|
| Skema AI | `todo`, `progress`, `done` (fallback `todo`) |
| CHECK database | `antre`, `dikerjakan`, `selesai` (default `antre`) |

Setiap tugas yang dibuat AI ditolak database (`tasks_status_check`, SQLSTATE 23514). Kolom `priority` (`rendah`/`normal`/`tinggi`) juga belum ada di skema AI sama sekali.

### K4 🔴 Purchase Order tidak bisa dibuat AI

`purchase_orders.po_number` **NOT NULL tanpa default**, dan tidak terdaftar di `PURCHASE_ORDER.fields`. Penyimpanan akan kena not-null violation kecuali klien mengisinya lewat `nextDocNumber()` di `src/lib/gudang.js`. Nomor dokumen harus dihasilkan sistem, bukan ditanyakan ke pengguna dan bukan dikarang AI.

### K5 🟠 Tiga UNIQUE constraint tanpa strategi upsert

| Tabel | Kunci alami | Kalau diulang |
|---|---|---|
| `attendance` | `(employee_id, date)` | "Andi hadir hari ini" dua kali → 23505 |
| `kpi_scores` | `(employee_id, criteria_id, period)` | Perbaikan skor → gagal, bukan terupdate |
| `payrolls` | `(employee_id, period)` | Draf gaji ganda → gagal |

Untuk entitas berkunci alami, `create` dari AI harus diterjemahkan jadi **upsert**, bukan insert. Ini juga yang paling sesuai dengan cara orang bicara ("Andi hari ini sakit, bukan izin").

### K6 🔴 Pola FK tenant-aware wajib diikuti tabel `customers` baru

Seluruh relasi antar-tabel di database ini **tidak** memakai FK biasa. Polanya konsisten di 8 tabel:

```
parent  : UNIQUE (user_id, id)
child   : FOREIGN KEY (user_id, parent_id) REFERENCES parent(user_id, id)
```

Contoh nyata: `transactions_product_tenant_fkey`, `tasks_assignee_tenant_fkey`, `payrolls_employee_tenant_fkey`.

Artinya isolasi tenant ditegakkan **secara struktural**, bukan hanya oleh RLS: mustahil menautkan baris milik workspace lain sekalipun ID-nya ditebak. Tabel `customers` yang akan dibuat **wajib** mengikuti pola ini. Memakai `customer_id REFERENCES customers(id)` polos akan membuka celah yang sudah ditutup di seluruh tabel lain.

### K7 🟠 `resolveReferences` tidak mengikat query ke workspace aktif

`crud-tools.ts:274-278` memvalidasi keberadaan ID dengan `.from(refTable).select('id').eq('id', id)` — tanpa `.eq('user_id', scope.owner)`, padahal `loadContext` di `ai-crud/index.ts:62` sudah eksplisit mengikatnya.

Untuk pemilik tunggal ini aman karena RLS menyaring. Risikonya ada pada **staf yang aktif di lebih dari satu workspace**: RLS mengizinkan baris dari kedua workspace, sehingga validasi bisa meloloskan produk milik usaha lain yang sedang tidak dipilih. Perbaikannya satu baris, dan menyamakan pertahanan dengan `loadContext`.

### K8 🟠 Nilai channel: slug vs label

`transactions.channel` menyimpan **slug** — nilai nyata di produksi: `manual`, `qris`, `bank`, `wa`, `struk`, `asisten`. Tapi `enrichQuestionOptions` (`ai-crud/index.ts:103`) menyodorkan **label** (`c.label`) sebagai pilihan, dan itu pula yang akan tersimpan.

Akibatnya baris buatan AI tidak akan cocok dengan filter channel di halaman Transaksi maupun rincian per-channel di Reveal — persis fitur pembeda utama produk. Slot-filling harus menampilkan label tapi menyimpan value.

### K9 🟡 Field yang hilang dari skema regulasi

- `reminders.wa_number` — tidak ada di skema AI, padahal tombol "Kirim ke WA" bergantung padanya.
- `transactions.customer_name` / `customer_contact` — akan digantikan relasi `customer_id` (bagian 5), tapi harus tetap terisi selama masa transisi agar data lama tidak putus.

---

## 2. PETA INTENT → ENTITAS (cakupan penuh, keputusan 4a)

| Modul RBAC | Entitas | Status |
|---|---|---|
| `transaksi` | `transaksi` | Ada — perlu perbaikan K8, relasi pelanggan |
| `transaksi` | **`pelanggan`** | **Baru** (bagian 5) |
| `produk` | `produk`, `pemasok`, `purchase_order` | Ada — PO perlu perbaikan K4 |
| `produk` | **`stok_penyesuaian`** | **Baru** — jalur "stok masuk/keluar" tanpa PO |
| `produk` | **`opname`** | **Baru** — bungkus RPC `post_stock_opname` |
| `hr` | `karyawan`, `absensi`, `kpi_kriteria`, `kpi_skor` | Ada — perbaikan K2, K5 |
| `hr` | **`gaji`** | **Baru** — draf payroll per periode |
| `operasional` | `tugas`, `pengingat` | Ada — perbaikan K3, K9 |

**Catatan penting soal `stok_penyesuaian`:** Contoh 2 dalam spesifikasi ("Stok Kopi Arabika masuk 50 pcs dari Supplier Sukses") saat ini **tidak punya jalur** di aplikasi. Stok hanya berubah lewat tiga RPC atomik: transaksi ber-produk, terima PO, dan posting opname. Menambah entitas ini berarti menambah jalur keempat — dan jalur keempat itu harus tetap meninggalkan jejak audit, kalau tidak selisih stok jadi tak bisa ditelusuri.

**Ketegangan yang perlu Anda sadari:** `SPEC-REVISI-FITUR.md` bagian D memerintahkan menyembunyikan HR, Gudang, dan Papan Tugas dari navigasi utama, dan bagian G membekukan penambahan modul. Keputusan 4a berarti AI tetap menjangkau modul yang sengaja disembunyikan dari menu. Itu sah — modulnya memang tetap ada dan berfungsi — tapi berarti asisten bisa memunculkan fitur yang tidak terlihat di navigasi. Perlu diputuskan apakah contoh perintah (chips) untuk modul tersembunyi ikut ditampilkan, atau hanya dilayani kalau pengguna menyebut sendiri. **Rekomendasi: dilayani, tidak dipromosikan.**

---

## 3. KEBIJAKAN SLOT-FILLING BARU (keputusan 5)

Aturan lama — "field opsional pun ditanyakan sekali" — dicabut. Diganti tiga lapis:

**Lapis 1 — WAJIB (memblokir).** Ditanya satu per satu, maksimal 2 poin per pesan. Hanya field yang benar-benar tidak bisa disimpulkan: nominal, arah transaksi, nama entitas, produk mana.

**Lapis 2 — PENTING (tidak memblokir, diisi otomatis, ditandai di kartu).** Diisi dari sumber deterministik, lalu ditampilkan dengan penanda "diisi otomatis" supaya pengguna sadar dan bisa mengubah:

| Field | Sumber default cerdas |
|---|---|
| `category` | `src/lib/categorize.js` — mesin rule-based yang sudah ada dan sudah teruji. Jangan tanya, klasifikasikan |
| `channel` | Channel terakhir yang dipakai pengguna untuk arah transaksi yang sama; jatuh ke `manual` |
| `occurred_at` | Hari ini WIB |
| `payment_status` | `lunas` |
| `unit` | Satuan produk terkait, atau `pcs` |

**Lapis 3 — OPSIONAL (diam total).** Tidak ditanya, tidak diisi, hanya muncul sebagai baris kosong yang bisa diketuk di kartu ringkasan.

Efek pada pengalaman: kalimat "laku 3 kue coklat 45rb" yang hari ini memicu 6–8 pertanyaan berantai menjadi **nol pertanyaan** — langsung kartu ringkasan siap simpan.

---

## 4. ORKESTRASI AKSI KOMPOSIT (keputusan 2)

### Prinsip

Satu kalimat → satu **rencana aksi** berisi 1..n langkah → satu transaksi database. Semua langkah berhasil, atau tidak ada satu pun yang tersimpan.

### Perubahan pada lapisan model

Larangan "panggil satu fungsi saja" dicabut, diganti batas keras: **maksimal 3 pemanggilan fungsi per kalimat**, dan hanya kombinasi yang terdaftar di whitelist komposit. Kombinasi bebas tidak diizinkan — model tidak boleh mengarang orkestrasi baru.

Whitelist komposit awal:

| Pola | Langkah | Pemicu khas |
|---|---|---|
| `penjualan_lengkap` | pelanggan (upsert) → transaksi → stok berkurang | "jual 2 serum ke Budi 08123, transfer, lunas" |
| `pembelian_stok` | pemasok (upsert opsional) → transaksi keluar → stok bertambah | "beli 5kg tepung 75rb dari Toko Makmur" |
| `tugas_berpengingat` | tugas → pengingat | "ingatkan Andi bikin laporan besok jam 9" |

### Eksekusi atomik

Rencana aksi **tidak** dieksekusi langkah-per-langkah dari browser — itu menciptakan keadaan setengah jadi ketika langkah kedua gagal. Setiap pola komposit memakai satu RPC `SECURITY INVOKER` (RLS tetap berlaku), meneruskan pola yang sudah terbukti di `migration_atomic_ops.sql`:

```
record_sale_composite(p_customer jsonb, p_tx jsonb, p_lines jsonb) returns jsonb
```

Urutan di dalamnya: upsert pelanggan → ambil `customer_id` → insert transaksi dengan `customer_id` → sesuaikan stok. Kegagalan di langkah mana pun membatalkan seluruhnya — perilaku yang sudah dibuktikan lewat uji rollback opname pada Juli lalu.

### Yang tetap dilarang

Aksi komposit **tidak** boleh mencampur modul yang tidak dipunyai pemanggil. Kalau salah satu langkah butuh modul di luar hak akses staf, seluruh rencana ditolak di depan dengan pesan yang jelas — bukan dieksekusi sebagian.

---

## 5. DESAIN TABEL `customers` (keputusan 3)

### Struktur

| Kolom | Tipe | Aturan |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `user_id` | uuid | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE |
| `name` | text | NOT NULL |
| `phone` | text | nullable, disimpan ternormalisasi `62…` lewat `normalizePhone()` yang sudah ada di `src/lib/aging.js` |
| `email` | text | nullable |
| `address` | text | nullable |
| `note` | text | nullable |
| `created_at` | timestamptz | NOT NULL default `now()` |

**Constraint wajib (pola K6):**

```
UNIQUE (user_id, id)                      -- syarat agar bisa jadi induk FK komposit
UNIQUE (user_id, phone) WHERE phone IS NOT NULL   -- kunci alami untuk upsert
```

**Kolom baru di `transactions`:**

```
customer_id uuid NULL
FOREIGN KEY (user_id, customer_id) REFERENCES customers(user_id, id) ON DELETE SET NULL
```

### RLS

Ikuti pola tabel induk (`suppliers` / `employees`): 4 policy pemilik + satu policy staf `has_access(user_id, 'transaksi')`. Pelanggan masuk modul `transaksi`, bukan modul baru — kasir yang boleh mencatat penjualan otomatis boleh mencatat pelanggannya.

### Strategi migrasi data lama

`customer_name` dan `customer_contact` **tidak dihapus**. Alasannya: 52 baris transaksi yang sudah ada memuat nama pelanggan sebagai teks, dan halaman Piutang membaca kolom itu untuk tombol pengingat WhatsApp. Rencana tiga langkah:

1. Tambah `customers` + `customer_id`, isi keduanya untuk data baru.
2. Backfill: kelompokkan transaksi lama berdasarkan `customer_contact` ternormalisasi → buat baris `customers` → isi `customer_id`.
3. Kolom teks lama dipertahankan sebagai cadangan sampai halaman Piutang & Invoice dipindahkan membaca relasi.

Menghapus kolom lama di langkah 1 akan mematahkan Piutang dan Invoice sekaligus.

### Aturan pencocokan (anti-halusinasi)

Ketika kalimat menyebut "ke Budi":

1. Ada nomor telepon → cocokkan `(user_id, phone)`. Ketemu = pakai, tidak = buat baru.
2. Tanpa telepon, nama cocok persis satu baris → pakai baris itu.
3. Tanpa telepon, nama cocok >1 baris → **klarifikasi dengan menampilkan pilihan**, jangan tebak.
4. Tidak ada yang cocok → buat baru, dan katakan bahwa pelanggan baru akan dibuat.

Aturan 3 adalah penerapan langsung larangan halusinasi: menebak "Budi" yang mana akan menempelkan penjualan ke riwayat orang yang salah — kesalahan yang tidak terlihat sampai berbulan-bulan kemudian.

---

## 6. MATRIKS PENJAGA

Empat lapis, dijalankan berurutan, masing-masing bisa menolak sendirian:

| Lapis | Mekanisme | Menolak apa |
|---|---|---|
| 1. Whitelist fungsi | Hanya entitas terdaftar yang punya definisi tool | Login, kata sandi, 2FA, PIN, pengaturan akun — tidak pernah didaftarkan, jadi mustahil dipanggil |
| 2. Blocklist | `checkActionAllowed()` + `logBlockedAttempt()` | Jaring kedua bila tool tak sengaja terdaftar; percobaan dicatat |
| 3. Gerbang modul RBAC | `scope.can(spec.module)`, diperiksa **tiap putaran** slot-filling | Staf gudang mendiktekan transaksi keuangan |
| 4. Konfirmasi manusia | `confirmOnCreate` + kartu ringkasan | Semua penulisan — tidak ada yang tersimpan tanpa ketukan pengguna |

Lapis 4 menerapkan keputusan 1. Entitas finansial (transaksi, gaji, PO, penyesuaian stok, karyawan) menampilkan kartu penuh dengan rincian angka sebelum tombol Simpan. Entitas ringan (tugas, pengingat, absensi, pelanggan, KPI) tetap lewat kartu, tapi cukup satu ketukan — cepat tanpa menghapus persetujuan.

---

## 7. KONTRAK RESPONS

Amplop `<AI_CATAT_RESPONSE>` dipertahankan, dengan dua penyesuaian yang lahir dari keputusan 1 dan 2.

**Penyesuaian A — `READY` berarti siap simpan, bukan sudah tersimpan.** `user_message` pada status ini memakai bentuk ajakan ("Siap disimpan — periksa dulu ya"), bukan bentuk lampau. Peristiwa `SAVED` diterbitkan terpisah setelah pengguna menekan Simpan, dan ringkasannya **dihitung dari database**, bukan dari AI — pola bebas-halusinasi yang sudah dipakai `Chatbot.jsx` hari ini lewat `fetchTodayTotals()`.

**Penyesuaian B — `payload` menampung rencana banyak langkah.** Bidang `payload` diisi objek rencana: `{ pattern, steps: [...] }`, tiap langkah menyebut entitas, operasi, dan nilai. Bentuk satu langkah tetap sah sebagai rencana berisi satu langkah — tidak ada dua format berbeda untuk dipelihara.

Bidang `status` yang sah: `READY` · `NEEDS_CLARIFICATION` · `SAVED` · `ERROR`.

---

## 8. URUTAN EKSEKUSI

| Fase | Isi | Kenapa urutannya begini |
|---|---|---|
| **P0** | Perbaiki K2, K3, K8, K4, K7 + sambungkan `Chatbot.jsx` ke `crudAI()` | Paling murah, paling besar dampaknya. Setelah ini pengguna langsung merasakan 10 entitas — tanpa migrasi apa pun. Memperbaiki konflik **sebelum** menyambungkan mencegah pengguna bertemu error yang sudah kita ketahui |
| **P1** | Kebijakan slot-filling 3 lapis + kartu ringkasan yang bisa diedit | Mengubah rasa dari interogasi jadi asisten. Tidak butuh perubahan database |
| **P2** | Migrasi `customers` + `transactions.customer_id` + backfill | Perubahan skema pertama. Berdiri sendiri, bisa diuji terpisah |
| **P3** | RPC komposit + whitelist pola + pencabutan batas satu fungsi | Bergantung pada P2 (pola penjualan butuh tabel pelanggan) |
| **P4** | Entitas baru: `stok_penyesuaian`, `gaji`, `opname` | Paling akhir karena paling sedikit dipakai sehari-hari, dan `stok_penyesuaian` butuh keputusan jejak audit |

Setiap fase: `npx vitest run` hijau, lalu `graphify update .`, satu fase satu commit.

---

## 9. YANG BELUM DIPUTUSKAN

Tiga hal yang butuh keputusan Anda sebelum fase terkait dikerjakan:

1. **Jejak audit penyesuaian stok (P4).** Perubahan stok di luar transaksi/PO/opname perlu tabel riwayat sendiri, atau cukup mengandalkan `audit_logs` yang sudah merekam UPDATE pada `products`? Yang kedua lebih murah tapi tidak menyimpan alasan penyesuaian.
2. **Kuota AI.** Aksi komposit tetap satu panggilan Gemini, jadi biaya per kalimat tidak naik. Tapi kalau AI Catat jadi pintu masuk utama, batas harian per workspace untuk fitur `crud` perlu ditinjau ulang.
3. **Chips contoh perintah untuk modul tersembunyi** — sesuai catatan di bagian 2.

---

---

## STATUS PELAKSANAAN

| Fase | Status |
|---|---|
| **P0** | ✅ Selesai 3 Agustus 2026. K2/K3/K4/K7/K8 diperbaiki; `aiActions.js` + `Chatbot.jsx` tersambung ke `crudAI()` di balik sakelar `UNIVERSAL_CATAT_ENABLED` (masih `false`) |
| **P1** | ⬜ Belum — kebijakan slot-filling 3 lapis + kartu ringkasan |
| **P2** | ✅ Selesai 3 Agustus 2026. Migrasi `customers_p2` terpasang; 1 pelanggan hasil backfill, 1 transaksi tertaut, 0 menggantung, 52 transaksi utuh. Isolasi RLS diuji dua arah (pemilik melihat, pengguna lain nol) dengan kontrol positif |
| **P3** | ✅ Selesai 3 Agustus 2026, dengan **penyimpangan dari rencana** — lihat catatan di bawah |
| **P4** | ⬜ Belum — entitas `stok_penyesuaian`, `gaji`, `opname` |

Edge Function `ai-crud` **v3** ter-deploy (verify_jwt=true), memuat 11 entitas termasuk `pelanggan`.

### Penyimpangan P3 dari rencana bagian 4 — dan alasannya

Rencana semula: whitelist pola komposit (`penjualan_lengkap`, `pembelian_stok`, `tugas_berpengingat`) yang dieksekusi lewat RPC baru `record_sale_composite`. **Itu tidak dibangun.** Yang dibangun: satu kalimat boleh menghasilkan hingga `MAX_ACTIONS` (3) aksi terpisah, masing-masing jadi kartu konfirmasi sendiri.

Alasannya muncul setelah P2 jadi. Pola `penjualan_lengkap` seharusnya menjamin pelanggan + transaksi + stok tersimpan atomik, tetapi:

- Bagian yang benar-benar tidak boleh robek — **uang + stok** — sudah atomik lewat `add_transaction_with_stock`.
- `resolveCustomer()` **idempoten**: percobaan ulang memungut kembali pelanggan yang sudah dibuat, bukan menduplikasi.
- Sisa risikonya hanya baris pelanggan yatim bila transaksi gagal setelah pelanggan dibuat — tidak merusak data, tidak menyesatkan angka, dan hilang sendiri saat pengguna mengulang.

Menambah fungsi database baru ke produksi untuk menutup risiko sebesar itu tidak sepadan. Kalau nanti pelanggan yatim benar-benar mengganggu, RPC itu bisa ditambahkan tanpa mengubah apa pun di sisi klien.

Yang justru dipulihkan P3 adalah kemampuan yang **hilang** saat berpindah dari `ai-catat` ke `ai-crud`: mencatat beberapa transaksi dari satu kalimat ("beli gas 22rb sama plastik 10rb"). Itu yang dipakai sehari-hari, dan itu satu-satunya alasan sakelar masih dimatikan.

Sakelar `UNIVERSAL_CATAT_ENABLED` sengaja masih `false`: menyalakannya menukar kemampuan "beberapa transaksi dalam satu kalimat" dengan jangkauan 11 entitas. Penukaran itu hilang setelah P3 selesai.
