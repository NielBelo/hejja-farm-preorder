-- A meglévő függvény cseréje a Supabase SQL Editorban.
-- Önmagában a script futtatása nem mond le rendelést.
-- Az admin szerepkör forrása: public.user_roles (user_id, role = 'admin').
-- Az időablak korlátozása minden felhasználóra, az adminra is megmarad.
-- A user_roles módosítását csak megbízható adminisztráció engedélyezheti.

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    -- 1. Bejelentkezés és admin szerepkör ellenőrzése.
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'A rendelés lemondásához bejelentkezés szükséges.';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles AS ur
        WHERE ur.user_id = v_user_id
          AND ur.role = 'admin'
    ) INTO v_is_admin;

    -- 2. Rendelés zárolása: párhuzamos lemondás nem adhatja vissza kétszer a készletet.
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
        RAISE EXCEPTION 'A lemondandó rendelés nem létezik.';
    END IF;

    -- 3. A tulajdonos vagy az admin mondhatja le a rendelést.
    IF v_order_user_id IS DISTINCT FROM v_user_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Nincs jogosultsága ennek a rendelésnek a lemondásához.';
    END IF;

    -- 4. Csak leadott rendelés mondható le.
    IF v_order_status IS DISTINCT FROM 'submitted' THEN
        RAISE EXCEPTION 'Ez a rendelés már nem mondható le.';
    END IF;

    -- 5. A meglévő szezon- és időablak-szabályok változatlanok.
    SELECT sp.time_window_start, sp.time_window_end
    INTO v_time_window_start, v_time_window_end
    FROM public.season_parameters AS sp
    WHERE sp.id = v_season_parameter_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A rendeléshez tartozó szezon nem található.';
    END IF;

    IF v_time_window_start IS NULL OR v_time_window_end IS NULL THEN
        RAISE EXCEPTION 'A rendelési időszak nincs megfelelően beállítva.';
    END IF;

    IF now() < v_time_window_start THEN
        RAISE EXCEPTION 'A rendelési időszak még nem kezdődött el.';
    END IF;

    IF now() > (
        (
            (v_time_window_end AT TIME ZONE 'Europe/Budapest')::date
            + time '23:59:59.999999'
        ) AT TIME ZONE 'Europe/Budapest'
    ) THEN
        RAISE EXCEPTION 'A rendelési időszak már lezárult, a rendelés nem mondható le.';
    END IF;

    -- 6. Aktuális rendelésverzió és visszaadandó mennyiség.
    IF v_current_version_id IS NULL THEN
        RAISE EXCEPTION 'A rendelés aktuális verziója nem található.';
    END IF;

    SELECT coalesce(sum(oi.quantity), 0)
    INTO v_old_total_quantity
    FROM public.order_items AS oi
    WHERE oi.order_version_id = v_current_version_id;

    IF v_old_total_quantity <= 0 THEN
        RAISE EXCEPTION 'A rendeléshez nem tartozik érvényes rendelési mennyiség.';
    END IF;

    -- 7. Átvételi nap zárolása és a teljesített rendelések védelme.
    SELECT pd.pickup_date
    INTO v_pickup_date
    FROM public.pickup_days AS pd
    WHERE pd.id = v_pickup_day_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A rendeléshez tartozó átvételi nap nem létezik.';
    END IF;

    IF v_pickup_date IS NULL THEN
        RAISE EXCEPTION 'A rendeléshez nincs érvényes átvételi dátum megadva.';
    END IF;

    -- Az átvétel napja végéig aktuális, a magyar időzóna szerint.
    -- A zárolásra várakozás után is a tényleges aktuális dátumot ellenőrizzük.
    IF v_pickup_date < (clock_timestamp() AT TIME ZONE 'Europe/Budapest')::date THEN
        RAISE EXCEPTION 'Teljesített rendelés nem törölhető.';
    END IF;

    -- 8. Soft törlés: a rendelés és a tételek az adatbázisban maradnak.
    UPDATE public.orders
    SET
        status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_user_id
    WHERE id = p_order_id;

    -- 9. Készlet visszaadása, ugyanabban a tranzakcióban.
    UPDATE public.pickup_days
    SET available_stock = available_stock + v_old_total_quantity
    WHERE id = v_pickup_day_id;

    RETURN v_public_order_number;
END;
$$;
