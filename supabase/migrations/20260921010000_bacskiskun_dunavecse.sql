-- Bács-Kiskun vármegyei vásárlói csoport és a hozzá tartozó DUNAVECSE
-- technikai átvételi nap bevezetése.
--
-- Áttekintés:
--   1. public.pickup_days.kind: strukturált mező ('normal' | 'dunavecse'),
--      amely a DUNAVECSE technikai napot azonosítja - NEM a megjelenített
--      névből vagy dátumból derítjük ki máshol a kódban.
--   2. Szezononként pontosan egy DUNAVECSE nap lehet (részleges egyedi
--      index), korlátlan kapacitással (planned_stock/available_stock NULL,
--      kényszerítve check constraint-tel), és a dátuma mindig a szezon
--      utolsó NORMÁL átvételi napjával egyezik.
--   3. admin_save_season_parameters minden mentéskor automatikusan
--      létrehozza/karbantartja az adott szezon DUNAVECSE napját; fizikailag
--      nem törölhető (a napokat kivezető DELETE csak kind='normal' sorokat
--      érint), de a meglévő admin_set_pickup_day_active RPC-vel ugyanúgy
--      aktiválható/deaktiválható, mint bármely más átvételi nap.
--   4. finalize_order és update_order szerveroldalon kényszeríti ki, hogy
--      Bács-Kiskun vármegyei vásárló csak a DUNAVECSE napra rendelhessen
--      (a kliens által küldött pickup_day_id-t Bács-Kiskun vásárlónál
--      figyelmen kívül hagyva), más vármegyei vásárló pedig soha nem
--      kerülhet a DUNAVECSE napra - és hogy a DUNAVECSE napra sem normál
--      készletellenőrzés, sem készletcsökkentés nem vonatkozik.
--   5. cancel_order/restore_order és az enforce_size_preference_limit
--      trigger is figyelembe veszi az új mezőt, hogy a DUNAVECSE napon ne
--      próbáljon (értelmetlen) normál készlet- vagy
--      méretpreferencia-kapacitást kezelni.
--
-- Ez a migráció a legutóbbi verziózott admin_save_season_parameters
-- (20260919010000_block_silent_pickup_day_deletion.sql) és a legutóbbi
-- finalize_order alapdefiníció (20260921000000_baseline_finalize_order.sql)
-- tetejére épül; mindkét függvényt (és az update_order/cancel_order/
-- restore_order/enforce_size_preference_limit/get_size_preference_locks
-- függvényeket is) teljes egészében újra definiálja, hogy a meglévő
-- viselkedésük egyértelműen, egy helyen legyen látható és karbantartható.
--
-- FONTOS: a cancel_order és restore_order ITT szereplő alapja a 2026.09.21-i
-- ÉLES (production) pg_get_functiondef()-pillanatkép, NEM a repó korábbi
-- sql/cancel_order.sql / sql/restore_order.sql fájlja - azok egy, élesben
-- soha le nem futtatott, a rendelési időablakot a nap végéig kiterjesztő
-- ellenőrzést tartalmaztak. Ez a migráció szigorúan csak a Bács-Kiskun/
-- DUNAVECSE funkcióhoz szükséges változtatásokat vezeti be, a repó és az
-- éles állapot közötti korábbi driftet a sql/cancel_order.sql és
-- sql/restore_order.sql fájlok is követik (lásd ott).
--
-- Explicit tranzakcióban fut (BEGIN/COMMIT): a fájl minden utasítása
-- (ALTER TABLE, DO-blokk, CREATE [UNIQUE] INDEX - nem CONCURRENTLY -,
-- INSERT, CREATE OR REPLACE FUNCTION, DROP FUNCTION, DROP/CREATE TRIGGER,
-- REVOKE/GRANT, NOTIFY) tranzakcióbiztosan végrehajtható, egyik sem
-- szerepel a "nem futtatható tranzakcióblokkban" PostgreSQL-listán
-- (pl. nincs CONCURRENTLY, VACUUM, ALTER SYSTEM). Így ha bármelyik utasítás
-- - akár a legutolsó CREATE FUNCTION, constraint, index vagy a backfill
-- INSERT - hibázik, a teljes migráció (a kind oszlop létrehozásától az
-- összes DUNAVECSE sorig és function-újradefiniálásig) automatikusan
-- visszagördül, nem marad félkész állapot.
BEGIN;

------------------------------------------------------------------
-- 1. Séma: public.pickup_days.kind
------------------------------------------------------------------
alter table public.pickup_days
  add column if not exists kind text not null default 'normal';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pickup_days'::regclass
      and conname = 'pickup_days_kind_check'
  ) then
    alter table public.pickup_days
      add constraint pickup_days_kind_check check (kind in ('normal', 'dunavecse'));
  end if;
end $$;

-- A DUNAVECSE napra explicit módon NEM állítható be készlet-/darablimit -
-- ezt a normál napi limit oszlopok NULL-ra kényszerítésével biztosítjuk
-- adatbázis-szinten, nem csak a felületen.
alter table public.pickup_days
  alter column planned_stock drop not null,
  alter column available_stock drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pickup_days'::regclass
      and conname = 'pickup_days_kind_stock_check'
  ) then
    alter table public.pickup_days
      add constraint pickup_days_kind_stock_check check (
        (kind = 'normal' and planned_stock is not null and available_stock is not null)
        or (kind = 'dunavecse' and planned_stock is null and available_stock is null)
      );
  end if;
end $$;

-- Szezononként pontosan egy DUNAVECSE nap lehet.
create unique index if not exists pickup_days_one_dunavecse_per_season
  on public.pickup_days (season_parameter_id)
  where kind = 'dunavecse';

-- A DUNAVECSE nap dátuma szándékosan megegyezik a szezon utolsó NORMÁL
-- átvételi napjának dátumával (ez jelenik meg a Bács-Kiskun vármegyei
-- vásárlóknak "Vágási nap"-ként, lásd admin_save_season_parameters lent).
-- Ha korábban feltétel nélküli egyedi kényszer/index volt a
-- (season_parameter_id, pickup_date) páron, azt le kell cserélni egy, csak
-- a normál napokra vonatkozó részleges kényszerre, különben a DUNAVECSE nap
-- beszúrása ütközne az adott szezon utolsó normál napjával.
do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'public.pickup_days'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%season_parameter_id%'
      and pg_get_constraintdef(oid) ilike '%pickup_date%'
  loop
    execute format('alter table public.pickup_days drop constraint %I', rec.conname);
  end loop;
