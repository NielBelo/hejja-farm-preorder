-- Átvétel előtti emlékeztető e-mailek küldési naplója és idempotencia-védelme.
--
-- Cél: ugyanaz a rendelés ugyanarra az átvételi napra ugyanazt az
-- emlékeztetőt ne kaphassa meg többször sikeresen, még akkor sem, ha a napi
-- ütemezett feladat (worker/index.ts) valamiért kétszer fut le, vagy két
-- worker párhuzamosan próbálja feldolgozni ugyanazt a rendelést.
--
-- Az atomicitást és a konkurenciavédelmet KÉT lépésre bontva biztosítjuk,
-- mert a tényleges SMTP2GO HTTP-hívás a Node/Worker oldalon történik, nem
-- tartható nyitva Postgres-tranzakció/sorzár a teljes hívás idejére:
--   1. public.claim_reminder_send: EGY atomikus lépésben létrehozza (ha még
--      nem létezik) és "sending" állapotba zárja a rendelés+átvételi nap
--      párhoz tartozó sort - csak akkor, ha az még sosem volt "sent", és
--      jelenleg sincs "sending" állapotban (azaz épp nem dolgozza fel másik
--      worker). A UNIQUE kényszer + a sorszintű UPDATE zárolás miatt két
--      egyidejű hívás közül csak az egyik kaphat claimed=true-t.
--   2. public.finalize_reminder_send: a ténylegesen megtörtént SMTP2GO-hívás
--      UTÁN zárja le a sort "sent" vagy "failed" állapotra - csak akkor, ha
--      az jelenleg "sending" állapotban van (védekezés dupla/elkésett
--      lezárás ellen).
--
-- Explicit tranzakcióban fut (BEGIN/COMMIT): a fájl minden utasítása
-- (CREATE TABLE, ALTER TABLE, CREATE INDEX - nem CONCURRENTLY -, CREATE
-- FUNCTION, REVOKE/GRANT) tranzakcióbiztosan végrehajtható, így hiba esetén
-- a teljes migráció visszagördül, nem marad félkész állapot.
BEGIN;

create table if not exists public.reminder_sends (
  id bigint generated always as identity primary key,
  -- ON DELETE CASCADE: a reminder_sends sor a rendeléshez tartozó
  -- naplóadat, önmagában értelmetlen a rendelés nélkül. A meglévő
  -- public.delete_admin_account RPC (lásd
  -- supabase/migrations/20260916000000_restore_stock_on_admin_account_deletion.sql)
  -- guard nélkül, közvetlenül töröl a public.orders táblából - CASCADE
  -- nélkül ez FK-violation miatt elhasalna, mihelyt egy törlendő fiók
  -- bármelyik rendeléséhez valaha is készült reminder_sends sor. A
  -- delete_admin_account RPC-t emiatt NEM kell módosítani.
  order_id bigint not null references public.orders (id) on delete cascade,
  pickup_day_id bigint not null references public.pickup_days (id),
  -- Jelenleg egyetlen emlékeztető-típus létezik ("pickup_reminder"), de a
  -- UNIQUE kényszer explicit módon tartalmazza, hogy a jövőben egy másik
  -- emlékeztető-típus bevezetése ne igényeljen sémaváltoztatást.
  reminder_type text not null default 'pickup_reminder',
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempted_at timestamptz,
  sent_at timestamptz,
  error_message text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_sends_sent_has_sent_at check (
    (status = 'sent' and sent_at is not null) or (status <> 'sent')
  ),
  -- Ez a DB-szintű idempotencia-védelem: ugyanaz a rendelés + ugyanaz az
  -- átvételi nap + ugyanaz az emlékeztető-típus csak egyetlen sort kaphat.
  unique (order_id, pickup_day_id, reminder_type)
);

create index if not exists reminder_sends_status_idx on public.reminder_sends (status);

alter table public.reminder_sends enable row level security;

-- A tábla közvetlenül nem érhető el sem anon, sem authenticated szerepkörrel
-- - kizárólag az alábbi két, security definer RPC-n keresztül írható/
-- olvasható, ugyanúgy, mint a projekt többi admin/rendszer célú RPC-je
-- (lásd sql/registration_invites.sql).
revoke all on public.reminder_sends from anon, authenticated;

