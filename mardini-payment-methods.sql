-- Mardini payment-method QR controls
-- Run once on the Mardini Supabase project before saving the new QR toggles.

ALTER TABLE public.wallets
ADD COLUMN IF NOT EXISTS qr_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.networks
ADD COLUMN IF NOT EXISTS qr_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS wallets_currency_unique_idx
ON public.wallets(currency);

CREATE UNIQUE INDEX IF NOT EXISTS networks_name_unique_idx
ON public.networks(name);
