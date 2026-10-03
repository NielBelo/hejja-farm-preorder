-- Kiterjeszti public.claim_reminder_send visszatérési értékét
-- attempted_at-tel, hogy a hívó (lib/email/sendReminderEmail.ts) meg tudja
-- állapítani, mióta van egy "sending" állapotú sor lefoglalva - ez a
-- "sending" állapot crash/recovery kezelésének alapja:
--
--   friss "sending"  (attempted_at nemrég) -> más worker épp dolgozik rajta,
--                                             csendben skip (nem attempt).
--   stale "sending"  (attempted_at régen)  -> a claimelő worker szinte
--                                             biztosan megszakadt (crash/
--                                             timeout) MIELŐTT
--                                             finalize_reminder_send
--                                             lefuthatott volna - NEM
--                                             tudjuk biztosan, hogy az
--                                             SMTP2GO elküldte-e az
--                                             e-mailt, ezért ilyenkor SOHA
--                                             nem indul automatikus retry
--                                             (az dupla ügyfél-e-mailt
--                                             okozhatna). Ehelyett
--                                             "bizonytalan" (uncertain)
--                                             eredményként jelenik meg az
--                                             admin futásösszesítőben,
--                                             kézi ellenőrzésre várva.
--
-- A "friss"/"stale" határ (küszöbidő) a TS oldalon dől el (lásd
-- lib/email/reminderStaleness.ts), NEM itt az SQL-ben - ezért ELÉG az
-- attempted_at nyers timestamptz visszaadása, nem kell új, tárolt
-- állapotérték vagy külön "stale" oszlop/enum-bővítés. A tábla sémáját,
-- a claim_reminder_send/finalize_reminder_send döntési logikáját és a
-- "pending"/"sending"/"sent"/"failed" állapotgépet ez a migráció NEM
-- változtatja meg, kizárólag a claim_reminder_send RETURNS TABLE-jét
-- bővíti egyetlen oszloppal.
--
-- A RETURNS TABLE oszloplistája változik, ezért Postgres-ben a
-- CREATE OR REPLACE FUNCTION nem elég (az csak azonos visszatérési típus
-- mellett működik) - előbb DROP FUNCTION, utána CREATE FUNCTION szükséges.
--
-- Explicit tranzakcióban fut (BEGIN/COMMIT): minden utasítása
-- tranzakcióbiztosan végrehajtható, így hiba esetén a teljes migráció
-- visszagördül, nem marad félkész állapot (pl. nem maradhat a régi
-- függvény eldobva, az új még létrehozatlanul).
BEGIN;

drop function if exists public.claim_reminder_send(bigint, bigint, text);

create function public.claim_reminder_send(
  p_order_id bigint,
  p_pickup_day_id bigint,
  p_reminder_type text default 'pickup_reminder'
)
returns table (id bigint, claimed boolean, status text, attempted_at timestamptz)
language plpgsql
security definer
-- Üres search_path: minden hivatkozás már eleve "public."-tal kvalifikált
-- (a lenti UPDATE "r" aliasán keresztül minősített "r.id"/"r.status"/
-- "r.attempted_at" hivatkozások kivételek - azok nem schema-feloldások,
-- hanem az UPDATE céltáblájának explicit aliasa, ezt a search_path nem
-- befolyásolja, lásd a migráció végi jegyzetet).
set search_path = ''
as $$
declare
  v_id bigint;
  v_status text;
  v_attempted_at timestamptz;
