-- finalize_order eddig NEM volt verziózva ebben a migrációs mappában (lásd a
-- 20260919000000_pickup_day_activation.sql és a
-- 20260920000000_size_preference_pickup_limit.sql megjegyzéseit) - a
-- forráskódja csak élesben, a Supabase-ben létezett. Ez a migráció önmagában
-- SEMMILYEN funkcionális változást nem hoz: a jelenleg éles definíciót
-- rögzíti szóról szóra (pg_get_functiondef('public.finalize_order'::regprocedure)
-- kimenete alapján, 2026.09.21-én), hogy a következő migráció (a
-- Bács-Kiskun/DUNAVECSE funkció) már egy verziózott, ellenőrizhető alapra
-- épülhessen.
--
-- Explicit tranzakcióban fut (BEGIN/COMMIT): minden benne szereplő utasítás
-- (CREATE OR REPLACE FUNCTION, NOTIFY) tranzakcióbiztosan végrehajtható,
-- nincs köztük CONCURRENTLY-s vagy más, tranzakción kívül futtatandó
-- parancs - így ha bármi hibázna, a teljes fájl rollback-elődik, nem marad
-- félkész állapot.
BEGIN;

CREATE OR REPLACE FUNCTION public.finalize_order(p_season_parameter_id bigint, p_pickup_day_id bigint, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid;

    v_season_year integer;
    v_season_name text;
    v_season_is_active boolean;
    v_time_window_start timestamptz;
    v_time_window_end timestamptz;

    v_pickup_year integer;
    v_pickup_season text;
    v_pickup_is_active boolean;
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
    -- 8. Átvételi nap zárolása és adatainak lekérése
    ------------------------------------------------------------
    select
        year,
        season,
        is_active,
        available_stock
    into
        v_pickup_year,
        v_pickup_season,
        v_pickup_is_active,
        v_available_stock
    from public.pickup_days
    where id = p_pickup_day_id
    for update;

    if not found then
        raise exception
            'A kiválasztott átvételi nap nem létezik.';
    end if;


    ------------------------------------------------------------
    -- 9. Átvételi nap aktivitásának ellenőrzése
    ------------------------------------------------------------
    if v_pickup_is_active is not true then
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
    ------------------------------------------------------------
    if v_available_stock is null
       or v_available_stock < v_total_quantity then

        raise exception
            'A háttérben készlet változás történt! Elérhető: % db, igényelt: % db!',
            coalesce(v_available_stock, 0),
            v_total_quantity;
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
        p_pickup_day_id,
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
    ------------------------------------------------------------
    update public.pickup_days
    set available_stock =
        available_stock - v_total_quantity
    where id = p_pickup_day_id;


    ------------------------------------------------------------
    -- 17. Publikus rendelésszám visszaadása
    ------------------------------------------------------------
    return v_public_order_number;

end;
$function$
;

-- Szándékosan NINCS itt REVOKE/GRANT: a CREATE OR REPLACE FUNCTION nem
-- változtatja meg a függvény meglévő jogosultságait (ugyanaz az oid marad),
-- így ez a fájl a jelenlegi éles ACL-t (postgres, anon, authenticated,
-- service_role, PUBLIC - lásd a fájl elején lévő megjegyzést) érintetlenül
-- hagyja. A baseline célja kizárólag a jelenlegi definíció verziózása, nem
-- jogosultsági szigorítás.

NOTIFY pgrst, 'reload schema';

COMMIT;
