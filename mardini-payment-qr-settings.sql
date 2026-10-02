-- Mardini per-destination QR visibility settings
alter table public.wallets
  add column if not exists qr_enabled boolean not null default true;

alter table public.networks
  add column if not exists qr_enabled boolean not null default true;