begin
  -- 1. Ha a sor még nem létezik, létrehozzuk "pending" állapotban. Két
  -- egyidejű beszúrás esetén a UNIQUE kényszer + ON CONFLICT DO NOTHING
  -- miatt csak egy sor jön létre, mindkét hívó ugyanazt a sort látja utána.
  insert into public.reminder_sends (order_id, pickup_day_id, reminder_type, status)
  values (p_order_id, p_pickup_day_id, p_reminder_type, 'pending')
  on conflict (order_id, pickup_day_id, reminder_type) do nothing;

  -- 2. Atomikus "lefoglalás": csak akkor vált "sending"-re, ha a sor épp
  -- "pending" vagy "failed" (azaz retry-olható). Ha két worker egyszerre
  -- próbálja, a második UPDATE a Postgres sorszintű zárolása miatt
  -- megvárja az elsőt, majd a WHERE feltétele már nem illeszkedik (a sor
  -- időközben "sending"-re váltott), így affected rows = 0 lesz neki.
  --
  -- FONTOS: egy már "sending" állapotú sort ez a lépés SOHA nem foglal le
  -- újra - függetlenül attól, hogy mióta van abban az állapotban. A
  -- stale/friss megkülönböztetés szándékosan NEM itt, hanem a hívó
  -- oldalán (TS) történik, éppen azért, hogy stale "sending" esetén se
  -- induljon soha vak, automatikus újraküldés.
  -- A céltábla "r" aliast kap, és MINDEN WHERE/RETURNING hivatkozás
  -- explicit "r."-vel minősített - ez nem séma-feloldási kérdés (azt a
  -- search_path = '' külön kezeli fent), hanem PL/pgSQL OUT-paraméter
  -- ütközés elleni védelem: a "returns table (id bigint, claimed boolean,
  -- status text, attempted_at timestamptz)" miatt a függvénynek "id",
  -- "status" ÉS "attempted_at" nevű, automatikusan létrehozott
  -- OUT-változója is van, ami a reminder_sends tábla azonos nevű
  -- oszlopaival ütközik. A Postgres default plpgsql.variable_conflict =
  -- 'error' beállítása mellett egy bare "id"/"status"/"attempted_at"
  -- hivatkozás futásidőben "column reference ... is ambiguous" hibát dob -
  -- ezt egy valódi Postgres-en futtatott kézi teszt
  -- (sql/reminder_sends_manual_test_production_safe.sql) tárta fel a
  -- WHERE-beli "status in (...)" sornál. A SET cél-oszlopok (status =,
  -- attempted_at =, updated_at =) NEM igényelnek/nem is kaphatnak "r."
  -- előtagot: az UPDATE SET bal oldalán álló oszlopnév szintaktikailag
  -- sosem oldódhat fel PL/pgSQL-változóként, kizárólag táblaoszlopként.
  update public.reminder_sends r
  set status = 'sending', attempted_at = now(), updated_at = now()
  where r.order_id = p_order_id
    and r.pickup_day_id = p_pickup_day_id
    and r.reminder_type = p_reminder_type
    and r.status in ('pending', 'failed')
  returning r.id, r.attempted_at into v_id, v_attempted_at;

  if v_id is not null then
    return query select v_id, true, 'sending'::text, v_attempted_at;
    return;
  end if;

  -- Nem sikerült lefoglalni (már "sent", vagy épp "sending" - akár friss,
  -- akár stale) - visszaadjuk a jelenlegi állapotot ÉS az attempted_at-et,
  -- hogy a hívó el tudja dönteni, a "sending" friss-e vagy stale.
  select r.id, r.status, r.attempted_at into v_id, v_status, v_attempted_at
  from public.reminder_sends r
  where r.order_id = p_order_id
    and r.pickup_day_id = p_pickup_day_id
    and r.reminder_type = p_reminder_type;

  return query select v_id, false, v_status, v_attempted_at;
end;
$$;

-- Lásd a 20260930000000_reminder_sends.sql-ben lévő részletes jegyzetet:
-- ez az RPC csak a Cloudflare scheduled workerből hívódik (service role
-- kulccsal), sosem bejelentkezett felhasználói kontextusból - ezért "anon"/
-- "authenticated" EXECUTE jogot sem itt, sem a rollbackben nem kaphat.
revoke all on function public.claim_reminder_send(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_reminder_send(bigint, bigint, text) to service_role;

-- Jegyzet a search_path = ''-hez: a fenti UPDATE public.reminder_sends r
-- ... sorban az "r" egy explicit SQL alias (nem séma-feloldás, tehát NEM a
-- search_path dönti el, melyik "reminder_sends" nevű objektumra mutat) - ezt
-- az UPDATE public.reminder_sends r sor már egyértelműen, teljesen
-- kvalifikált táblanévvel rögzítette. Emiatt az "r."-vel minősített
-- hivatkozások biztonságosak üres search_path mellett is.
--
-- Az "r." minősítés nem csak search_path-biztonsági, hanem elsősorban
-- PL/pgSQL-helyességi okból szükséges: a "returns table (id bigint,
-- claimed boolean, status text, attempted_at timestamptz)" miatt a
-- függvénynek van "id", "status" ÉS "attempted_at" nevű, automatikusan
-- létrehozott OUT-változója is, ami bare (nem minősített) formában
-- ütközne a céltábla azonos nevű oszlopaival (plpgsql.variable_conflict
-- default = 'error' -> futásidejű "column reference ... is ambiguous"
-- hiba minden sikeres lefoglaláskor/retry-nál). Egy valódi Postgres-en
-- futtatott kézi teszt (sql/reminder_sends_manual_test_production_safe.sql)
-- pontosan ezt a hibát tárta fel a WHERE-beli bare "status in (...)"
-- hivatkozásnál - az "id" és "attempted_at" korábban már minősítve volt,
-- de a "status" nem, és az UPDATE SET cél-oszlopok (status =,
-- attempted_at =, updated_at =) szintaktikailag mindig bare oszlopnevek
-- kell legyenek, azokon ez a minősítés nem alkalmazható és nem is
-- szükséges.
COMMIT;
