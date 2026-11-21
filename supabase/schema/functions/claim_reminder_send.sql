CREATE OR REPLACE FUNCTION public.claim_reminder_send(p_order_id bigint, p_pickup_day_id bigint, p_reminder_type text DEFAULT 'pickup_reminder'::text)
 RETURNS TABLE(id bigint, claimed boolean, status text, attempted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION claim_reminder_send(bigint,bigint,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION claim_reminder_send(bigint,bigint,text) TO service_role;
