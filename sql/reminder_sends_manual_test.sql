-- Kézi tesztterv a reminder_sends táblához és a claim_reminder_send /
-- finalize_reminder_send RPC-khez.
--
-- Futtatás: Supabase SQL Editor, KIZÁRÓLAG a
-- supabase/migrations/20260930000000_reminder_sends.sql és
-- supabase/migrations/20260930010000_reminder_sends_claim_attempted_at.sql
-- migrációk alkalmazása UTÁN.
--
-- Ez a szkript BEGIN/ROLLBACK-be van csomagolva: sikeres vagy sikertelen
-- lefutás esetén is VISSZAGÖRDÜL, a végén semmilyen teszt-adat nem marad az
-- adatbázisban. Előfeltétel: legalább EGY valós sor létezzen a
-- public.orders táblában (kettő esetén a failed/retry forgatókönyv is
-- lefut, lásd lent).
--
-- Ha bármelyik ASSERT hamis, a DO blokk hibával leáll, és a hibaüzenet
-- pontosan megmondja, melyik lépés bukott el.
--
-- FIGYELEM - 8. lépés (ON DELETE CASCADE teszt): ez a lépés egy kifejezetten
-- a teszthez létrehozott, eldobható public.orders sort tényleg beszúr és
-- DELETE-el (bár csak a ROLLBACK-kel védett tranzakción belül, és soha nem
-- nyúl valódi, meglévő rendeléshez) - ezt a konkrét lépést NE futtasd
-- productionön, csak fejlesztői/staging adatbázison. A többi lépés (1-7)
-- kizárólag a reminder_sends táblát és a két RPC-t érinti, azok bárhol
-- biztonságosan futtathatók.

BEGIN;

DO $$
DECLARE
  v_order_id bigint;
  v_pickup_day_id bigint;
  v_other_order_id bigint;
  v_other_pickup_day_id bigint;
  v_claim record;
  v_count integer;
  v_test_order_id bigint;
  v_test_reminder_id bigint;
  v_test_user_id uuid;
  v_test_season_id bigint;
