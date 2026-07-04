-- ============================================================
-- MIGRASI AGREGASI SERVER
-- Ringkasan bulanan dihitung di SERVER agar mencakup SELURUH transaksi
-- (tidak terbatas plafon pengambilan di klien). Penting untuk pengguna
-- volume tinggi agar laporan tetap akurat. Aman diulang.
-- ============================================================

create or replace function public.my_monthly_summary()
returns table (month text, income numeric, expense numeric, cnt bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select to_char(occurred_at, 'YYYY-MM') as month,
         coalesce(sum(amount) filter (where direction = 'in'), 0)  as income,
         coalesce(sum(amount) filter (where direction = 'out'), 0) as expense,
         count(*) as cnt
  from public.transactions
  where user_id = auth.uid()           -- RLS juga membatasi, ini lapis tambahan
  group by 1
  order by 1;
$$;

grant execute on function public.my_monthly_summary() to authenticated;

-- ============================================================
-- SELESAI.
-- ============================================================