end $$;

do $$
declare
  rec record;
begin
  for rec in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'pickup_days'
      and indexdef ilike '%UNIQUE%'
      and indexdef ilike '%season_parameter_id%'
      and indexdef ilike '%pickup_date%'
  loop
    execute format('drop index if exists public.%I', rec.indexname);
  end loop;
end $$;

create unique index if not exists pickup_days_normal_unique_date_per_season
  on public.pickup_days (season_parameter_id, pickup_date)
  where kind = 'normal';

------------------------------------------------------------------
-- 2. Backfill: meglévő szezonokhoz utólagos DUNAVECSE nap létrehozása
------------------------------------------------------------------
insert into public.pickup_days (
  year, season, pickup_date, planned_stock, available_stock,
  is_active, serial_number, _group, season_parameter_id, kind
)
select
  sp.year, sp.season, last_normal.pickup_date, null, null,
  true, 1, 1, sp.id, 'dunavecse'
from public.season_parameters sp
join lateral (
  select max(pd.pickup_date) as pickup_date
  from public.pickup_days pd
  where pd.season_parameter_id = sp.id and pd.kind = 'normal'
) last_normal on last_normal.pickup_date is not null
where not exists (
  select 1 from public.pickup_days d
  where d.season_parameter_id = sp.id and d.kind = 'dunavecse'
);

------------------------------------------------------------------
-- 3. admin_save_season_parameters: DUNAVECSE nap automatikus létrehozása/
--    karbantartása minden mentéskor, és a kivezetett napok törlésének,
--    illetve a fizikai törlés elleni védelemnek a normál napokra
--    szűkítése (a DUNAVECSE nap sosincs a form napjai között, ezért soha
--    nem törölhető ezen a felületen).
------------------------------------------------------------------
create or replace function public.admin_save_season_parameters(season_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint := nullif(season_data ->> 'id','')::bigint;
  v_year integer := (season_data ->> 'year')::integer;
  v_season text := season_data ->> 'type';
  v_price integer := (season_data ->> 'price')::integer;
  v_weight_min numeric := (season_data ->> 'weightMin')::numeric;
  v_weight_max numeric := (season_data ->> 'weightMax')::numeric;
  v_start date := (season_data ->> 'orderStart')::date;
  v_end date := (season_data ->> 'orderEnd')::date;
  v_pickup_time_start time := (season_data ->> 'pickupTimeStart')::time;
  v_pickup_time_end time := (season_data ->> 'pickupTimeEnd')::time;
  v_local_pickup_time_start time := (season_data ->> 'localPickupTimeStart')::time;
  v_days jsonb := season_data -> 'pickupDays';
  v_active boolean := coalesce((season_data ->> 'active')::boolean, false);
  v_day jsonb; v_date date; v_limit integer; v_day_active boolean;
  v_season_id bigint;
  v_blocked_dates text;
  v_last_normal_date date;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if v_year is null or v_season not in ('Tavasz','Ősz') or v_price is null or v_price < 0
    or v_weight_min is null or v_weight_min <= 0 or v_weight_max is null or v_weight_max < v_weight_min
    or v_start is null or v_end is null or v_start > v_end
    or v_pickup_time_start is null or v_pickup_time_end is null or v_pickup_time_start >= v_pickup_time_end
    or v_local_pickup_time_start is null
    or jsonb_typeof(v_days) <> 'array'
    or jsonb_array_length(v_days) not between 1 and 5 then
    raise exception 'Érvénytelen szezonadatok.' using errcode = '22023';
  end if;
  if v_id is not null and not exists (select 1 from public.season_parameters where id = v_id) then
    raise exception 'A szezon nem található.' using errcode = 'P0002';
  end if;

  -- Olyan (normál) nap, amit a form már nem tartalmaz, de van hozzá
  -- rendelés: ezt a delete lent úgysem törölné, ezért itt, a mentés elején
  -- egyértelmű hibaüzenettel elutasítjuk, ahelyett hogy csendben megtartanánk.
  -- A DUNAVECSE napot ez a védelem nem érinti, az sosincs a form napjai
  -- között, és a hozzá tartozó rendelések önmagában a nap deaktiválásával,
  -- fizikai törlés nélkül védettek.
  if v_id is not null then
    select string_agg(to_char(p.pickup_date, 'YYYY.MM.DD'), ', ' order by p.pickup_date)
    into v_blocked_dates
    from public.pickup_days p
    where p.season_parameter_id = v_id
      and p.kind = 'normal'
      and exists (select 1 from public.orders o where o.pickup_day_id = p.id)
      and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date = p.pickup_date);

    if v_blocked_dates is not null then
      raise exception 'A következő átvételi nap(ok)hoz már van rendelés, ezért nem törölhetők: %. Deaktiválja őket törlés helyett.', v_blocked_dates
        using errcode = '22023';
    end if;
  end if;

  if v_active then
    update public.season_parameters set is_active = false where is_active and id is distinct from v_id;
    update public.pickup_days set is_active = false
      where is_active and season_parameter_id is distinct from v_id;
  end if;
  if v_id is null then
    insert into public.season_parameters(
      year, season, weight_min, weight_max, price, is_active,
      time_window_start, time_window_end, pickup_time_start, pickup_time_end, local_pickup_time_start
    )
    values(
      v_year, v_season, v_weight_min, v_weight_max, v_price, v_active,
      v_start::timestamptz, v_end::timestamptz, v_pickup_time_start, v_pickup_time_end, v_local_pickup_time_start
    )
    returning id into v_season_id;
  else
    update public.season_parameters
      set year = v_year, season = v_season, weight_min = v_weight_min, weight_max = v_weight_max,
          price = v_price, is_active = v_active, time_window_start = v_start::timestamptz, time_window_end = v_end::timestamptz,
          pickup_time_start = v_pickup_time_start, pickup_time_end = v_pickup_time_end,
          local_pickup_time_start = v_local_pickup_time_start
      where id = v_id
      returning id into v_season_id;
  end if;
  -- Kivett átvételi napok törlése; a fenti ellenőrzés miatt ide már csak
  -- olyan NORMÁL napok jutnak el, amelyekhez soha nem tartozott semmilyen
  -- (submitted vagy cancelled) rendelés - a rendelési előzmény megőrzése
  -- érdekében egy már valaha megrendelt nap fizikailag nem törölhető, csak
  -- inaktiválható. A DUNAVECSE nap (kind = 'dunavecse') ezt a törlést soha
  -- nem érinti.
  delete from public.pickup_days p where p.season_parameter_id = v_season_id
    and p.kind = 'normal'
    and not exists (select 1 from public.orders o where o.pickup_day_id = p.id)
    and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date = p.pickup_date);
  for v_day in select * from jsonb_array_elements(v_days) loop
    v_date := (v_day->>'date')::date; v_limit := (v_day->>'limit')::integer;
    v_day_active := coalesce((v_day->>'active')::boolean, true);
    update public.pickup_days
      set planned_stock = v_limit, is_active = v_day_active, year = v_year, season = v_season
      where season_parameter_id = v_season_id and pickup_date = v_date and kind = 'normal';
    if not found then
      insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
      values(v_year, v_season, v_date, v_limit, v_limit, v_day_active, 1, 1, v_season_id, 'normal');
    end if;
  end loop;

  -- DUNAVECSE technikai nap: minden szezonhoz pontosan egy tartozik,
  -- automatikusan létrehozva/karbantartva, sosem szerepel a fenti,
  -- adminisztrátor által szerkesztett napok listájában. Dátuma mindig a
  -- szezon (az imént mentett) utolsó NORMÁL átvételi napjával egyezik,
  -- ezért minden mentéskor újraszámoljuk. Az is_active mezőt itt sosem
  -- írjuk felül, hogy az admin_set_pickup_day_active-en keresztüli
  -- deaktiválás egy soron következő szezon-mentéskor ne álljon vissza
  -- csendben aktívra.
  select max(pickup_date) into v_last_normal_date
    from public.pickup_days
    where season_parameter_id = v_season_id and kind = 'normal';

  update public.pickup_days
    set pickup_date = v_last_normal_date, year = v_year, season = v_season
    where season_parameter_id = v_season_id and kind = 'dunavecse';

  if not found then
    insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
    values(v_year, v_season, v_last_normal_date, null, null, true, 1, 1, v_season_id, 'dunavecse');
  end if;

  return true;
