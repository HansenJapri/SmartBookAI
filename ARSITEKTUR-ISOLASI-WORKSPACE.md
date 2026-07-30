# Arsitektur Isolasi Workspace

Dokumen ini menjelaskan model multi-tenant SmartBook AI dan aturan yang harus
dipatuhi setiap perubahan kode berikutnya. Ditulis setelah insiden nyata: data
usaha owner tampak "ter-copy" ke usaha staf. Bagian **Insiden** di bawah
menjelaskan kenapa itu terjadi, karena memahaminya adalah yang mencegah
terulangnya.

---

## 1. Model tenant

Satu **workspace = satu usaha = satu `user_id`**. Tidak ada tabel `workspaces`
terpisah; `user_id` pada tabel data **adalah** identitas workspace, dan nilainya
sama dengan `auth.users.id` pemilik usaha.

Konsekuensi penting: **setiap pengguna selalu memiliki workspace-nya sendiri.**
Keanggotaan sebagai staf di usaha orang lain bersifat *tambahan*, dicatat di
`staff_members`, dan hanya aktif bila pengguna memilihnya sendiri.

Satu pengguna dapat berada di beberapa workspace sekaligus:

```
Pengguna P
├── workspace P            (selalu ada, P adalah owner)
├── workspace A  (staf, modul: transaksi, produk)
└── workspace B  (staf, modul: hr)
```

Workspace yang sedang dibuka disimpan di `localStorage['bp-active-workspace']`
dan **selalu diverifikasi ulang** ke `staff_members` sebelum dipakai.

---

## 2. Empat lapis pertahanan

Urutannya penting: lapis paling dalam adalah yang paling bisa diandalkan.

### Lapis 1 — Skema (paling kuat)

Constraint database. Pelanggaran bukan "tidak dilakukan", tapi **mustahil**.

| Mekanisme | Isi |
|---|---|
| `user_id NOT NULL` | Seluruh 26 tabel tenant |
| Kunci tenant | `UNIQUE (user_id, id)` di `employees`, `kpi_criteria`, `transactions`, `products`, `suppliers`, `ingredients` |
| FK komposit | 13 relasi: `(user_id, <ref>) → induk(user_id, id)` |
| Trigger | `stock_opnames.items` (referensi di dalam JSONB, tidak bisa di-FK) |
| Lint | `select * from public.tenancy_lint()` — hasil kosong = sehat |

Referensi lintas-workspace ditolak Postgres dengan `23503`, **tanpa bergantung
pada RLS, kode klien, atau RPC**.

Lihat [migration_tenancy_constraints.sql](supabase/migration_tenancy_constraints.sql).

### Lapis 2 — RLS (batas luar)

Menjawab: **apa yang BOLEH dilihat akun ini?**

```sql
-- pola di setiap tabel tenant
auth.uid() = user_id  OR  has_access(user_id, '<modul>')
```

`has_access()` memeriksa keanggotaan staf aktif + modul yang diizinkan.

**Batasan yang wajib dipahami:** RLS **tidak tahu** workspace mana yang sedang
dibuka klien. Bagi staf aktif, `select('*')` tanpa filter akan mengembalikan
*gabungan* baris miliknya sendiri **dan** baris usaha tempat dia jadi staf — di
kedua tampilan. RLS bukan pengganti Lapis 3.

### Lapis 3 — Cakupan workspace (batas dalam)

Menjawab: **apa yang HARUS dilihat sekarang?**

Semua akses tabel tenant di klien wajib lewat helper di
[src/lib/api.js](src/lib/api.js):

```js
const owner = await wsOwner()                 // gagal tertutup bila tidak sah
wsSelect(owner, 'transactions').order(...)    // SELECT terikat workspace
wsUpdate(owner, 'products', patch).eq('id', id)
wsDelete(owner, 'tasks').eq('id', id)
```

Ketiga helper **sinkron** dan menerima `owner` sebagai argumen pertama. Ini
sengaja: builder PostgREST bersifat *thenable*, jadi helper `async` yang
mengembalikan builder akan ter-`await` menjadi `{data, error}` dan rantai
`.order()`/`.eq()` berikutnya pecah.

Untuk sisi server, workspace tujuan dikirim eksplisit sebagai `p_owner` dan
diverifikasi `resolve_owner(p_owner)`.

### Lapis 4 — RBAC modul & rute

Menjawab: **menu dan halaman apa yang boleh dibuka?**

- [src/lib/rbac.js](src/lib/rbac.js) — `isOwnerView()`, `canModule()`, `canPath()`
- `filterNav()` menyembunyikan menu; `<Guarded>` di [src/App.jsx](src/App.jsx)
  memblokir rute. Menyembunyikan tautan saja tidak menghentikan siapa pun yang
  mengetik URL langsung.

