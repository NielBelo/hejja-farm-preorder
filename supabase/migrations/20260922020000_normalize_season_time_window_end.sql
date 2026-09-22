-- Az előrendelési időablak ZÁRÁSÁNAK (time_window_end) normalizálása
-- Europe/Budapest nap végére (23:59:59.999999 helyi idő).
--
-- Előzmény: a sql/normalize_order_window_end.sql fájl már 2026-09-ben
-- (e0e0077 "feat: improve order confirmation emails") megírta ugyanezt a
-- function/trigger-logikát, DE azt soha nem adták ki éles migrációként - nem
-- része a supabase/migrations/ történetnek, és production ellenőrzéssel
-- (2026-09-23) igazolhatóan SOHA nem futott le: a season_parameters éles
-- sorainak time_window_end értéke kerek UTC éjfél volt (pl.
-- "2026-10-02 00:00:00+00"), nem a trigger által előállított
-- "XX:59:59.999999" mintázat. Ez a migráció ugyanazt a logikát adja ki
-- szabályos, verziózott formában, a 20260922010000-ben a time_window_start-ra
-- már bevezetett mintát követve.
--
-- Gyökérok (azonos a time_window_start hibájával): az
-- admin_save_season_parameters() (lásd
-- 20260918000000_season_pickup_time_window.sql) a beérkező, csak dátumot
-- tartalmazó orderEnd mezőt egyszerűen `v_end::timestamptz`-re kasztolja. Egy
-- bare `date` -> `timestamptz` kasztolás Postgresben az adatbázis-munkamenet
-- TimeZone beállítása szerinti éjfélként értelmeződik - Supabase-en ez
-- alapértelmezetten UTC, NEM Europe/Budapest. Emiatt a ténylegesen eltárolt
-- time_window_end pillanat a kiválasztott nap KORA REGGELÉRE esik budapesti
-- idő szerint (01:00 vagy 02:00, évszaktól függően), NEM a nap végére.
--
-- Ennek két, egymástól független, de ugyanabból a gyökérokból fakadó
-- következménye volt:
--   1. Kliensoldalon a lib/orderWindow.ts getOrderWindowEnd() a nyers
--      time_window_end-ből csak a budapesti NAPTÁRI NAPOT olvassa ki, majd
--      ahhoz maga rekonstruál budapesti nap véget (23:59:59.999) - ez a
--      kijelzést és a visszaszámlálót (CountdownCard), valamint az
--      e-mail-értesítéseket (formatOrderWindowEnd) helyesen, a nap végére
--      időzíti.
--   2. Szerveroldalon viszont a rendelés-leadást/módosítást/lemondást/
--      visszaállítást végző SQL függvények (finalize_order, update_order,
--      cancel_order, restore_order) a NYERS, normalizálatlan
--      time_window_end-et hasonlítják `now()`-hoz - tehát a tényleges zárás
--      ~22-23 órával KORÁBBAN történik meg, mint amit a kliens
--      visszaszámlálója (a nap végét) ígért. Vásárlók a felület szerint még
--      bőven rendelkezésre álló időben ("X óra van hátra") ténylegesen már
--      elutasítást kaphattak a rendelés leadásakor/módosításakor.
--
-- A javítás a normalize_season_time_window_start mintáját követi (lásd
-- 20260922010000_normalize_season_time_window_start.sql): egy BEFORE INSERT
-- OR UPDATE OF time_window_end trigger mindig a kiválasztott naptári nap
-- végére (23:59:59.999999, Europe/Budapest) normalizálja az értéket, az IANA
-- időzóna-adatbázison (AT TIME ZONE 'Europe/Budapest') keresztül - ez
-- automatikusan kezeli a CET/CEST váltást, nincs hardcode-olt +01:00/+02:00
-- eltolás. A normalizálás a NAPTÁRI NAPOT a bemeneti (akár már hibás) érték
-- budapesti naptári napjából olvassa ki, tehát a backfill a jelenlegi hibás
-- érték napját őrzi meg, csak az órát/percet igazítja a nap végére - pl.
-- "2026-10-02 00:00:00+00" (= 2026-10-02 02:00 Budapest) ->
-- "2026-10-02 23:59:59.999999 Europe/Budapest" = "2026-10-02 21:59:59.999999+00",
-- NEM október 1-re vagy 3-ra csúszik át.
--
-- Ütközésmentesség a normalize_season_time_window_start triggerrel és az
-- admin_save_season_parameters()-szel: a két trigger különböző oszlopokra
-- (time_window_start, illetve time_window_end) van felfűzve `BEFORE INSERT
-- OR UPDATE OF <oszlop>` feltétellel, így egymástól függetlenül, csak a saját
-- oszlopuk módosításakor futnak - nincs átfedés vagy sorrend-függőség
-- közöttük. Az admin_save_season_parameters() UPDATE/INSERT-je mindkét
-- oszlopot egyszerre írja (lásd 20260918000000_season_pickup_time_window.sql
-- 55-71. sor), ami mindkét trigger lefutását kiváltja ugyanabban a
-- sorműveletben - ez a triggerek szempontjából szabályos, hiszen mindkettő
-- csak a saját NEW mezőjét olvassa/írja, a másikét nem érinti.
BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_season_time_window_end()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.time_window_end IS NOT NULL THEN
        NEW.time_window_end := (
            (NEW.time_window_end AT TIME ZONE 'Europe/Budapest')::date
            + time '23:59:59.999999'
        ) AT TIME ZONE 'Europe/Budapest';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_season_time_window_end
ON public.season_parameters;

CREATE TRIGGER normalize_season_time_window_end
BEFORE INSERT OR UPDATE OF time_window_end
ON public.season_parameters
FOR EACH ROW
EXECUTE FUNCTION public.normalize_season_time_window_end();

-- A már létező szezonok értékeit is átvezeti a fenti szabályon - a naptári
-- napot megőrzi, csak a nap-végi időpontra igazítja.
UPDATE public.season_parameters
SET time_window_end = time_window_end
WHERE time_window_end IS NOT NULL;

COMMIT;
