-- Rollback a 20260930010000_reminder_sends_claim_attempted_at.sql
-- migrációhoz: visszaállítja public.claim_reminder_send eredeti (3 oszlopos
-- RETURNS TABLE-ű, attempted_at nélküli) definícióját, szóról szóra a
-- 20260930000000_reminder_sends.sql-ben szereplő (jelenlegi, üres
-- search_path-os) verzió szerint.
--
-- A RETURNS TABLE oszloplistája változik vissza, ezért itt is DROP
-- FUNCTION szükséges a CREATE FUNCTION előtt.
--
-- Explicit tranzakcióban fut, hogy hiba esetén ne maradjon félkész állapot.
BEGIN;

drop function if exists public.claim_reminder_send(bigint, bigint, text);

create function public.claim_reminder_send(
  p_order_id bigint,
  p_pickup_day_id bigint,
  p_reminder_type text default 'pickup_reminder'
)
returns table (id bigint, claimed boolean, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_status text;
begin
  insert into public.reminder_sends (order_id, pickup_day_id, reminder_type, status)
  values (p_order_id, p_pickup_day_id, p_reminder_type, 'pending')
  on conflict (order_id, pickup_day_id, reminder_type) do nothing;

  -- "r" alias + MINDEN WHERE/RETURNING hivatkozás "r."-vel minősítve -
  -- lásd 20260930000000_reminder_sends.sql jegyzetét: bare "id"/"status" a
  -- "returns table (id bigint, claimed boolean, status text)"
  -- OUT-változóival ütközne, és plpgsql.variable_conflict default =
  -- 'error' mellett futásidejű "column reference ... is ambiguous" hibát
  -- dobna (ezt a "status"-nál egy valódi Postgres-en futtatott kézi teszt
  -- tárta fel).
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

  select r.id, r.status into v_id, v_status
  from public.reminder_sends r
  where r.order_id = p_order_id
    and r.pickup_day_id = p_pickup_day_id
    and r.reminder_type = p_reminder_type;

  return query select v_id, false, v_status;
end;
$$;

revoke all on function public.claim_reminder_send(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_reminder_send(bigint, bigint, text) to service_role;

COMMIT;
