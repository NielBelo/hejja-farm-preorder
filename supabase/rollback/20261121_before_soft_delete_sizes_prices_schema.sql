-- ROLLBACK - a 20261121000000_soft_delete_sizes_prices_schema.sql migráció
-- ELŐTTI állapot visszaállítása.
--
-- A migráció kizárólag additív volt (új oszlopok, új tábla, új view-k, egy új
-- products sor), meglévő függvényt/triggert nem módosított, ezért a rollback
-- egyszerűen eltávolítja ezeket.
--
-- FIGYELEM - adatvesztés: az archived_at, small_size_limit, large_size_limit
-- és a season_product_prices tartalma a rollbackkel elvész. Ha a migráció óta
-- már használta az admin felület, előbb mentsd le ezeket.
--
-- Az "Extra csirke csomag" termék csak akkor törlődik, ha egyetlen
-- order_items sor sem hivatkozik rá.
BEGIN;

drop view if exists public.season_order_stats;
drop view if exists public.pickup_day_order_stats;

drop table if exists public.season_product_prices;

delete from public.products p
where p.name = 'Extra csirke csomag'
  and not exists (select 1 from public.order_items oi where oi.product_id = p.id);

alter table public.pickup_days
  drop constraint if exists pickup_days_small_size_limit_check,
  drop constraint if exists pickup_days_large_size_limit_check,
  drop column if exists archived_at,
  drop column if exists small_size_limit,
  drop column if exists large_size_limit;

alter table public.season_parameters
  drop column if exists archived_at;

notify pgrst, 'reload schema';

COMMIT;
