-- Mardini payment destination metadata
alter table public.wallets
  add column if not exists owner_name text not null default '';
