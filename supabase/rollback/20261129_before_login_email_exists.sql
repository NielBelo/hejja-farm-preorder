-- Rollback a 20261129020000_login_email_exists.sql migrációhoz.
-- A migráció csak új függvényt hozott létre, ezért a visszavonás törlés.
-- (A login a függvény hiányában az általános hibaüzenetre esik vissza.)
BEGIN;

DROP FUNCTION IF EXISTS public.login_email_exists(text);

COMMIT;
