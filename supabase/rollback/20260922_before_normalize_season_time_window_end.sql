-- ROLLBACK - a 20260922020000_normalize_season_time_window_end.sql
-- migráció ELŐTTI állapot visszaállítása.
--
-- FONTOS KORLÁTOZÁS: a normalize_season_time_window_end() function és a
-- hozzá tartozó trigger a migráció ELŐTT - a repóban lévő
-- sql/normalize_order_window_end.sql fájl ellenére - éles adatbázisban
-- ténylegesen NEM létezett (2026-09-23-i production ellenőrzéssel igazolva:
-- a season_parameters.time_window_end értékei kerek UTC éjfélek voltak, nem
-- a trigger által előállított "XX:59:59.999999" mintázat). Ez tehát egy
-- vadonatúj trigger éles bevezetése, nem egy meglévő function felülírása,
-- ezért ez a rollback egyszerűen eltávolítja mindkettőt - nincs "korábbi
-- éles definíció", amit vissza kellene írni.
--
-- Amit ez a rollback NEM tud visszaállítani: a migráció végén futó
--   UPDATE public.season_parameters SET time_window_end = time_window_end
--   WHERE time_window_end IS NOT NULL;
-- ténylegesen ÁTÍRTA a meglévő sorok time_window_end értékét (a naptári nap
-- megőrzésével, budapesti nap végére normalizálva). Ez a session nem fért
-- hozzá éles adatbázishoz, így nem tudtuk előre lementeni a migráció előtti
-- nyers értékeket ezen a fájlon belül. Ha a visszaállításnak az eredeti
-- (hibás, kora reggeli budapesti időpontként tárolt) értékeket is pontosan
-- vissza kellene állítania, A MIGRÁCIÓ FUTTATÁSA ELŐTT mentsd le:
--   SELECT id, time_window_end FROM public.season_parameters;
-- és azt az exportot használd a visszaállításhoz. Enélkül ez a rollback csak
-- a trigger/function eltávolítását végzi el - a már normalizált (helyes)
-- time_window_end értékek a season_parameters táblában megmaradnak.
--
-- A normalize_season_time_window_start triggert (20260922010000) ez a
-- rollback NEM érinti - az egy külön oszlopra (time_window_start) felfűzött,
-- önálló trigger, ettől a visszavonástól függetlenül működik tovább.
--
-- Használat: csak akkor fusson, ha a 20260922020000 migrációt (a
-- time_window_end budapesti nap végére normalizálása) vissza kell vonni.

BEGIN;

DROP TRIGGER IF EXISTS normalize_season_time_window_end
ON public.season_parameters;

DROP FUNCTION IF EXISTS public.normalize_season_time_window_end();

NOTIFY pgrst, 'reload schema';

COMMIT;
