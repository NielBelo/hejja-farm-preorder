-- Az előrendelési időablak KEZDETÉNEK (time_window_start) normalizálása
-- Europe/Budapest éjfélre - a time_window_end oszlopra ezt már bevezette a
-- sql/normalize_order_window_end.sql (normalize_season_time_window_end
-- trigger), de a KEZDŐ időpontra soha nem készült el a párja.
--
-- Gyökérok: az admin_save_season_parameters() (lásd
-- 20260918000000_season_pickup_time_window.sql) a beérkező, csak dátumot
-- tartalmazó orderStart mezőt egyszerűen `v_start::timestamptz`-re kasztolja.
-- Egy bare `date` -> `timestamptz` kasztolás Postgresben az adatbázis-
-- munkamenet TimeZone beállítása szerinti éjfélként értelmeződik - Supabase-en
-- ez alapértelmezetten UTC, NEM Europe/Budapest. Emiatt a ténylegesen
-- eltárolt time_window_start pillanat 1-2 órával (téli/nyári időszámítástól
-- függően) KÉSŐBBRE esik, mint a budapesti éjfél, amit az admin ténylegesen
-- megadott.
--
-- Ennek két, egymástól független, de ugyanabból a gyökérokból fakadó
-- következménye volt:
--   1. Kliensoldalon a lib/orderWindow.ts getOrderWindowStart() a nyers
--      time_window_start-ból csak a budapesti NAPTÁRI NAPOT olvassa ki, majd
--      ahhoz maga rekonstruál budapesti éjfélt - ez a kijelzést és a
--      visszaszámlálót helyesen, budapesti éjfélre időzíti.
--   2. Szerveroldalon viszont a rendelés-leadást/módosítást/lemondást/
--      visszaállítást végző SQL függvények (finalize_order, update_order,
--      cancel_order, restore_order) a NYERS, normalizálatlan
--      time_window_start-ot hasonlítják `now()`-hoz - tehát a tényleges
--      nyitás 1-2 órával KÉSŐBB történik meg, mint amit a kliens
--      visszaszámlálója budapesti éjfélre ígért.
--
-- A javítás a normalize_season_time_window_end mintáját követi: egy BEFORE
-- INSERT OR UPDATE OF time_window_start trigger mindig budapesti éjfélre
-- (00:00:00.000000, Europe/Budapest) normalizálja az értéket, az IANA
-- időzóna-adatbázison (AT TIME ZONE 'Europe/Budapest') keresztül - ez
-- automatikusan kezeli a CET/CEST váltást, nincs hardcode-olt +01:00/+02:00
-- eltolás. Ezáltal a DB-ben ténylegesen tárolt pillanat, a szerveroldali
-- `now() < time_window_start` ellenőrzések és a kliensoldali
-- getOrderWindowStart() kimenete ugyanarra a pillanatra fog esni.
BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_season_time_window_start()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.time_window_start IS NOT NULL THEN
        NEW.time_window_start := (
            (NEW.time_window_start AT TIME ZONE 'Europe/Budapest')::date
            + time '00:00:00'
        ) AT TIME ZONE 'Europe/Budapest';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_season_time_window_start
ON public.season_parameters;

CREATE TRIGGER normalize_season_time_window_start
BEFORE INSERT OR UPDATE OF time_window_start
ON public.season_parameters
FOR EACH ROW
EXECUTE FUNCTION public.normalize_season_time_window_start();

-- A már létező szezonok értékeit is átvezeti a fenti szabályon.
UPDATE public.season_parameters
SET time_window_start = time_window_start
WHERE time_window_start IS NOT NULL;

COMMIT;
