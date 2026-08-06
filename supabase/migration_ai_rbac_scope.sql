-- ============================================================
-- MODUL EFEKTIF UNTUK LAPISAN AI
-- Jalankan SETELAH migration_workspace_isolation.sql. Aman diulang.
--
-- Latar belakang
-- --------------
-- Edge Function AI (ai, ai-crud) menyusun "Ringkasan data usaha" dengan
-- `supabase.from('transactions').select(...)` TANPA filter user_id, lalu
-- bersandar sepenuhnya pada RLS. Itu tidak cukup, persis seperti yang sudah
-- didokumentasikan untuk klien di src/lib/api.js:
--
--   RLS berbunyi `auth.uid() = user_id OR has_access(user_id, modul)`, dan
--   has_access TIDAK tahu workspace mana yang sedang dibuka. Begitu seseorang
--   menjadi staf aktif di usaha lain, select tanpa filter mengembalikan
--   GABUNGAN baris miliknya sendiri dan baris usaha itu.
--
-- Akibatnya jawaban AI bisa menjumlahkan omzet dua usaha sekaligus. Fungsi di
-- bawah memberi Edge Function dua hal yang dibutuhkan untuk menutupnya:
-- workspace mana yang sah dibuka, dan modul apa saja yang boleh dibaca di sana.
-- ============================================================

-- Modul yang boleh diakses pemanggil pada workspace p_owner.
--   - workspace sendiri  -> semua modul (owner penuh)
--   - workspace orang lain -> hanya modul pada keanggotaan AKTIF
--   - tanpa keanggotaan  -> exception (lewat resolve_owner)
--
-- security definer supaya bisa membaca staff_members tanpa membocorkan
-- barisnya; yang dikembalikan hanya daftar modul milik pemanggil sendiri.
create or replace function public.my_modules(p_owner uuid default null)
returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid := public.resolve_owner(p_owner);
  v_mods  text[];
begin
  if v_owner = v_uid then
    return array['dashboard','operasional','transaksi','produk','hr','analisis'];
  end if;

  select m.modules into v_mods
    from public.staff_members m
   where m.owner_id = v_owner and m.member_id = v_uid and m.status = 'active'
   limit 1;

  return coalesce(v_mods, array[]::text[]);
end $$;

revoke all on function public.my_modules(uuid) from public;
grant execute on function public.my_modules(uuid) to authenticated;