**Jangan** memakai `membership === null` sebagai proksi "owner" — selama undangan
belum diterima, membership memang `null`. Pakai `isOwnerView(userId, selected)`.

---

## 3. Prinsip: gagal tertutup

Setiap penyelesaian pemilik menolak, bukan menebak:

| Tempat | Perilaku |
|---|---|
| `effectiveOwnerId()` (klien) | Keanggotaan tidak sah → bersihkan pilihan workspace + `throw` |
| `resolve_owner(p_owner)` (server) | Tidak ada keanggotaan aktif → `raise` |
| `wsOwner()` | Tidak ada sesi → `throw` |

Yang **dihindari** adalah pola `coalesce(x, fallback)` / `x || fallback` pada
resolusi pemilik. Fallback diam-diam berarti tulisan mendarat di workspace yang
salah tanpa satu pun peringatan — persis penyebab insiden di bawah.

---

## 4. Aturan untuk perubahan berikutnya

**Menambah tabel tenant baru**

1. Sertakan `user_id uuid not null references auth.users(id) on delete cascade`
2. Bila akan direferensikan tabel lain: tambahkan `unique (user_id, id)`
3. Aktifkan RLS + policy owner dan policy staf per modul
4. FK ke tabel tenant lain **wajib komposit**
5. Jalankan `select * from public.tenancy_lint()` — harus kosong

**Menambah query di klien**

1. Lewat `wsSelect` / `wsUpdate` / `wsDelete`, bukan `supabase.from()` langsung
2. Insert/upsert mengisi `user_id: await wsOwner()`
3. Query hidup di `src/lib/api.js`, **bukan** di dalam komponen halaman
4. `npx vitest run src/lib/__tests__/tenancy.guard.test.js` menjaga aturan 1–3

**Menambah RPC yang menulis**

1. Terima `p_owner uuid default null`
2. Baris pertama: `v_owner uuid := public.resolve_owner(p_owner);`
3. Setiap baris yang disentuh diberi syarat `and user_id = v_owner`
4. Jangan pakai `effective_owner()` — fungsi itu tinggal peninggalan dan kini
   hanya mengembalikan `auth.uid()`

---

## 5. Insiden: kenapa data tampak ter-copy

Gejala: staf masuk ke usaha owner, kembali ke usahanya sendiri, dan seluruh data
usaha owner tampak ikut ter-copy.

Tiga cacat menumpuk, semuanya di lapis aplikasi karena Lapis 1 belum ada:

**1. `effective_owner()` mengabaikan workspace yang dipilih.**

```sql
select coalesce(
  (select owner_id from staff_members
    where member_id = auth.uid() and status = 'active' limit 1),
  auth.uid())
```

Begitu seseorang jadi staf aktif di satu usaha, fungsi ini **selalu**
mengembalikan owner_id usaha itu — termasuk saat staf bekerja di usahanya
sendiri. `add_transaction_with_stock()` memakainya sebagai `user_id`, jadi setiap
transaksi staf di usahanya sendiri tersimpan ke usaha owner. `limit 1` tanpa
`ORDER BY` juga membuat pilihannya tidak deterministik.

**2. Semua baca di klien tanpa filter workspace.** ~30 fungsi memanggil
`select('*')` dan menyerahkan semuanya ke RLS — yang, seperti dijelaskan di
Lapis 2, mengembalikan gabungan dua workspace.

**3. Semua ubah/hapus hanya berkunci `id`.** Staf bisa mengubah dan menghapus
data usaha owner dari dalam tampilan usahanya sendiri.

Pelajarannya bukan "ada tiga bug". Pelajarannya: ketiganya adalah **gejala dari
satu akar** — invarian tenant hidup sebagai konvensi di kode, bukan sebagai
constraint di skema. Selama begitu, cacat keempat hanya soal waktu. Karena itu
Lapis 1 dan `tenancy_lint()` ada.

---

## 6. Riwayat migrasi terkait

| Berkas | Isi |
|---|---|
| [migration_rbac_fase3.sql](supabase/migration_rbac_fase3.sql) | RBAC awal (memuat cacat yang diperbaiki dua berkas di bawah) |
| [migration_rbac_invite_hardening.sql](supabase/migration_rbac_invite_hardening.sql) | Kebocoran baca undangan, privilege escalation lewat `sm_member_claim`, self-invite |
| [migration_workspace_isolation.sql](supabase/migration_workspace_isolation.sql) | `resolve_owner()`, `p_owner` eksplisit di 4 RPC, syarat `user_id` pada setiap baris yang disentuh |
| [migration_tenancy_constraints.sql](supabase/migration_tenancy_constraints.sql) | FK komposit, kunci tenant, trigger JSONB, `tenancy_lint()` |

## 7. Perintah verifikasi

```sql
-- gerbang rilis: harus kosong
select * from public.tenancy_lint();
```

```bash
npx vitest run
```
