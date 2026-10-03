-- Production-biztonságos kézi tesztterv a reminder_sends táblához és a
-- claim_reminder_send / finalize_reminder_send RPC-khez.
--
-- Ez a fájl a sql/reminder_sends_manual_test.sql SZŰKÍTETT változata:
-- KIZÁRÓLAG az 1-7. lépéseket tartalmazza, amelyek sem new/meglévő orders
-- sort nem hoznak létre/módosítanak/törölnek, kizárólag a reminder_sends
-- táblát és a két RPC-t érintik (meglévő order_id/pickup_day_id-kra
-- hivatkoznak FK-ként, de a magát az orders sort SOHA nem írják). A teljes
-- fájl 8. lépése (ON DELETE CASCADE teszt, ami egy eldobható teszt-orders
-- sort ténylegesen beszúr és töröl) és a fájl végi, nem tranzakcióba
-- csomagolt rollback-sorrend-ellenőrző rész (ami valódi DROP/CREATE
-- FUNCTION-t futtat) ide SZÁNDÉKOSAN nincs bemásolva - azok csak
-- fejlesztői/staging adatbázison futtathatók, lásd a másik fájlt.
--
-- Futtatás: Supabase SQL Editor, KIZÁRÓLAG a
-- supabase/migrations/20260930000000_reminder_sends.sql és
-- supabase/migrations/20260930010000_reminder_sends_claim_attempted_at.sql
-- migrációk alkalmazása UTÁN.
--
-- Ez a szkript BEGIN/ROLLBACK-be van csomagolva: sikeres vagy sikertelen
-- lefutás esetén is VISSZAGÖRDÜL - a végén a teszt által létrehozott
-- reminder_sends sorok nem maradnak az adatbázisban, és semmilyen valódi
-- e-mail-küldés nem történik (ez a szkript magában SOHA nem hív SMTP2GO-t,
-- csak a DB-szintű claim/finalize állapotgépet teszteli).
--
-- FONTOS FENNTARTÁS a ROLLBACK-ről: PostgreSQL-ben a "generated always as
-- identity" oszlopok mögötti sequence NEM tranzakcionális objektum - egy
-- ROLLBACK nem állítja vissza a sequence által már kiadott értékeket. Az 1.
-- lépés sikeres claim_reminder_send hívása tehát felhasznál egy
-- reminder_sends.id sorszámot, amely a ROLLBACK után is "elveszik" (a
-- legközelebbi valódi beszúrás nagyobb id-vel folytatódik majd). Ez
-- ártalmatlan - nem jár adatvesztéssel vagy integritási problémával, és nem
-- hagy semmilyen SORT az adatbázisban -, de pontatlan lenne azt állítani,
-- hogy "semmilyen nyom nem marad": a sequence-számláló ugrása megmarad.
--
-- Előfeltétel: legalább EGY valós sor létezzen a public.orders táblában
-- (kettő esetén az 5-7. failed/retry forgatókönyv is lefut, egyébként azok
-- a lépések kihagyásra kerülnek, lásd lent).
--
-- Ha bármelyik ASSERT hamis, a DO blokk hibával leáll, és a hibaüzenet
-- pontosan megmondja, melyik lépés bukott el.

BEGIN;

DO $$
DECLARE
  v_order_id bigint;
  v_pickup_day_id bigint;
  v_other_order_id bigint;
  v_other_pickup_day_id bigint;
  v_claim record;
  v_count integer;
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

  RAISE NOTICE '--- Minden ASSERT sikeresen lefutott. A tranzakció a szkript végén ROLLBACK-elve lesz: a teszt által létrehozott reminder_sends sorok nem maradnak az adatbázisban, és semmilyen meglévő orders sor nem módosult. (A reminder_sends identity-sequence-e ettől függetlenül, nem-tranzakcionálisan tovahaladhatott - lásd a fájl eleji FONTOS FENNTARTÁS jegyzetet -, ez ártalmatlan.)';
END $$;

ROLLBACK;
