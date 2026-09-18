-- ============================================================
-- PETA FITUR -> MODEL, di database, bukan hanya di config.ts
--
-- Jalankan SETELAH migration_ai_harga_resmi_google.sql. Aman diulang.
-- ============================================================
-- Sampai hari ini, satu-satunya tempat yang tahu "fitur X memakai model Y"
-- adalah FEATURE_ROUTES di supabase/functions/_shared/ai/config.ts — kode
-- yang tidak pernah dibaca admin, dan tidak bisa ditanya dari layar mana pun.
-- Setiap kali admin ingin tahu "kenapa Draf HPP lebih mahal dari Pencatatan",
-- jawabannya cuma ada di file TypeScript yang harus dibuka manual.
--
-- Kolom ini SENGAJA hidup berdampingan dengan config.ts, mengikuti pola yang
-- sama dengan ai_credit_rates: peta model boleh sedikit lambat mengikuti kode
-- (rute berubah lebih jarang daripada kredit atau harga), tapi HARUS ada
-- satu tempat yang bisa dibaca UI tanpa membuka source code.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Kolom peta model
-- ------------------------------------------------------------
alter table public.ai_feature_defaults
  add column if not exists model          text,
  add column if not exists fallback_model text,
  add column if not exists model_note     text;

comment on column public.ai_feature_defaults.model is
  'Model utama dari FEATURE_ROUTES di supabase/functions/_shared/ai/config.ts. Diperbarui manual saat rute berubah — bukan dibaca live dari kode.';
comment on column public.ai_feature_defaults.fallback_model is
  'Model cadangan. NULL berarti fitur ini TIDAK punya fallback — satu kegagalan model berarti fitur mati, bukan berdegradasi.';

-- Dicocokkan dengan config.ts per 2026-09-18.
update public.ai_feature_defaults set
  model = 'gemini-3.5-flash-lite', fallback_model = 'gemini-3.1-flash-lite'
 where feature in ('chat', 'insight_dashboard', 'insight_stok', 'crud');

update public.ai_feature_defaults set
  model = 'gemini-3.1-flash-lite', fallback_model = 'gemini-3.5-flash-lite'
 where feature = 'ocr';

update public.ai_feature_defaults set
  model = 'gemini-3.5-flash', fallback_model = 'gemini-3.5-flash-lite'
 where feature in ('catat', 'hpp_draft');

update public.ai_feature_defaults set
  model = 'gemini-3.1-flash-live-preview', fallback_model = null,
  model_note = 'Dua model berbeda di satu baris kuota: percakapan memakai model ini (LEGACY, tanpa fallback), TTS memakai gemini-3.1-flash-tts-preview (juga tanpa fallback). Google menganjurkan migrasi model percakapan ke gemini-3.8-live.'
 where feature = 'voice';

-- ------------------------------------------------------------
-- 2) Statistik biaya per fitur — LIVE, bukan angka yang disalin ke dokumen
-- ------------------------------------------------------------
-- Menjawab persis pertanyaan yang sebelumnya hanya bisa dijawab lewat query
-- manual di SQL Editor: berapa token rata-rata per panggilan, berapa persen
-- masukan vs keluaran, dan — digabung dengan ai_model_prices di sisi klien —
-- berapa biaya per panggilan.
--
-- Dikelompokkan per (feature, last_model): fitur dengan fallback aktif bisa
-- punya dua baris, dan itu benar — biaya per model memang berbeda.
--
-- Fitur TANPA satu pun baris pemakaian tetap harus muncul di hasil (makanya
-- LEFT JOIN dari ai_feature_defaults, bukan dari workspace_ai_usage), supaya
-- UI bisa menandainya "belum terukur" alih-alih diam-diam menghilang dari
-- tabel — hilang dari tabel terbaca sebagai "tidak relevan", padahal artinya
-- justru sebaliknya: belum ada data untuk dipercaya sama sekali.
create or replace function public.admin_feature_cost_stats()
returns table (
  feature          text,
  last_model       text,
  calls            bigint,
  seconds_used     bigint,
  avg_tokens_in    numeric,
  avg_tokens_out   numeric,
  avg_tokens_call  numeric,
  pct_input        numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    f.feature::text,
    u.last_model::text,
    coalesce(sum(u.count), 0)::bigint,
    coalesce(sum(u.seconds_used), 0)::bigint,
    case when coalesce(sum(u.count), 0) > 0
      then round(sum(u.prompt_tokens)::numeric / sum(u.count), 0) end,
    case when coalesce(sum(u.count), 0) > 0
      then round(sum(u.completion_tokens + u.thinking_tokens)::numeric / sum(u.count), 0) end,
    case when coalesce(sum(u.count), 0) > 0
      then round(sum(u.total_tokens)::numeric / sum(u.count), 0) end,
    case when coalesce(sum(u.prompt_tokens + u.completion_tokens + u.thinking_tokens), 0) > 0
      then round(sum(u.prompt_tokens)::numeric * 100
                  / sum(u.prompt_tokens + u.completion_tokens + u.thinking_tokens), 1) end
  from public.ai_feature_defaults f
  left join public.workspace_ai_usage u
    on u.feature = f.feature and u.last_model is not null
  group by f.feature, f.sort_order, u.last_model
  order by f.sort_order, u.last_model nulls first;
end;
$$;

revoke all on function public.admin_feature_cost_stats() from public;
grant execute on function public.admin_feature_cost_stats() to authenticated;
