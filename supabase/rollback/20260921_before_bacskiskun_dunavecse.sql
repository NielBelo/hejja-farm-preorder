-- ROLLBACK - a 20260921000000_baseline_finalize_order.sql és a
-- 20260921010000_bacskiskun_dunavecse.sql migrációk ELŐTTI, tényleges éles
-- (production) állapot visszaállítása.
--
-- Ez a fájl NEM automatikus, vak visszaállító script: a pg_get_functiondef(),
-- pg_get_triggerdef() és az ACL-lekérdezés 2026.09.21-i, éles adatbázisból
-- exportált eredménye alapján készült (lásd a beszélgetés snapshot-ját), és
-- kizárólag a function/RPC és trigger definíciókat, valamint azok
-- jogosultságait (GRANT/REVOKE) állítja vissza szó szerint az akkori éles
-- értékükre.
--
-- FONTOS, ÉLESBEN MEGERŐSÍTETT ELTÉRÉS a repó sql/ mappájától:
-- Az éles cancel_order és restore_order NEM tartalmazza a
-- sql/cancel_order.sql / sql/restore_order.sql fájlokban szereplő, a
-- rendelési időablakot a nap végéig ("Europe/Budapest" + 23:59:59.999999)
-- kiterjesztő logikát - élesben ezek egyszerű `now() > v_time_window_end`
-- (cancel_order), illetve `clock_timestamp() > v_time_window_end`
-- (restore_order) ellenőrzést tartalmaznak. Ez a rollback fájl a TÉNYLEGES
-- éles verziót állítja vissza, nem a repó sql/ mappájában lévőt.
--
-- Ez a fájl szándékosan NEM tartalmaz séma-szintű (pickup_days.kind, új
-- constraint-ek/indexek) rollbacket - azokhoz lásd a fájl végén lévő,
-- külön dokumentált, NEM automatikusan futtatandó tervet.
--
-- Használat: csak akkor fusson, ha a Bács-Kiskun/DUNAVECSE migrációt
-- (részben vagy egészben) vissza kell vonni, és a régi RPC-viselkedést
-- gyorsan helyre kell állítani.

BEGIN;

------------------------------------------------------------------
-- 1. admin_save_season_parameters(jsonb)
--    Owner: postgres · SECURITY DEFINER · search_path = ''
--    Grants: postgres, authenticated, service_role (nincs anon/PUBLIC)
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_season_parameters(season_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v_id is not null then
    select string_agg(to_char(p.pickup_date, 'YYYY.MM.DD'), ', ' order by p.pickup_date)
    into v_blocked_dates
    from public.pickup_days p
    where p.season_parameter_id = v_id
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
  delete from public.pickup_days p where p.season_parameter_id = v_season_id
    and not exists (select 1 from public.orders o where o.pickup_day_id = p.id)
    and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date = p.pickup_date);
  for v_day in select * from jsonb_array_elements(v_days) loop
    v_date := (v_day->>'date')::date; v_limit := (v_day->>'limit')::integer;
    v_day_active := coalesce((v_day->>'active')::boolean, true);
    update public.pickup_days
      set planned_stock = v_limit, is_active = v_day_active, year = v_year, season = v_season
      where season_parameter_id = v_season_id and pickup_date = v_date;
    if not found then
      insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id)
      values(v_year, v_season, v_date, v_limit, v_limit, v_day_active, 1, 1, v_season_id);
    end if;
  end loop;
  return true;
end;
$function$
;

