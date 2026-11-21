-- Séma-előkészítés a soft delete-hez, a napi kicsi/nagy méret limithez és a
-- szezononkénti termékárakhoz. KIZÁRÓLAG additív: meglévő oszlopot, függvényt
-- vagy triggert nem módosít, ezért a jelenleg futó alkalmazás változatlanul
-- működik a migráció után is.
--
-- 1) Soft delete: pickup_days.archived_at és season_parameters.archived_at
--    (NULL = aktív, nem NULL = törölt, visszaállítható). Fizikai törlés
--    nincs, a rendelések hivatkozásai érintetlenek maradnak.
--
-- 2) Napi méret limit: pickup_days.small_size_limit / large_size_limit =
--    az adott napra rendelhető "Átlagostól kisebb/nagyobb méret" csirkék
--    darabszáma (order_items.size_preference alapján, submitted
--    rendelésekből számolva). NULL = nincs korlát, 0 = nem rendelhető.
--    A régi, profilhoz kötött méretpreferencia (profiles.special_size_preference,
--    enforce_size_preference_limit trigger, get_size_preference_locks) ebben
--    a migrációban még TOVÁBB ÉL, kivezetése a következő lépés.
--
-- 3) Termékárak: season_product_prices (szezon, termék) -> ár. Egy
--    szezon-termék párhoz pontosan egy ár tartozik (összetett elsődleges
--    kulcs). Nincs sor = a termék az adott szezonban nem kínálható. A
--    meglévő season_parameters.price oszlop egyelőre megmarad. Új termék:
--    "Extra csirke csomag".
--
-- 4) Számolt (nem tárolt) rendelésjelzők: pickup_day_order_stats és
--    season_order_stats view-k, így a "van-e rajta rendelés" sosem csúszhat el.
BEGIN;

-- 1) + 2) pickup_days
alter table public.pickup_days
  add column if not exists archived_at timestamptz,
  add column if not exists small_size_limit integer,
  add column if not exists large_size_limit integer;

alter table public.pickup_days
  add constraint pickup_days_small_size_limit_check check (small_size_limit is null or small_size_limit >= 0),
  add constraint pickup_days_large_size_limit_check check (large_size_limit is null or large_size_limit >= 0);

-- 1) season_parameters
alter table public.season_parameters
  add column if not exists archived_at timestamptz;

-- 3) Új termék. Az id-ket korábban kézzel szúrták be, ezért az identity
-- sequence elmaradhat a tényleges max(id)-tól: az id-t explicit adjuk
-- (max+1), majd a sequence-t felzárkóztatjuk. A WHERE NOT EXISTS miatt a
-- migráció ismételt futtatása nem duplikálja.
insert into public.products (id, name, description)
select m.next_id, 'Extra csirke csomag', null
from (select coalesce(max(id), 0) + 1 as next_id from public.products) m
where not exists (select 1 from public.products where name = 'Extra csirke csomag');

select setval(pg_get_serial_sequence('public.products', 'id'), (select max(id) from public.products));

create table public.season_product_prices (
  season_parameter_id bigint not null references public.season_parameters(id),
  product_id bigint not null references public.products(id),
  price integer not null check (price >= 0),
  created_at timestamptz not null default now(),
  primary key (season_parameter_id, product_id)
);

alter table public.season_product_prices enable row level security;

-- Olvasás mindenkinek (a szezon árai nyilvánosak, mint a season_parameters
-- view_right policy-ja). Írásra NINCS policy: a módosítás a SECURITY DEFINER
-- admin RPC-ken keresztül történik, közvetlen kliens-írás RLS miatt tiltott.
create policy view_right on public.season_product_prices as permissive for select to public using (true);

revoke all on table public.season_product_prices from public, anon, authenticated, service_role;
grant select on table public.season_product_prices to anon, authenticated, service_role;
grant insert, update, delete on table public.season_product_prices to service_role;

-- Backfill: a mostani szezon-szintű ár az Egész és a Darabolt csirkére.
-- Az Extra csirke csomagnak szándékosan nincs sora.
insert into public.season_product_prices (season_parameter_id, product_id, price)
select sp.id, p.id, sp.price
from public.season_parameters sp
join public.products p on p.name in ('Egész csirke', 'Darabolt csirke')
where sp.price is not null
on conflict do nothing;

-- 4) Számolt rendelésjelzők. security_invoker: az orders RLS-t a hívó
-- jogosultságaival érvényesítik (admin mindent lát). "Élő" = submitted.
create view public.pickup_day_order_stats with (security_invoker = true) as
select
  pd.id as pickup_day_id,
  pd.season_parameter_id,
  count(distinct o.id) filter (where o.status = 'submitted') as live_order_count,
  count(distinct o.id) as total_order_count,
  coalesce(sum(oi.quantity) filter (where o.status = 'submitted' and oi.size_preference = 'Átlagostól kisebb méret'), 0)::integer as live_small_quantity,
  coalesce(sum(oi.quantity) filter (where o.status = 'submitted' and oi.size_preference = 'Átlagostól nagyobb méret'), 0)::integer as live_large_quantity
from public.pickup_days pd
left join public.orders o on o.pickup_day_id = pd.id
left join public.order_items oi on oi.order_version_id = o.current_version_id
group by pd.id, pd.season_parameter_id;

create view public.season_order_stats with (security_invoker = true) as
select
  sp.id as season_parameter_id,
  coalesce(sum(s.live_order_count), 0)::integer as live_order_count,
  coalesce(sum(s.total_order_count), 0)::integer as total_order_count,
  coalesce(sum(s.live_small_quantity), 0)::integer as live_small_quantity,
  coalesce(sum(s.live_large_quantity), 0)::integer as live_large_quantity
from public.season_parameters sp
left join public.pickup_day_order_stats s on s.season_parameter_id = sp.id
group by sp.id;

revoke all on public.pickup_day_order_stats, public.season_order_stats from public, anon, authenticated, service_role;
grant select on public.pickup_day_order_stats, public.season_order_stats to authenticated, service_role;

notify pgrst, 'reload schema';

COMMIT;