BEGIN
  SELECT id, pickup_day_id INTO v_order_id, v_pickup_day_id
  FROM public.orders ORDER BY id LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Nincs egyetlen rendelés sem a public.orders táblában - a teszthez legalább egy valós rendelés szükséges.';
  END IF;

  RAISE NOTICE '--- Teszt rendelés: order_id=%, pickup_day_id=%', v_order_id, v_pickup_day_id;

  -- 1) Új reminder rekord létrejön (első claim), attempted_at visszajön.
  SELECT * INTO v_claim FROM public.claim_reminder_send(v_order_id, v_pickup_day_id);
  ASSERT v_claim.claimed = true, '1. Az első claimnek sikeresnek kell lennie';
  ASSERT v_claim.status = 'sending', '1. Az első claim után az állapotnak "sending"-nek kell lennie';
  ASSERT v_claim.attempted_at IS NOT NULL, '1. attempted_at-nek ki kell töltődnie claim után';
  ASSERT v_claim.attempted_at > now() - interval '1 minute', '1. attempted_at-nek friss (az imént beállított) időpontnak kell lennie';
  RAISE NOTICE '1. OK - létrejött reminder id=%, status=%, attempted_at=%', v_claim.id, v_claim.status, v_claim.attempted_at;

  SELECT count(*) INTO v_count FROM public.reminder_sends
    WHERE order_id = v_order_id AND pickup_day_id = v_pickup_day_id AND reminder_type = 'pickup_reminder';
  ASSERT v_count = 1, '1b. Pontosan egy reminder_sends sornak kell léteznie eddig';

  -- 2) Ugyanarra az order+pickup+reminder_type kombinációra nem lesz
  -- duplikáció: egy "másik worker" is megpróbálja - mivel már "sending",
  -- ennek skip-elnie kell (claimed=false), és NEM hozhat létre új sort.
  SELECT * INTO v_claim FROM public.claim_reminder_send(v_order_id, v_pickup_day_id);
  ASSERT v_claim.claimed = false, '2. Egy már "sending" sor nem claim-elhető újra';
  ASSERT v_claim.status = 'sending', '2. A "sending" állapotnak skip esetén is meg kell maradnia';

  SELECT count(*) INTO v_count FROM public.reminder_sends
    WHERE order_id = v_order_id AND pickup_day_id = v_pickup_day_id AND reminder_type = 'pickup_reminder';
  ASSERT v_count = 1, '2b. Továbbra is pontosan egy sornak kell léteznie (nincs duplikáció)';
  RAISE NOTICE '2. OK - UNIQUE + "sending"-védelem miatt nincs duplikáció';

  -- 3) finalize -> sent
  PERFORM public.finalize_reminder_send(v_claim.id, 'sent', 'provider-msg-123', NULL);

  ASSERT (SELECT status FROM public.reminder_sends WHERE id = v_claim.id) = 'sent',
    '3. finalize("sent") után az állapotnak "sent"-nek kell lennie';
  ASSERT (SELECT sent_at FROM public.reminder_sends WHERE id = v_claim.id) IS NOT NULL,
    '3b. sent_at-nek ki kell töltődnie';
  ASSERT (SELECT provider_message_id FROM public.reminder_sends WHERE id = v_claim.id) = 'provider-msg-123',
    '3c. provider_message_id-nek el kell mentődnie';
  RAISE NOTICE '3. OK - finalize("sent") helyesen zárta le a rekordot';

  -- 4) sent újra nem claimelhető.
  SELECT * INTO v_claim FROM public.claim_reminder_send(v_order_id, v_pickup_day_id);
  ASSERT v_claim.claimed = false, '4. Egy "sent" sor soha nem claim-elhető újra';
  ASSERT v_claim.status = 'sent', '4b. A visszaadott állapotnak "sent"-nek kell lennie';
  RAISE NOTICE '4. OK - "sent" rekord nem claim-elhető újra';

  -- 5-7) failed -> retry -> sending: külön rendelésen, hogy az 1-4. lépés
  -- "sent" állapota ne zavarjon bele.
  SELECT id, pickup_day_id INTO v_other_order_id, v_other_pickup_day_id
  FROM public.orders WHERE id <> v_order_id ORDER BY id LIMIT 1;

  IF v_other_order_id IS NULL THEN
    RAISE NOTICE '5-7. KIHAGYVA: nincs második, különböző rendelés az adatbázisban - a failed/retry tesztekhez legalább két rendelés szükséges.';
  ELSE
    SELECT * INTO v_claim FROM public.claim_reminder_send(v_other_order_id, v_other_pickup_day_id);
    ASSERT v_claim.claimed = true, '5. Az első claimnek erre a másik rendelésre is sikeresnek kell lennie';

    PERFORM public.finalize_reminder_send(v_claim.id, 'failed', NULL, 'SMTP2GO 500 - teszt hiba');
    ASSERT (SELECT status FROM public.reminder_sends WHERE id = v_claim.id) = 'failed',
      '5b. finalize("failed") után az állapotnak "failed"-nek kell lennie';
    ASSERT (SELECT error_message FROM public.reminder_sends WHERE id = v_claim.id) = 'SMTP2GO 500 - teszt hiba',
      '5c. error_message-nek el kell mentődnie';
    RAISE NOTICE '5. OK - finalize("failed") helyesen zárta le a rekordot';

    -- 6) failed újra claimelhető (retry engedett), UGYANAZT a sort kezeli.
    SELECT * INTO v_claim FROM public.claim_reminder_send(v_other_order_id, v_other_pickup_day_id);
    ASSERT v_claim.claimed = true, '6. Egy "failed" sornak retry-olhatónak kell lennie';
    ASSERT v_claim.status = 'sending', '6b. Sikeres retry-claim után az állapotnak "sending"-nek kell lennie';

    SELECT count(*) INTO v_count FROM public.reminder_sends
      WHERE order_id = v_other_order_id AND pickup_day_id = v_other_pickup_day_id AND reminder_type = 'pickup_reminder';
    ASSERT v_count = 1, '6c. A retry NEM hozhat létre új sort, továbbra is pontosan egynek kell lennie';
    RAISE NOTICE '6. OK - failed retry-olható, ugyanazt a sort használja';

    -- 7) sending nem claimelhető újra (amíg nincs finalize-olva).
    SELECT * INTO v_claim FROM public.claim_reminder_send(v_other_order_id, v_other_pickup_day_id);
    ASSERT v_claim.claimed = false, '7. Egy "sending" sor nem claim-elhető újra finalize nélkül';
    ASSERT v_claim.status = 'sending', '7b. Az állapotnak "sending"-nek kell maradnia';
    RAISE NOTICE '7. OK - "sending" állapot nem claim-elhető újra';
  END IF;

  -- 8) ON DELETE CASCADE: egy kifejezetten ehhez a teszthez létrehozott,
  -- eldobható rendelésen (SOHA nem egy valódi, meglévő rendelésen)
  -- igazoljuk, hogy a szülő order törlésekor a hozzá tartozó
  -- reminder_sends sor automatikusan, kézi takarítás nélkül eltűnik - lásd
  -- a fájl elején a FIGYELEM jegyzetet erről a lépésről.
  SELECT user_id, season_parameter_id INTO v_test_user_id, v_test_season_id
  FROM public.orders WHERE id = v_order_id;

  INSERT INTO public.orders (user_id, season_parameter_id, pickup_day_id, public_order_number)
  VALUES (v_test_user_id, v_test_season_id, v_pickup_day_id, public.generate_order_number())
  RETURNING id INTO v_test_order_id;

  SELECT * INTO v_claim FROM public.claim_reminder_send(v_test_order_id, v_pickup_day_id);
  v_test_reminder_id := v_claim.id;
  ASSERT v_claim.claimed = true, '8. Az eldobható teszt-rendeléshez is sikeresen kell claim-elni';
  ASSERT EXISTS (SELECT 1 FROM public.reminder_sends WHERE id = v_test_reminder_id),
    '8b. A reminder_sends sornak léteznie kell az order törlése előtt';

  DELETE FROM public.orders WHERE id = v_test_order_id;

  ASSERT NOT EXISTS (SELECT 1 FROM public.reminder_sends WHERE id = v_test_reminder_id),
    '8c. ON DELETE CASCADE miatt a reminder_sends sornak automatikusan törlődnie kellett az order törlésekor';
  RAISE NOTICE '8. OK - ON DELETE CASCADE helyesen törölte a reminder_sends sort az (eldobható teszt-) order törlésekor';

  RAISE NOTICE '--- Minden ASSERT sikeresen lefutott. A tranzakció a szkript végén ROLLBACK-elve lesz, semmi nem marad az adatbázisban.';
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------
-- Rollback-sorrend ellenőrzése - EZT NE production adatbázison futtasd,
-- mert ténylegesen alkalmazza/visszavonja a séma-objektumokat (nincs
-- ROLLBACK-be csomagolva, hiszen a cél maga a DROP/CREATE ellenőrzése).
-- Csak egy eldobható teszt-projektben/ágban futtasd, miután mindkét
-- migrációt alkalmaztad.
-- ---------------------------------------------------------------------