REVOKE ALL ON FUNCTION public.admin_save_season_parameters(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_season_parameters(jsonb) TO authenticated;

------------------------------------------------------------------
-- 2. finalize_order(bigint, bigint, jsonb)
--    Owner: postgres · SECURITY DEFINER · search_path = public
--    Grants: postgres, anon, authenticated, service_role, PUBLIC (sosem
--    futott rá explicit REVOKE) - sem a forward migráció, sem ez a rollback
--    nem nyúl a jogosultságokhoz, ezért ez a lépés csak a function body-t
--    állítja vissza, a jelenlegi ACL-t érintetlenül hagyja.
------------------------------------------------------------------
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
-- változtatja meg a meglévő jogosultságokat, ezért ez a lépés érintetlenül
-- hagyja bármi legyen is a function ACL-je a rollback futtatásakor.

------------------------------------------------------------------
-- 3. update_order(bigint, jsonb, bigint)
--    Owner: postgres · SECURITY DEFINER · search_path = public
--    Grants: postgres, authenticated, service_role (nincs anon/PUBLIC)
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order(p_order_id bigint, p_items jsonb, p_pickup_day_id bigint DEFAULT NULL::bigint)
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
    v_new_pickup_day_id bigint;
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

    v_new_pickup_day_id := coalesce(p_pickup_day_id, v_old_pickup_day_id);
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

        select available_stock, pickup_date
        into v_new_available_stock, v_new_pickup_date
        from public.pickup_days
        where id = v_new_pickup_day_id
        for update;

        if not found then
            raise exception
                'A kiválasztott új átvételi nap nem létezik.';
        end if;

    else

        select available_stock, pickup_date
        into v_new_available_stock, v_new_pickup_date
        from public.pickup_days
        where id = v_new_pickup_day_id
        for update;

        if not found then
            raise exception
                'A kiválasztott új átvételi nap nem létezik.';
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
    -- Azonos napon maradva csak a mennyiségi növekményre van szükség
    -- (a meglévő foglalás a helyén marad). Napváltáskor a teljes új
    -- mennyiségre van szükség az új napon, hiszen ott a rendelésnek
    -- jelenleg semmilyen foglalása nincs.
    ------------------------------------------------------------
    if not v_pickup_day_changed then

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
    ------------------------------------------------------------
    if not v_pickup_day_changed then

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
$function$
;

REVOKE ALL ON FUNCTION public.update_order(bigint, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order(bigint, jsonb, bigint) TO authenticated;

------------------------------------------------------------------
-- 4. cancel_order(bigint)
--    Owner: postgres · SECURITY DEFINER · search_path = ''
--    Grants: postgres, anon, authenticated, service_role, PUBLIC (sosem
--    futott rá explicit REVOKE) - ez a rollback csak a function body-t
--    állítja vissza, a jogosultságokhoz nem nyúl.
--
--    Ez a TÉNYLEGES, 2026.09.21-én éles verzió, amely EGYSZERŰ
--    `now() > v_time_window_end` ellenőrzést használ (a repóban korábban
--    szereplő, élesben soha nem futott, nap végéig kiterjesztett
--    ellenőrzés NÉLKÜL - ezt a sql/cancel_order.sql fájl is már ugyanígy
--    tükrözi).
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

    SELECT pd.pickup_date
    INTO v_pickup_date
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

    UPDATE public.pickup_days
    SET available_stock =
        available_stock + v_old_total_quantity
    WHERE id = v_pickup_day_id;

    RETURN v_public_order_number;
END;
$function$
;

-- Élesben sosem futott rá explicit REVOKE/GRANT (lásd fent) - ha
-- változtatás nélkül vissza akarod állítani a korábbi állapotot, ezt a két
-- sort hagyd ki. Ha a szigorúbb, csak-authenticated hozzáférést szeretnéd
-- megtartani a régi function-nel is, futtasd:
-- REVOKE ALL ON FUNCTION public.cancel_order(bigint) FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.cancel_order(bigint) TO authenticated;

------------------------------------------------------------------
-- 5. restore_order(bigint)
--    Owner: postgres · SECURITY DEFINER · search_path = ''
--    Grants: postgres, authenticated, service_role (nincs anon/PUBLIC)
--
--    FIGYELEM: ugyanaz az eltérés, mint a cancel_order-nél - ez a
--    TÉNYLEGES éles verzió, a nap végéig kiterjesztett ellenőrzés NÉLKÜL.
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

    IF v_pickup.available_stock IS NULL
       OR v_pickup.available_stock < v_quantity THEN
        RAISE EXCEPTION
            'Nincs elegendő szabad készlet a rendelés visszaállításához.';
    END IF;

    UPDATE public.pickup_days
    SET available_stock = available_stock - v_quantity
    WHERE id = v_order.pickup_day_id;

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
-- 6. enforce_size_preference_limit() - trigger function
--    Owner: postgres · SECURITY DEFINER · search_path = ''
--    Éles grants (visszaállítás előtt): postgres, anon, authenticated,
--    service_role, PUBLIC. Lásd a finalize_order-nél írt megjegyzést.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_size_preference_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_preference text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
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
$function$
;

-- Élesben sosem futott rá explicit REVOKE/GRANT (lásd fent). Ha a
-- szigorúbb, csak-authenticated hozzáférést szeretnéd megtartani a régi
-- function-nel is, futtasd:
-- REVOKE ALL ON FUNCTION public.enforce_size_preference_limit() FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.enforce_size_preference_limit() TO authenticated;

------------------------------------------------------------------
-- 7. trg_enforce_size_preference_limit trigger a public.orders táblán
--    (a függvény fenti visszaállítása után újra ugyanoda mutat, de a
--    trigger definíciója maga nem változott a migrációban - a teljesség
--    kedvéért mégis expliciten újra létrehozzuk, pontosan az éles
--    definíció szerint).
------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_enforce_size_preference_limit ON public.orders;
CREATE TRIGGER trg_enforce_size_preference_limit
  BEFORE INSERT OR UPDATE OF pickup_day_id, current_version_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION enforce_size_preference_limit();

------------------------------------------------------------------
-- 8. get_size_preference_locks()
--    Owner: postgres · SECURITY DEFINER · STABLE · search_path = ''
--    Grants: postgres, authenticated, service_role (nincs anon/PUBLIC)
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_size_preference_locks()
 RETURNS TABLE(pickup_day_id bigint, preference text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select distinct o.pickup_day_id, p.special_size_preference as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  where o.status = 'submitted'
    and p.special_size_preference is not null
    and o.user_id is distinct from auth.uid()
$function$
;

REVOKE ALL ON FUNCTION public.get_size_preference_locks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_size_preference_locks() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

------------------------------------------------------------------
-- SÉMA-OLDALI ROLLBACK - NEM AUTOMATIKUS, KÜLÖN VÉGREHAJTANDÓ TERV
------------------------------------------------------------------
-- A 20260921010000_bacskiskun_dunavecse.sql által a public.pickup_days
-- táblán végzett séma-módosítások és a hozzájuk tartozó, KÉZI mérlegelést
-- igénylő visszaállítási lépések. Ezt a blokkot SZÁNDÉKOSAN nem futtatja a
-- fenti tranzakció - csak akkor futtasd (részben vagy egészben), ha a
-- séma-szintű változásokat is vissza kell vonni.
--
-- Élesben (2026.09.21-i pillanatkép alapján) a pickup_days tábla ELŐZETES
-- állapota:
--   - Egyetlen index létezik: pickup_days_pkey (a PRIMARY KEY (id) sajátja).
--   - Egyetlen egyedi (unique) constraint sincs a
--     (season_parameter_id, pickup_date) oszlopokon - tehát a migráció
--     "keresd meg és dobd el, ha van ilyen" DO-blokkjai ÉLESBEN NEM
--     találnak semmit, biztonságos no-op-ok. Nincs mit visszaállítani ezen
--     a ponton.
--   - planned_stock és available_stock ÉLESBEN MÁR JELENLEG IS NULLABLE
--     (nincs rajtuk NOT NULL constraint) - tehát a migráció
--     "ALTER COLUMN ... DROP NOT NULL" lépései is no-op-ok élesben.
--     NE add hozzá vissza a NOT NULL constraint-et rollback gyanánt, mert
--     az egy ÚJ, korábban sosem létezett megszorítást vezetne be.
--
-- Emiatt az egyetlen ÉRDEMI, ténylegesen új séma-elem, amit a migráció
-- bevezet, az az alábbi öt objektum - ezek eldobása biztonságos, amíg a
-- 'kind' oszlopot ('dunavecse' értékkel rendelkező sorokat) nem törlöd:
--
-- -- 1) Az új indexek eldobása (biztonságos, nincs adatvesztés):
-- DROP INDEX IF EXISTS public.pickup_days_one_dunavecse_per_season;
-- DROP INDEX IF EXISTS public.pickup_days_normal_unique_date_per_season;
--
-- -- 2) Az új constraint-ek eldobása (biztonságos, nincs adatvesztés):
-- ALTER TABLE public.pickup_days DROP CONSTRAINT IF EXISTS pickup_days_kind_stock_check;
-- ALTER TABLE public.pickup_days DROP CONSTRAINT IF EXISTS pickup_days_kind_check;
--
-- -- 3) A 'kind' oszlop eldobása - ADATVESZTŐ, csak akkor, ha biztosan nem
-- --    kellenek többé a DUNAVECSE napok/rendelések megkülönböztetésére.
-- --    A régi RPC-k (fenti rollback) ettől függetlenül működnek, mert egy
-- --    plusz oszlop megléte önmagában nem befolyásolja a régi function-öket
-- --    - tehát ez a lépés NEM feltétele a funkcionális rollbacknek.
-- -- ALTER TABLE public.pickup_days DROP COLUMN IF EXISTS kind;
--
-- -- 4) A backfill/DUNAVECSE által beszúrt pickup_days sorok törlése -
-- --    ADATVESZTŐ, ha már vannak hozzájuk kötött rendelések (orders),
-- --    azok FOREIGN KEY miatt úgysem törölhetők törlés előtt. Csak akkor
-- --    fontold meg, ha biztosan tudod, hogy egyetlen DUNAVECSE némpra sem
-- --    érkezett még rendelés:
-- -- DELETE FROM public.pickup_days WHERE kind = 'dunavecse';
--
-- Javasolt sorrend visszavonáskor: előbb a fenti tranzakciós RPC/trigger
-- rollback (funkcionális visszaállítás - az alkalmazás azonnal a régi
-- logikával fut), a séma-oldali 1-2. pontot csak akkor, ha a régi kód
-- semmilyen formában nem hivatkozik többé a 'kind' oszlopra vagy az új
-- indexekre/constraint-ekre, a 3-4. pontot pedig csak végső esetben,
-- tudatos adatvesztéssel együtt.
