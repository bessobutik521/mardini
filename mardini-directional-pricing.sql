-- Mardini directional pricing/fees migration
alter table commission_tiers add column if not exists direction text not null default 'sell';
alter table commission_tiers add constraint commission_tiers_direction_check check (direction in ('sell','buy'));
alter table networks add column if not exists buy_fee numeric not null default 0 check (buy_fee >= 0);
alter table exchange_rates add column if not exists buy_usd_rate numeric;
alter table exchange_rates add column if not exists sell_usd_rate numeric;
update exchange_rates set buy_usd_rate = coalesce(buy_usd_rate, rate), sell_usd_rate = coalesce(sell_usd_rate, rate) where id=1;
alter table exchange_rates alter column buy_usd_rate set not null;
alter table exchange_rates alter column sell_usd_rate set not null;
create index if not exists commission_tiers_direction_range_idx on commission_tiers(direction, minimum, maximum);