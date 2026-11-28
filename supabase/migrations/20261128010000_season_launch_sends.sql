-- Szezonindítási értesítő e-mailek küldési naplója és idempotencia-védelme.
--
-- Cél: ugyanaz a vásárló ugyanarra a szezonra legfeljebb egyszer kaphasson
-- sikeresen kiküldött szezonindítási értesítőt, még akkor sem, ha a napi
-- ütemezett feladat kétszer fut, vagy két worker párhuzamosan dolgozik.
--
-- A minta megegyezik a reminder_sends-ével (lásd
-- 20260930000000_reminder_sends.sql): két lépés, mert az SMTP2GO HTTP-hívás
-- a Worker oldalon történik, nem tartható nyitva tranzakció a hívás idejére.
--   1. public.claim_season_launch_send: atomikusan létrehozza (ha még nem
--      létezik) és "sending" állapotba zárja a szezon+vásárló sort - csak
--      akkor, ha az még sosem volt "sent" és épp nem "sending".
--   2. public.finalize_season_launch_send: a küldés UTÁN zárja le "sent" vagy
--      "failed" állapotra, csak "sending" sorra.
--
-- Ez a migráció KIZÁRÓLAG új objektumokat hoz létre (1 tábla, 2 függvény),
-- meglévő éles objektumot nem módosít. Visszavonás:
-- supabase/rollback/20261128_before_season_launch_sends.sql
BEGIN;

create table if not exists public.season_launch_sends (
  id bigint generated always as identity primary key,
  -- ON DELETE CASCADE: a naplósor a szezonhoz/fiókhoz tartozó adat, azok
  -- nélkül értelmetlen; így a szezon- vagy fióktörlés sem akad el rajta.
  season_parameter_id bigint not null references public.season_parameters (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- A küldéskori címzett (diagnosztika; a fiók e-mail-címe később változhat).
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempted_at timestamptz,
  sent_at timestamptz,
  error_message text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint season_launch_sends_sent_has_sent_at check (
    (status = 'sent' and sent_at is not null) or (status <> 'sent')
  ),
  -- DB-szintű idempotencia-védelem: egy szezon + egy vásárló = egy sor.
  unique (season_parameter_id, user_id)
);

create index if not exists season_launch_sends_status_idx on public.season_launch_sends (status);

alter table public.season_launch_sends enable row level security;

-- Közvetlenül nem érhető el anon/authenticated szerepkörrel; kizárólag a
-- lenti security definer RPC-ken (és service_role-lal) keresztül.
revoke all on public.season_launch_sends from public, anon, authenticated;
grant all on public.season_launch_sends to service_role;

create or replace function public.claim_season_launch_send(
  p_season_parameter_id bigint,
  p_user_id uuid,
  p_email text
)
returns table (id bigint, claimed boolean, status text, attempted_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_status text;
  v_attempted_at timestamptz;
begin
  insert into public.season_launch_sends (season_parameter_id, user_id, email, status)
  values (p_season_parameter_id, p_user_id, p_email, 'pending')
  on conflict (season_parameter_id, user_id) do nothing;

  -- Atomikus lefoglalás: csak "pending"/"failed" sor foglalható. Egy már
  -- "sending" sort SOHA nem foglalunk le újra (a stale/friss döntés a hívó
  -- dolga, automatikus újraküldés nélkül) - ugyanúgy, mint a reminderénél.
  -- Minden hivatkozás "r."-rel minősített a RETURNS TABLE OUT-paraméterek
  -- (id, status, attempted_at) névütközése miatt.
  update public.season_launch_sends r
  set status = 'sending', email = p_email, attempted_at = now(), updated_at = now()
  where r.season_parameter_id = p_season_parameter_id
    and r.user_id = p_user_id
    and r.status in ('pending', 'failed')
  returning r.id, r.attempted_at into v_id, v_attempted_at;

  if v_id is not null then
    return query select v_id, true, 'sending'::text, v_attempted_at;
    return;
  end if;

  select r.id, r.status, r.attempted_at into v_id, v_status, v_attempted_at
  from public.season_launch_sends r
  where r.season_parameter_id = p_season_parameter_id
    and r.user_id = p_user_id;

  return query select v_id, false, v_status, v_attempted_at;
end;
$$;

revoke all on function public.claim_season_launch_send(bigint, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_season_launch_send(bigint, uuid, text) to service_role;

create or replace function public.finalize_season_launch_send(
  p_id bigint,
  p_status text,
  p_provider_message_id text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'finalize_season_launch_send: érvénytelen státusz: %', p_status;
  end if;

  -- Csak a jelenleg "sending" sort zárja le: elkésett/duplikált hívás ne
  -- írhasson felül már véglegesített sort.
  update public.season_launch_sends
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

revoke all on function public.finalize_season_launch_send(bigint, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.finalize_season_launch_send(bigint, text, text, text) to service_role;

COMMIT;