end;
$$;

revoke all on function public.admin_save_season_parameters(jsonb) from public, anon;
grant execute on function public.admin_save_season_parameters(jsonb) to authenticated;

------------------------------------------------------------------
-- 4. finalize_order: Bács-Kiskun vármegyei vásárló felismerése és
--    automatikus DUNAVECSE-hez rendelése, a normál készletellenőrzés és
--    -csökkentés kihagyásával; minden más ellenőrzés és viselkedés a
--    korábbi (20260921000000_baseline_finalize_order.sql-ben rögzített)
--    definícióval megegyezik.
------------------------------------------------------------------
create or replace function public.finalize_order(p_season_parameter_id bigint, p_pickup_day_id bigint, p_items jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_user_id uuid;
    v_user_county text;
    v_is_bacskiskun boolean;

    v_season_year integer;
    v_season_name text;
    v_season_is_active boolean;
    v_time_window_start timestamptz;
    v_time_window_end timestamptz;

    v_effective_pickup_day_id bigint;
    v_pickup_year integer;
    v_pickup_season text;
    v_pickup_is_active boolean;
    v_pickup_kind text;
    v_available_stock integer;

    v_total_quantity integer;

    v_order_id bigint;
    v_order_version_id bigint;
    v_public_order_number text;

begin
    ------------------------------------------------------------
    -- 1. Bejelentkezett felhasználó ellenőrzése
    ------------------------------------------------------------
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'A rendelés leadásához bejelentkezés szükséges.';
    end if;


    ------------------------------------------------------------
    -- 2. Legalább egy rendelési tétel szükséges
    ------------------------------------------------------------
    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then

        raise exception
            'A rendelés nem tartalmaz rendelési tételt.';
    end if;


    ------------------------------------------------------------
    -- 3. Teljes rendelt mennyiség kiszámítása
    ------------------------------------------------------------
    select sum((item->>'quantity')::integer)
    into v_total_quantity
    from jsonb_array_elements(p_items) as item;

    if v_total_quantity is null
       or v_total_quantity <= 0 then

        raise exception
            'A rendelt mennyiség hibás.';
    end if;


    ------------------------------------------------------------
    -- 4. Szezon adatainak lekérése
    ------------------------------------------------------------
    select
        year,
        season,
        is_active,
        time_window_start,
        time_window_end
    into
        v_season_year,
        v_season_name,
        v_season_is_active,
        v_time_window_start,
        v_time_window_end
    from public.season_parameters
    where id = p_season_parameter_id;

    if not found then
        raise exception
            'A kiválasztott szezon nem létezik.';
    end if;


    ------------------------------------------------------------
    -- 5. Szezon aktivitásának ellenőrzése
    ------------------------------------------------------------
    if v_season_is_active is not true then
        raise exception
            'A kiválasztott szezon nem aktív.';
    end if;


    ------------------------------------------------------------
    -- 6. Rendelési időablak beállításának ellenőrzése
    ------------------------------------------------------------
    if v_time_window_start is null
       or v_time_window_end is null then

        raise exception
            'A rendelési időszak nincs megfelelően beállítva.';
    end if;


    ------------------------------------------------------------
    -- 7. Rendelési időablak ellenőrzése
    ------------------------------------------------------------
    if now() < v_time_window_start then
        raise exception
            'A rendelési időszak még nem kezdődött el.';
    end if;

    if now() > v_time_window_end then
        raise exception
            'A rendelési időszak már lezárult.';
    end if;


    ------------------------------------------------------------
    -- 7/A. Bács-Kiskun vármegyei vásárló felismerése (ÚJ)
    --
    -- Strukturált profiladatból, nem a kliens által beküldött
    -- pickup_day_id-ből: ez akadályozza meg, hogy egy tetszőleges
    -- pickup_day_id beküldésével bárki megkerülje a DUNAVECSE technikai
    -- nap jogosultsági ellenőrzését.
    ------------------------------------------------------------
    select trim(county) into v_user_county
    from public.profiles
    where id = v_user_id;

    v_is_bacskiskun := v_user_county = 'Bács-Kiskun';


    ------------------------------------------------------------
    -- 7/B. A ténylegesen használt átvételi nap meghatározása (ÚJ)
    --
    -- Bács-Kiskun vármegyei vásárlónál a kliens által küldött
    -- p_pickup_day_id-t figyelmen kívül hagyjuk, és mindig a szezon saját
    -- DUNAVECSE napjához rendeljük a rendelést.
    ------------------------------------------------------------
    if v_is_bacskiskun then
        select id into v_effective_pickup_day_id
        from public.pickup_days
        where season_parameter_id = p_season_parameter_id
          and kind = 'dunavecse';

        if not found then
            raise exception
                'A kiválasztott szezonhoz jelenleg nem tartozik Bács-Kiskun (DUNAVECSE) átvételi nap. Kérjük, forduljon az adminisztrátorhoz.';
        end if;
    else
        v_effective_pickup_day_id := p_pickup_day_id;
    end if;


    ------------------------------------------------------------
    -- 8. Átvételi nap zárolása és adatainak lekérése
    ------------------------------------------------------------
    select
        year,
        season,
        is_active,
        kind,
        available_stock
    into
        v_pickup_year,
        v_pickup_season,
        v_pickup_is_active,
        v_pickup_kind,
        v_available_stock
    from public.pickup_days
    where id = v_effective_pickup_day_id
    for update;

    if not found then
        raise exception
            'A kiválasztott átvételi nap nem létezik.';
    end if;


    ------------------------------------------------------------
    -- 8/A. DUNAVECSE jogosultság ellenőrzése (ÚJ)
    --
    -- Nem Bács-Kiskun vármegyei vásárló nem rendelhet a DUNAVECSE
    -- technikai napra, és fordítva - a második eset a 7/B lépés miatt a
    -- gyakorlatban nem fordulhat elő, de védelmi rétegként itt is
    -- ellenőrizzük.
    ------------------------------------------------------------
    if v_pickup_kind = 'dunavecse' and not v_is_bacskiskun then
        raise exception
            'A kiválasztott átvételi nap csak Bács-Kiskun vármegyei vásárlók számára elérhető.';
    end if;

    if v_pickup_kind = 'normal' and v_is_bacskiskun then
        raise exception
            'Bács-Kiskun vármegyei vásárlóként nem választható egyedi átvételi nap; a rendelés automatikusan a szezon vágási napjához kerül.';
    end if;


    ------------------------------------------------------------
    -- 9. Átvételi nap aktivitásának ellenőrzése
    ------------------------------------------------------------
    if v_pickup_is_active is not true then
        if v_is_bacskiskun then
            raise exception
                'A jelenlegi szezonban átmenetileg nem lehetséges rendelést leadni Bács-Kiskun vármegyei vásárlóként. Kérjük, próbálja meg később, vagy keresse az adminisztrátort.';
        end if;

        raise exception
            'A kiválasztott átvételi nap már nem aktív.';
    end if;


    ------------------------------------------------------------
    -- 10. Átvételi nap és szezon összetartozásának ellenőrzése
    ------------------------------------------------------------
    if v_pickup_year <> v_season_year
       or v_pickup_season is distinct from v_season_name then

        raise exception
            'A kiválasztott átvételi nap nem tartozik az aktuális szezonhoz.';
    end if;


    ------------------------------------------------------------
    -- 11. Aktuális készlet ellenőrzése
    --
    -- A DUNAVECSE technikai napra nem vonatkozik semmilyen
    -- készletellenőrzés - a kapacitása korlátlan.
    ------------------------------------------------------------
    if v_pickup_kind = 'normal' then
        if v_available_stock is null
           or v_available_stock < v_total_quantity then

            raise exception
                'A háttérben készlet változás történt! Elérhető: % db, igényelt: % db!',
                coalesce(v_available_stock, 0),
                v_total_quantity;
        end if;
    end if;


    ------------------------------------------------------------
    -- 12. Rendelés fejléc létrehozása
    ------------------------------------------------------------
    insert into public.orders (
        user_id,
        season_parameter_id,
        pickup_day_id,
        public_order_number
    )
    values (
        v_user_id,
        p_season_parameter_id,
        v_effective_pickup_day_id,
        public.generate_order_number()
    )
    returning
        id,
        public_order_number
    into
        v_order_id,
        v_public_order_number;


    ------------------------------------------------------------
    -- 13. Első rendelésverzió létrehozása
    ------------------------------------------------------------
    insert into public.order_versions (
        order_id,
        version_number,
        change_type,
        created_by
    )
    values (
        v_order_id,
        1,
        'created',
        v_user_id
    )
    returning id
    into v_order_version_id;


    ------------------------------------------------------------
    -- 14. Rendelési tételek létrehozása
    ------------------------------------------------------------
    insert into public.order_items (
        order_version_id,
        product_id,
        package_id,
        quantity,
        size_preference,
        note
    )
    select
        v_order_version_id,
        (item->>'product_id')::bigint,
        (item->>'package_id')::bigint,
        (item->>'quantity')::integer,
        item->>'size_preference',
        nullif(item->>'note', '')
    from jsonb_array_elements(p_items) as item;


    ------------------------------------------------------------
    -- 15. Aktuális rendelésverzió beállítása
    ------------------------------------------------------------
    update public.orders
    set current_version_id = v_order_version_id
    where id = v_order_id;


    ------------------------------------------------------------
    -- 16. Készlet csökkentése
    --
    -- A DUNAVECSE technikai nap kapacitása korlátlan, ezért ide sosem
    -- kerül készletcsökkentés.
    ------------------------------------------------------------
    if v_pickup_kind = 'normal' then
        update public.pickup_days
        set available_stock =
            available_stock - v_total_quantity
        where id = v_effective_pickup_day_id;
    end if;


    ------------------------------------------------------------
    -- 17. Publikus rendelésszám visszaadása
    ------------------------------------------------------------
    return v_public_order_number;

end;
$function$;

-- Szándékosan NINCS itt REVOKE/GRANT: a CREATE OR REPLACE FUNCTION nem
-- változtatja meg a meglévő jogosultságokat, így ez a jelenlegi éles ACL-t
-- (postgres, anon, authenticated, service_role, PUBLIC) érintetlenül hagyja
-- - ez a migráció kizárólag a Bács-Kiskun/DUNAVECSE funkcióhoz szükséges
-- változtatásokat vezeti be, jogosultsági szigorítást nem. Ha ezt később
-- mégis szigorítani kell, az külön migrációban történjen.

------------------------------------------------------------------
-- 5. update_order: meglévő DUNAVECSE rendelésnél az átvételi nap sosem
--    változtatható (a kliens által küldött p_pickup_day_id-t figyelmen
--    kívül hagyjuk), és sem normál készletellenőrzés, sem
--    -korrekció nem történik; normál rendelésnél a DUNAVECSE nap soha nem
--    választható célként. Minden más ellenőrzés és viselkedés a korábbi
--    (sql/update_order.sql-ben rögzített) definícióval megegyezik.
------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_order(bigint, jsonb);

CREATE OR REPLACE FUNCTION public.update_order(
    p_order_id bigint,
    p_items jsonb,
    p_pickup_day_id bigint DEFAULT NULL
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid;
    v_is_admin boolean := false;

    v_order_user_id uuid;
    v_season_parameter_id bigint;
    v_old_pickup_day_id bigint;
    v_old_pickup_kind text;
    v_new_pickup_day_id bigint;
    v_new_pickup_kind text;
    v_current_version_id bigint;
    v_public_order_number text;
    v_order_status text;

    v_time_window_start timestamptz;
    v_time_window_end timestamptz;

    v_old_pickup_date timestamp without time zone;
    v_old_available_stock integer;

    v_new_pickup_date timestamp without time zone;
    v_new_available_stock integer;

    v_pickup_day_changed boolean;

    v_old_total_quantity integer;
    v_new_total_quantity integer;
    v_quantity_difference integer;

    v_new_version_number integer;
    v_new_order_version_id bigint;

begin
    ------------------------------------------------------------
    -- 1. Bejelentkezett felhasználó ellenőrzése
    ------------------------------------------------------------
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'A rendelés módosításához bejelentkezés szükséges.';
    end if;


    ------------------------------------------------------------
    -- 2. Admin jogosultság meghatározása
    ------------------------------------------------------------
    select exists (
        select 1
        from public.user_roles
        where user_id = v_user_id
          and role = 'admin'
    )
    into v_is_admin;


    ------------------------------------------------------------
    -- 3. Legalább egy rendelési tétel szükséges
    ------------------------------------------------------------
    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then

        raise exception
            'A rendelés nem tartalmaz rendelési tételt.';
    end if;


    ------------------------------------------------------------
    -- 4. Új teljes rendelt mennyiség kiszámítása
    ------------------------------------------------------------
    select sum((item->>'quantity')::integer)
    into v_new_total_quantity
    from jsonb_array_elements(p_items) as item;

    if v_new_total_quantity is null
       or v_new_total_quantity <= 0 then

        raise exception
            'A rendelt mennyiség hibás.';
    end if;


    ------------------------------------------------------------
    -- 5. Rendelés zárolása és adatainak lekérése
    ------------------------------------------------------------
    select
        user_id,
        season_parameter_id,
        pickup_day_id,
        current_version_id,
        public_order_number,
        status
    into
        v_order_user_id,
        v_season_parameter_id,
        v_old_pickup_day_id,
        v_current_version_id,
        v_public_order_number,
        v_order_status
    from public.orders
    where id = p_order_id
    for update;

    if not found then
        raise exception
            'A módosítandó rendelés nem létezik.';
    end if;

    select kind into v_old_pickup_kind
    from public.pickup_days
    where id = v_old_pickup_day_id;

    -- DUNAVECSE rendelésnél az átvételi nap sosem módosítható - a kliens
    -- által esetlegesen küldött p_pickup_day_id-t figyelmen kívül hagyjuk,
    -- ezzel sem a vásárló, sem az admin nem tudja (akár véletlenül sem)
    -- másik napra áthelyezni.
    v_new_pickup_day_id := case
        when v_old_pickup_kind = 'dunavecse' then v_old_pickup_day_id
        else coalesce(p_pickup_day_id, v_old_pickup_day_id)
    end;
    v_pickup_day_changed := v_new_pickup_day_id <> v_old_pickup_day_id;


    ------------------------------------------------------------
    -- 6. Jogosultság ellenőrzése
    --
    -- Normál felhasználó csak a saját rendelését módosíthatja.
    -- Admin bármely felhasználó rendelését módosíthatja.
    ------------------------------------------------------------
    if v_order_user_id <> v_user_id
       and not v_is_admin then

        raise exception
            'Nincs jogosultsága ennek a rendelésnek a módosításához.';
    end if;


    ------------------------------------------------------------
    -- 7. Rendelés státuszának ellenőrzése
    ------------------------------------------------------------
    if v_order_status <> 'submitted' then
        raise exception
            'Ez a rendelés már nem módosítható.';
    end if;


    ------------------------------------------------------------
    -- 8. Aktuális rendelésverzió ellenőrzése
    ------------------------------------------------------------
    if v_current_version_id is null then
        raise exception
            'A rendelés aktuális verziója nem található.';
    end if;


    ------------------------------------------------------------
    -- 9. Átvételi nap(ok) zárolása és készlet lekérése
    --
    -- Napváltás esetén mindkét érintett napot zároljuk, mindig a
    -- kisebb id-jű sorral kezdve, hogy két párhuzamos, egymással
    -- ellentétes irányú napváltás ne okozzon holtpontot (deadlock).
    -- DUNAVECSE rendelésnél v_pickup_day_changed a fenti lépés miatt
    -- mindig false, ezért ez mindig a "nincs napváltás" ágon fut le.
    ------------------------------------------------------------
    if not v_pickup_day_changed then

        select available_stock, pickup_date
        into v_old_available_stock, v_old_pickup_date
        from public.pickup_days
        where id = v_old_pickup_day_id
        for update;

        if not found then
            raise exception
                'A rendeléshez tartozó átvételi nap nem létezik.';
        end if;

    elsif v_old_pickup_day_id < v_new_pickup_day_id then

        select available_stock, pickup_date
        into v_old_available_stock, v_old_pickup_date
        from public.pickup_days
        where id = v_old_pickup_day_id
        for update;

        if not found then
            raise exception
                'A rendeléshez tartozó átvételi nap nem létezik.';
        end if;

        select available_stock, pickup_date, kind
        into v_new_available_stock, v_new_pickup_date, v_new_pickup_kind
        from public.pickup_days
        where id = v_new_pickup_day_id
        for update;

        if not found then
            raise exception
                'A kiválasztott új átvételi nap nem létezik.';
        end if;

        if v_new_pickup_kind = 'dunavecse' then
            raise exception
                'A DUNAVECSE technikai nap nem választható átvételi napként.';
        end if;

    else

        select available_stock, pickup_date, kind
        into v_new_available_stock, v_new_pickup_date, v_new_pickup_kind
        from public.pickup_days
        where id = v_new_pickup_day_id
        for update;

        if not found then
            raise exception
                'A kiválasztott új átvételi nap nem létezik.';
        end if;

        if v_new_pickup_kind = 'dunavecse' then
            raise exception
                'A DUNAVECSE technikai nap nem választható átvételi napként.';
        end if;

        select available_stock, pickup_date
        into v_old_available_stock, v_old_pickup_date
        from public.pickup_days
        where id = v_old_pickup_day_id
        for update;

        if not found then
            raise exception
                'A rendeléshez tartozó átvételi nap nem létezik.';
        end if;

    end if;


    ------------------------------------------------------------
    -- 10. Elmúlt átvételi nap ellenőrzése
    --
    -- A jelenlegi (régi) átvétel napján még módosítható a rendelés,
    -- a következő naptól mindenki számára lezárt. Napváltás esetén
    -- az új nap sem eshet a múltba.
    ------------------------------------------------------------
    if v_old_pickup_date::date < current_date then
        raise exception
            'Az átvételi nap már elmúlt, a rendelés nem módosítható.';
    end if;

    if v_pickup_day_changed
       and v_new_pickup_date::date < current_date then

        raise exception
            'A kiválasztott új átvételi nap már elmúlt.';
    end if;


    ------------------------------------------------------------
    -- 11. Normál felhasználónál rendelési időablak ellenőrzése
    --
    -- Admin esetén ezt teljesen kihagyjuk.
    ------------------------------------------------------------
    if not v_is_admin then

        select
            time_window_start,
            time_window_end
        into
            v_time_window_start,
            v_time_window_end
        from public.season_parameters
        where id = v_season_parameter_id;

        if not found then
            raise exception
                'A rendeléshez tartozó szezon nem található.';
        end if;


        if v_time_window_start is null
           or v_time_window_end is null then

            raise exception
                'A rendelési időszak nincs megfelelően beállítva.';
        end if;


        if now() < v_time_window_start then
            raise exception
                'A rendelési időszak még nem kezdődött el.';
        end if;


        if now() > v_time_window_end then
            raise exception
                'A rendelési időszak már lezárult, a rendelés nem módosítható.';
        end if;

    end if;


    ------------------------------------------------------------
    -- 12. Régi teljes rendelt mennyiség meghatározása
    ------------------------------------------------------------
    select coalesce(sum(quantity), 0)
    into v_old_total_quantity
    from public.order_items
    where order_version_id = v_current_version_id;


    ------------------------------------------------------------
    -- 13. Készlet ellenőrzése
    --
    -- A DUNAVECSE technikai napra nem vonatkozik semmilyen
    -- készletellenőrzés - a kapacitása korlátlan. Azonos (normál) napon
    -- maradva csak a mennyiségi növekményre van szükség (a meglévő
    -- foglalás a helyén marad). Napváltáskor a teljes új mennyiségre van
    -- szükség az új napon, hiszen ott a rendelésnek jelenleg semmilyen
    -- foglalása nincs.
    ------------------------------------------------------------
    if v_old_pickup_kind = 'dunavecse' then

        null;

    elsif not v_pickup_day_changed then

        v_quantity_difference := v_new_total_quantity - v_old_total_quantity;

        if v_quantity_difference > 0
           and (v_old_available_stock is null
                or v_old_available_stock < v_quantity_difference) then

            raise exception
                'A háttérben készlet változás történt! Elérhető: % db, további igény: % db!',
                coalesce(v_old_available_stock, 0),
                v_quantity_difference;
        end if;

    else

        if v_new_available_stock is null
           or v_new_available_stock < v_new_total_quantity then

            raise exception
                'A kiválasztott átvételi napon nincs elegendő készlet a rendeléshez! Elérhető: % db, igény: % db!',
                coalesce(v_new_available_stock, 0),
                v_new_total_quantity;
        end if;

    end if;


    ------------------------------------------------------------
    -- 14. Következő verziószám meghatározása
    ------------------------------------------------------------
    select coalesce(max(version_number), 0) + 1
    into v_new_version_number
    from public.order_versions
    where order_id = p_order_id;


    ------------------------------------------------------------
    -- 15. Új rendelésverzió létrehozása
    ------------------------------------------------------------
    insert into public.order_versions (
        order_id,
        version_number,
        change_type,
        created_by
    )
    values (
        p_order_id,
        v_new_version_number,
        'modified',
        v_user_id
    )
    returning id
    into v_new_order_version_id;


    ------------------------------------------------------------
    -- 16. Új verzió rendelési tételeinek létrehozása
    ------------------------------------------------------------
    insert into public.order_items (
        order_version_id,
        product_id,
        package_id,
        quantity,
        size_preference,
        note
    )
    select
        v_new_order_version_id,
        (item->>'product_id')::bigint,
        (item->>'package_id')::bigint,
        (item->>'quantity')::integer,
        item->>'size_preference',
        nullif(item->>'note', '')
    from jsonb_array_elements(p_items) as item;


    ------------------------------------------------------------
    -- 17. Rendelés aktuális verziójának (és szükség esetén az
    -- átvételi napjának) átállítása
    ------------------------------------------------------------
    update public.orders
    set current_version_id = v_new_order_version_id,
        pickup_day_id = v_new_pickup_day_id
    where id = p_order_id;


    ------------------------------------------------------------
    -- 18. Készlet korrigálása
    --
    -- A DUNAVECSE technikai nap kapacitása korlátlan, ezért ide sosem
    -- kerül készletkorrekció.
    ------------------------------------------------------------
    if v_old_pickup_kind = 'dunavecse' then

        null;

    elsif not v_pickup_day_changed then

        update public.pickup_days
        set available_stock = available_stock - v_quantity_difference
        where id = v_old_pickup_day_id;

    else

        update public.pickup_days
        set available_stock = available_stock + v_old_total_quantity
        where id = v_old_pickup_day_id;

        update public.pickup_days
        set available_stock = available_stock - v_new_total_quantity
        where id = v_new_pickup_day_id;

    end if;


    ------------------------------------------------------------
    -- 19. Publikus rendelésszám visszaadása
    ------------------------------------------------------------
    return v_public_order_number;

end;
$function$;

REVOKE ALL ON FUNCTION public.update_order(bigint, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order(bigint, jsonb, bigint) TO authenticated;

------------------------------------------------------------------
-- 6. cancel_order: DUNAVECSE rendelés lemondásakor nem történik normál
--    készlet-visszatöltés (a kapacitása korlátlan, nincs mit visszaadni).
--
--    FONTOS: ez a verzió a 2026.09.21-i ÉLES pg_get_functiondef()-snapshot
--    alapján készült (egyszerű `now() > v_time_window_end` ellenőrzéssel),
--    NEM a repó korábbi sql/cancel_order.sql-je alapján - az utóbbi egy,
--    élesben soha le nem futtatott, a rendelési időablakot a nap végéig
--    ("Europe/Budapest" + 23:59:59.999999) kiterjesztő változatot
--    tartalmazott. Ez a migráció szándékosan NEM vezeti be azt a - ezzel
--    nem kapcsolatos - változtatást, hogy szigorúan a Bács-Kiskun/
--    DUNAVECSE funkcióra korlátozódjon.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_is_admin boolean;
    v_order_user_id uuid;
    v_season_parameter_id bigint;
    v_pickup_day_id bigint;
    v_current_version_id bigint;
    v_public_order_number text;
    v_order_status text;
    v_time_window_start timestamptz;
    v_time_window_end timestamptz;
    v_pickup_date date;
    v_pickup_kind text;
    v_old_total_quantity integer;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION
            'A rendelés lemondásához bejelentkezés szükséges.';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles AS ur
        WHERE ur.user_id = v_user_id
          AND ur.role = 'admin'
    )
    INTO v_is_admin;

    SELECT
        o.user_id,
        o.season_parameter_id,
        o.pickup_day_id,
        o.current_version_id,
        o.public_order_number,
        o.status
    INTO
        v_order_user_id,
        v_season_parameter_id,
        v_pickup_day_id,
        v_current_version_id,
        v_public_order_number,
        v_order_status
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'A lemondandó rendelés nem létezik.';
    END IF;

    IF v_order_user_id IS DISTINCT FROM v_user_id
       AND NOT v_is_admin THEN
        RAISE EXCEPTION
            'Nincs jogosultsága ennek a rendelésnek a lemondásához.';
    END IF;

    IF v_order_status IS DISTINCT FROM 'submitted' THEN
        RAISE EXCEPTION
            'Ez a rendelés már nem mondható le.';
    END IF;

    SELECT
        sp.time_window_start,
        sp.time_window_end
    INTO
        v_time_window_start,
        v_time_window_end
    FROM public.season_parameters AS sp
    WHERE sp.id = v_season_parameter_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'A rendeléshez tartozó szezon nem található.';
    END IF;

    IF v_time_window_start IS NULL
       OR v_time_window_end IS NULL THEN
        RAISE EXCEPTION
            'A rendelési időszak nincs megfelelően beállítva.';
    END IF;

    IF now() < v_time_window_start THEN
        RAISE EXCEPTION
            'A rendelési időszak még nem kezdődött el.';
    END IF;

    IF now() > v_time_window_end THEN
        RAISE EXCEPTION
            'A rendelési időszak már lezárult, a rendelés nem mondható le.';
    END IF;

    IF v_current_version_id IS NULL THEN
        RAISE EXCEPTION
            'A rendelés aktuális verziója nem található.';
    END IF;

    SELECT coalesce(sum(oi.quantity), 0)
    INTO v_old_total_quantity
    FROM public.order_items AS oi
    WHERE oi.order_version_id = v_current_version_id;

    IF v_old_total_quantity <= 0 THEN
        RAISE EXCEPTION
            'A rendeléshez nem tartozik érvényes rendelési mennyiség.';
    END IF;

    -- Átvételi nap zárolása és a teljesített rendelések védelme. A kind
    -- mezőt is lekérjük (ÚJ), hogy a DUNAVECSE technikai napra ne
    -- próbáljunk normál készletet visszatölteni.
    SELECT pd.pickup_date, pd.kind
    INTO v_pickup_date, v_pickup_kind
    FROM public.pickup_days AS pd
    WHERE pd.id = v_pickup_day_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'A rendeléshez tartozó átvételi nap nem létezik.';
    END IF;

    IF v_pickup_date IS NULL THEN
        RAISE EXCEPTION
            'A rendeléshez nincs érvényes átvételi dátum megadva.';
    END IF;

    IF v_pickup_date <
       (clock_timestamp() AT TIME ZONE 'Europe/Budapest')::date THEN
        RAISE EXCEPTION
            'Teljesített rendelés nem törölhető.';
    END IF;

    UPDATE public.orders
    SET
        status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_user_id
    WHERE id = p_order_id;

    -- Készlet visszaadása. A DUNAVECSE technikai nap kapacitása korlátlan
    -- (ÚJ), ezért ide sosem kerül készlet-visszatöltés.
    IF v_pickup_kind = 'normal' THEN
        UPDATE public.pickup_days
        SET available_stock =
            available_stock + v_old_total_quantity
        WHERE id = v_pickup_day_id;
    END IF;

    RETURN v_public_order_number;
END;
$function$
;

-- Szándékosan NINCS itt REVOKE/GRANT - lásd a finalize_order-nél fent írt
-- megjegyzést; a cancel_order jelenlegi éles ACL-je (postgres, anon,
-- authenticated, service_role, PUBLIC) érintetlen marad.

------------------------------------------------------------------
-- 7. restore_order: DUNAVECSE rendelés visszaállításakor nincs
--    készletkapacitás-ellenőrzés (korábban ez tévesen mindig meghiúsult
--    volna, hiszen a DUNAVECSE nap available_stock mezője NULL), és nem
--    történik normál készletfoglalás sem.
--
--    FONTOS: ez a verzió a 2026.09.21-i ÉLES pg_get_functiondef()-snapshot
--    alapján készült (egyszerű `clock_timestamp() > v_time_window_end`
--    ellenőrzéssel), NEM a repó korábbi sql/restore_order.sql-je alapján -
--    lásd a cancel_order-nél fent írt megjegyzést.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_order(p_order_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_order public.orders%ROWTYPE;
    v_pickup public.pickup_days%ROWTYPE;
    v_time_window_start timestamptz;
    v_time_window_end timestamptz;
    v_quantity bigint;
BEGIN
    IF v_user_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = v_user_id
          AND role = 'admin'
    ) THEN
        RAISE EXCEPTION
            'A rendelés visszaállításához adminisztrátori jogosultság szükséges.';
    END IF;

    SELECT *
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A visszaállítandó rendelés nem létezik.';
    END IF;

    IF v_order.status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Csak lemondott rendelés állítható vissza.';
    END IF;

    SELECT time_window_start, time_window_end
    INTO v_time_window_start, v_time_window_end
    FROM public.season_parameters
    WHERE id = v_order.season_parameter_id;

    IF NOT FOUND
       OR v_time_window_start IS NULL
       OR v_time_window_end IS NULL THEN
        RAISE EXCEPTION
            'A rendelési időszak nincs megfelelően beállítva.';
    END IF;

    IF v_order.current_version_id IS NULL THEN
        RAISE EXCEPTION
            'A rendelés aktuális verziója nem található.';
    END IF;

    SELECT coalesce(sum(quantity), 0)
    INTO v_quantity
    FROM public.order_items
    WHERE order_version_id = v_order.current_version_id;

    IF v_quantity <= 0 THEN
        RAISE EXCEPTION
            'A rendeléshez nem tartozik érvényes rendelési mennyiség.';
    END IF;

    -- Átvételi nap zárolása. A tábla időközben (fentebb, ebben a
    -- migrációban) bővült a kind oszloppal, ezért a v_pickup.kind (ÚJ) a
    -- SELECT *-ból automatikusan elérhető.
    SELECT *
    INTO v_pickup
    FROM public.pickup_days
    WHERE id = v_order.pickup_day_id
    FOR UPDATE;

    IF NOT FOUND OR v_pickup.pickup_date IS NULL THEN
        RAISE EXCEPTION
            'A rendeléshez nincs érvényes átvételi nap megadva.';
    END IF;

    IF v_pickup.pickup_date <
       (clock_timestamp() AT TIME ZONE 'Europe/Budapest')::date THEN
        RAISE EXCEPTION
            'Elmúlt átvételi dátumú rendelés nem állítható vissza.';
    END IF;

    IF clock_timestamp() < v_time_window_start
       OR clock_timestamp() > v_time_window_end THEN
        RAISE EXCEPTION
            'A rendelési időszakon kívül a rendelés nem állítható vissza.';
    END IF;

    -- A DUNAVECSE technikai nap kapacitása korlátlan (ÚJ), ezért ide sem
    -- kapacitás-ellenőrzés, sem készletfoglalás nem vonatkozik.
    IF v_pickup.kind = 'normal' THEN
        IF v_pickup.available_stock IS NULL
           OR v_pickup.available_stock < v_quantity THEN
            RAISE EXCEPTION
                'Nincs elegendő szabad készlet a rendelés visszaállításához.';
        END IF;

        UPDATE public.pickup_days
        SET available_stock = available_stock - v_quantity
        WHERE id = v_order.pickup_day_id;
    END IF;

    UPDATE public.orders
    SET status = 'submitted',
        cancelled_at = NULL,
        cancelled_by = NULL
    WHERE id = p_order_id;

    RETURN v_order.public_order_number;
END;
$function$
;

REVOKE ALL ON FUNCTION public.restore_order(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_order(bigint) TO authenticated;

------------------------------------------------------------------
-- 8. enforce_size_preference_limit: a DUNAVECSE technikai napra ne
--    vonatkozzon a méretpreferenciánkénti napi 1-1 fős korlát - ennek a
--    korlátnak a szűkös normál napi kapacitás védelme a célja, a
--    DUNAVECSE nap kapacitása viszont korlátlan.
------------------------------------------------------------------
create or replace function public.enforce_size_preference_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_preference text;
  v_pickup_kind text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    return new;
  end if;

  select kind into v_pickup_kind from public.pickup_days where id = new.pickup_day_id;

  if v_pickup_kind = 'dunavecse' then
    return new;
  end if;

  select special_size_preference into v_preference
  from public.profiles where id = new.user_id;

  if v_preference is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pickup_day_size_preference:' || new.pickup_day_id || ':' || v_preference, 0)
  );

  if exists (
    select 1
    from public.orders o
    join public.profiles p on p.id = o.user_id
    where o.pickup_day_id = new.pickup_day_id
      and o.status = 'submitted'
      and o.user_id <> new.user_id
      and p.special_size_preference = v_preference
  ) then
    raise exception 'Erre a napra már foglalt a keret a(z) "%" méretpreferenciájú vásárlók számára.',
      case v_preference when 'smaller' then 'Kisebb méret preferáció' else 'Nagyobb méret preferáció' end
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_size_preference_limit on public.orders;
create trigger trg_enforce_size_preference_limit
  before insert or update of pickup_day_id, current_version_id on public.orders
  for each row execute function public.enforce_size_preference_limit();

-- Ne jelentsen ki a hívónak (a preorder oldal napválasztójának) lezárt
-- keretet a DUNAVECSE technikai napra, hiszen az sosem szerepel a
-- felkínált átvételi napok között.
create or replace function public.get_size_preference_locks()
returns table(pickup_day_id bigint, preference text)
language sql security definer stable set search_path = '' as $$
  select distinct o.pickup_day_id, p.special_size_preference as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  join public.pickup_days pd on pd.id = o.pickup_day_id
  where o.status = 'submitted'
    and p.special_size_preference is not null
    and o.user_id is distinct from auth.uid()
    and pd.kind = 'normal'
$$;

revoke all on function public.get_size_preference_locks() from public, anon;
grant execute on function public.get_size_preference_locks() to authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
