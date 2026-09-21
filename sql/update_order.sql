-- Futtatandó a Supabase SQL Editorban a felület használata előtt.
-- A meglévő update_order(p_order_id, p_items, p_pickup_day_id) függvény
-- cseréje: DUNAVECSE (Bács-Kiskun) rendelésnél az átvételi nap sosem
-- módosítható, és sem normál készletellenőrzés, sem -korrekció nem
-- történik; normál rendelésnél a DUNAVECSE nap soha nem választható
-- célként. Lásd:
-- supabase/migrations/20260921010000_bacskiskun_dunavecse.sql
--
-- Napváltás nélkül (p_pickup_day_id = NULL vagy a jelenlegi nappal egyezik)
-- a viselkedés bitre ugyanaz, mint korábban: csak a mennyiségi különbség
-- kerül le-/visszaírásra ugyanazon az átvételi napon.
--
-- Napváltás esetén a régi átvételi nap készlete visszakapja a rendelés
-- teljes korábbi mennyiségét, az új átvételi nap készletéből pedig levonásra
-- kerül a rendelés teljes új mennyisége - ugyanabban a tranzakcióban, mint
-- az új rendelésverzió és a rendelési tételek létrehozása.
BEGIN;

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

-- A REST API séma-gyorsítótárának frissítése, hogy az RPC azonnal felismerhető legyen.
NOTIFY pgrst, 'reload schema';

COMMIT;
