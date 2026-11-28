-- Rollback a 20261128020000_keepalive.sql migrációhoz.
-- A migráció csak új objektumot hozott létre, ezért a visszavonás törlés.
BEGIN;

DROP TABLE IF EXISTS public.keepalive;

COMMIT;