create or replace function public.claim_reminder_send(
  p_order_id bigint,
  p_pickup_day_id bigint,
  p_reminder_type text default 'pickup_reminder'
)
returns table (id bigint, claimed boolean, status text)
language plpgsql
security definer
-- Üres search_path: a függvénytörzsben minden tábla- és RPC-hivatkozás már
-- eleve "public." előtaggal teljesen kvalifikált (lásd lent), ezért ez nem
-- változtat a viselkedésen, viszont ez a Postgres által SECURITY DEFINER
-- függvényekhez ajánlott, legszigorúbb beállítás - így egy esetleges
-- jövőbeli, szándékosan nem-teljesen-kvalifikált hivatkozás elírása
-- fordítási/futási hibát adna, nem csendes, rossz objektumra futást.
set search_path = ''
as $$
declare
  v_id bigint;
  v_status text;
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
  -- a sor időközben "sending"-re váltott), így affected rows = 0 lesz neki.
  -- A céltábla "r" aliast kap, és MINDEN WHERE/RETURNING hivatkozás
  -- explicit "r."-vel minősített - ez nem séma-feloldási kérdés (azt a
  -- search_path = '' külön kezeli lent), hanem PL/pgSQL OUT-paraméter
  -- ütközés elleni védelem: a "returns table (id bigint, claimed boolean,
  -- status text)" miatt a függvénynek "id" ÉS "status" nevű, automatikusan
  -- létrehozott OUT-változója is van, ami a reminder_sends tábla azonos
  -- nevű oszlopaival ütközik. A Postgres default
  -- plpgsql.variable_conflict = 'error' beállítása mellett egy bare "id"
  -- vagy bare "status" hivatkozás futásidőben "column reference ... is
  -- ambiguous" hibát dob - ezt egy valódi Postgres-en futtatott kézi teszt
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
  returning r.id into v_id;

  if v_id is not null then
    return query select v_id, true, 'sending'::text;
    return;
  end if;

  -- Nem sikerült lefoglalni (már "sent", vagy épp "sending" egy másik
  -- workerben) - visszaadjuk a jelenlegi állapotot, a hívó ezt skip-ként
  -- kezeli, NEM küldési kísérletként.
  select r.id, r.status into v_id, v_status
  from public.reminder_sends r
  where r.order_id = p_order_id
    and r.pickup_day_id = p_pickup_day_id
    and r.reminder_type = p_reminder_type;

  return query select v_id, false, v_status;
end;
$$;

create or replace function public.finalize_reminder_send(
  p_id bigint,
  p_status text,
  p_provider_message_id text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
-- Üres search_path, ugyanazon okból, mint claim_reminder_send-nél fent:
-- minden hivatkozás már eleve "public."-tal kvalifikált.
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'finalize_reminder_send: érvénytelen státusz: %', p_status;
  end if;

  -- Csak a jelenleg "sending" állapotú sort zárja le - ez védekezés az
  -- ellen, hogy egy elkésett/duplikált lezáró hívás felülírjon egy már
  -- véglegesített ("sent"/"failed") sort.
  update public.reminder_sends
  set
    status = p_status,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    provider_message_id = case when p_status = 'sent' then p_provider_message_id else provider_message_id end,
    error_message = case when p_status = 'failed' then left(p_error_message, 500) else null end,
    updated_at = now()
  where id = p_id
    and status = 'sending';
end;
$$;

-- FONTOS: ez a két RPC - a projekt összes többi admin/rendszer célú
-- SECURITY DEFINER RPC-jétől eltérően - SOHA nem hívódik egy bejelentkezett
-- felhasználó (admin vagy vásárló) böngészőjéből, kizárólag a Cloudflare
-- scheduled workerből (lásd worker/index.ts), ahol nincs auth.uid()-del
-- azonosítható felhasználói kontextus. Emiatt se "anon", se "authenticated"
-- szerepkör nem kaphat EXECUTE jogot rájuk - kizárólag "service_role", amit
-- a worker egy külön, service role kulccsal létrehozott Supabase klienssel
-- hív (lásd worker/index.ts). Anon/authenticated grant esetén bárki, a
-- publikus anon kulccsal, a PostgREST rpc/ végponton keresztül közvetlenül
-- hívhatná ezeket - pl. tetszőleges (érvényes ID-jű) rendeléshez tartósan
-- "sending" állapotú reminder_sends sort foglalhatna le, ami örökre
-- blokkolná az adott rendelés valódi emlékeztetőjét (a staleness-logika ezt
-- sosem retry-olja automatikusan, lásd lib/email/reminderStaleness.ts), és
-- a finalize_reminder_send-et tetszőleges (kitalálható, kis egész)
-- id-re hívva bármely folyamatban lévő küldést idő előtt "sent"/"failed"-re
-- zárhatna anélkül, hogy az e-mail valóban elment volna.
revoke all on function public.claim_reminder_send(bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.finalize_reminder_send(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_reminder_send(bigint, bigint, text) to service_role;
grant execute on function public.finalize_reminder_send(bigint, text, text, text) to service_role;

COMMIT;
