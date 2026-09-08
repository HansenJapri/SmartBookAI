-- ============================================================
-- Jembatan terkendali dari Edge Function ke schema `ops`.
--
-- KENAPA PERLU: PostgREST hanya melayani schema yang didaftarkan sebagai
-- "Exposed schemas" (bawaan: public, graphql_public). Karena `ops` SENGAJA
-- tidak didaftarkan, `supabase.schema('ops').from(...)` dari Edge Function akan
-- ditolak — bahkan dengan service role. Dan mendaftarkan `ops` supaya bisa
-- ditulis akan membatalkan seluruh alasan schema itu dibuat.
--
-- SOLUSI: dua fungsi SECURITY DEFINER di `public` sebagai satu-satunya pintu.
-- Keduanya dicabut dari anon & authenticated dan hanya diberikan ke
-- service_role. PostgREST menyaring daftar endpoint-nya per peran, jadi
-- pengguna aplikasi tidak melihat fungsi ini di introspeksi mana pun — dan
-- seandainya mereka menebak namanya, panggilannya tetap ditolak karena tidak
-- punya EXECUTE.
--
-- Yang berpindah ke `public` hanyalah PINTU-nya. Seluruh DATA tetap di `ops`
-- dan tidak pernah punya endpoint REST-nya sendiri.
-- ============================================================

-- ---------- Pintu 1: baca rekam medis ----------
create or replace function public.ops_ringkasan_kesehatan()
returns jsonb
language sql
stable
security definer
set search_path = ops, public
as $fn$
  select ops.ringkasan_kesehatan();
$fn$;

revoke all on function public.ops_ringkasan_kesehatan() from public;
revoke all on function public.ops_ringkasan_kesehatan() from anon;
revoke all on function public.ops_ringkasan_kesehatan() from authenticated;
grant execute on function public.ops_ringkasan_kesehatan() to service_role;

-- ---------- Pintu 2: tulis detak ----------
create or replace function public.ops_catat_heartbeat(
  p_sumber    text,
  p_sehat     boolean,
  p_kesehatan jsonb,
  p_catatan   text
)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $fn$
declare
  v_id      bigint;
  v_beat_at timestamptz;
begin
  insert into ops.service_heartbeat (sumber, sehat, kesehatan, catatan)
  values (
    coalesce(nullif(trim(p_sumber), ''), 'tidak-diketahui'),
    coalesce(p_sehat, false),
    coalesce(p_kesehatan, '{}'::jsonb),
    left(coalesce(p_catatan, ''), 1000)
  )
  returning id, beat_at into v_id, v_beat_at;

  return jsonb_build_object('id', v_id, 'beat_at', v_beat_at);
end;
$fn$;

revoke all on function public.ops_catat_heartbeat(text, boolean, jsonb, text) from public;
revoke all on function public.ops_catat_heartbeat(text, boolean, jsonb, text) from anon;
revoke all on function public.ops_catat_heartbeat(text, boolean, jsonb, text) from authenticated;
grant execute on function public.ops_catat_heartbeat(text, boolean, jsonb, text) to service_role;

-- ---------- Pintu 3: baca token keepalive ----------
-- Edge Function memverifikasi header x-keepalive-token terhadap nilai di
-- ops.service_config. Nilainya tidak pernah dikembalikan ke pemanggil HTTP;
-- fungsi ini hanya dipakai di dalam Edge Function untuk perbandingan.
create or replace function public.ops_token(p_kunci text)
returns text
language sql
stable
security definer
set search_path = ops, public
as $fn$
  select nilai from ops.service_config where kunci = p_kunci;
$fn$;

revoke all on function public.ops_token(text) from public;
revoke all on function public.ops_token(text) from anon;
revoke all on function public.ops_token(text) from authenticated;
grant execute on function public.ops_token(text) to service_role;
