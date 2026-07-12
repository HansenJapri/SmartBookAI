-- ============================================================
-- FASE 2 KEUANGAN: Piutang & Utang + umur piutang.
-- payment_status 'belum' kini dipakai dua arah:
--   direction 'in'  + belum = PIUTANG (uang akan masuk)
--   direction 'out' + belum = UTANG   (uang akan keluar)
-- due_date = tanggal jatuh tempo (opsional).
-- ============================================================
alter table public.transactions add column if not exists due_date date;
create index if not exists idx_tx_unpaid on public.transactions (user_id, payment_status) where payment_status = 'belum';
