-- ROLLBACK - a 20260922010000_normalize_season_time_window_start.sql
-- migráció ELŐTTI állapot visszaállítása.
--
-- FONTOS KORLÁTOZÁS: a normalize_season_time_window_start() function és a
-- hozzá tartozó trigger a migráció ELŐTT nem létezett (ez egy vadonatúj
-- trigger, nem egy meglévő function felülírása), ezért ez a rollback
-- egyszerűen eltávolítja mindkettőt - nincs "korábbi definíció", amit vissza
-- kellene írni.
--
-- Amit ez a rollback NEM tud visszaállítani: a migráció végén futó
--   UPDATE public.season_parameters SET time_window_start = time_window_start
--   WHERE time_window_start IS NOT NULL;
-- ténylegesen ÁTÍRTA a meglévő sorok time_window_start értékét (budapesti
-- éjfélre normalizálva). Ez a session nem fért hozzá éles adatbázishoz, így
-- nem tudtuk előre lementeni a migráció előtti nyers értékeket. Ha a
-- visszaállításnak az eredeti (hibás, UTC-ben "éjfélnek" tárolt) értékeket is
-- pontosan vissza kellene állítania, A MIGRÁCIÓ FUTTATÁSA ELŐTT mentsd le:
--   SELECT id, time_window_start FROM public.season_parameters;
-- és azt az exportot használd a visszaállításhoz. Enélkül ez a rollback csak
-- a trigger/function eltávolítását végzi el - a már normalizált (helyes)
-- time_window_start értékek a season_parameters táblában megmaradnak.
--
-- Használat: csak akkor fusson, ha a 20260922010000 migrációt (a
-- time_window_start budapesti éjfélre normalizálása) vissza kell vonni.

BEGIN;

DROP TRIGGER IF EXISTS normalize_season_time_window_start
ON public.season_parameters;

DROP FUNCTION IF EXISTS public.normalize_season_time_window_start();

NOTIFY pgrst, 'reload schema';

COMMIT;
