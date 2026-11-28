-- Rollback a 20261128010000_season_launch_sends.sql migrációhoz.
-- A migráció csak új objektumokat hozott létre, ezért a visszavonás törlés.
-- FIGYELEM: a season_launch_sends tábla (küldési napló) tartalma elvész.
BEGIN;

DROP FUNCTION IF EXISTS public.claim_season_launch_send(bigint, uuid, text);
DROP FUNCTION IF EXISTS public.finalize_season_launch_send(bigint, text, text, text);
DROP TABLE IF EXISTS public.season_launch_sends;

COMMIT;
