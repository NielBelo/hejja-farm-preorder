-- Rollback a 20260930000000_reminder_sends.sql migrációhoz.
--
-- Mivel ez a migráció KIZÁRÓLAG új objektumokat hoz létre (nincs benne
-- meglévő függvény/trigger/constraint újradefiniálása), a rollback nem egy
-- korábbi éles definíció visszaállítása, hanem egyszerűen az újonnan
-- létrehozott objektumok eltávolítása - a tábla és a benne felgyűlt napló
-- (reminder_sends) is törlődik, mivel az kizárólag ehhez a funkcióhoz
-- tartozik, más funkció nem hivatkozik rá.
--
-- Explicit tranzakcióban fut, hogy hiba esetén ne maradjon félkész állapot.
BEGIN;

drop function if exists public.finalize_reminder_send(bigint, text, text, text);
drop function if exists public.claim_reminder_send(bigint, bigint, text);
drop table if exists public.reminder_sends;

COMMIT;
