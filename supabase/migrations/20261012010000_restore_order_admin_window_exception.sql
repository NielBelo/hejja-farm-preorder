-- restore_order: az előrendelési időablak ellenőrzésének eltávolítása.
--
-- Probléma: a restore_order eleve csak adminnak használható, de az időablakon
-- kívül ("A rendelési időszakon kívül a rendelés nem állítható vissza.")
-- az admin sem tudott lemondott rendelést visszaállítani.
-- Változás: kizárólag ez az egy IF-blokk törlődik. Az admin-ellenőrzés, az elmúlt
-- átvételi nap tiltása, a készletellenőrzés/-foglalás és a státuszváltás
-- változatlan. A szezon-beállítás meglétét ellenőrző blokk is megmarad.
-- Alap: az éles definíció a 2026-10-12-i pg_get_functiondef() snapshotból.
-- CREATE OR REPLACE: tulajdonos és jogosultságok megmaradnak; csak az
-- orders.status/cancelled_* mezőket írja, így az orders triggerek
-- (pickup_day_id/current_version_id oszlopokra) nem aktiválódnak.
-- Rollback: supabase/rollback/20261012_before_restore_order_admin_window_exception.sql

begin;

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
$function$;

commit;