-- A) claim_reminder_send jelenlegi visszatérési oszlopai (4 oszlopnak kell
-- lennie: id, claimed, status, attempted_at, a 20260930010000 migráció
-- után):
-- select p.proname, pg_get_function_result(p.oid) as return_type
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'claim_reminder_send';

-- B) Rollback #2 (csak a claim_reminder_send attempted_at-kiterjesztését
-- vonja vissza, a táblát és a finalize_reminder_send-et nem érinti):
-- \i supabase/rollback/20260930_before_reminder_sends_claim_attempted_at.sql
--
-- Ellenőrzés: a fenti A) lekérdezés most már csak 3 oszlopot mutasson
-- (id, claimed, status - attempted_at nélkül).

-- C) Rollback #1 (mindent eltávolít: mindkét függvényt és a táblát is -
-- a claim_reminder_send DROP FUNCTION szignatúrája (bigint, bigint, text)
-- csak a paramétertípusok alapján azonosít, a visszatérési típustól
-- függetlenül, ezért ez ÖNMAGÁBAN is helyesen működik akkor is, ha a B)
-- lépést kihagytad - de a dokumentált, javasolt sorrend a migrációk
-- fordítottja: előbb #2, utána #1):
-- \i supabase/rollback/20260930_before_reminder_sends.sql
--
-- Ellenőrzés: az alábbi lekérdezésnek most már 0 sort kell adnia mindhárom
-- objektumra:
-- select 'table' as kind, tablename as name from pg_tables where schemaname = 'public' and tablename = 'reminder_sends'
-- union all
-- select 'function', proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname in ('claim_reminder_send', 'finalize_reminder_send');
