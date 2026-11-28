CREATE OR REPLACE FUNCTION public.claim_season_launch_send(p_season_parameter_id bigint, p_user_id uuid, p_email text)
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
$function$;

REVOKE ALL ON FUNCTION claim_season_launch_send(bigint,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION claim_season_launch_send(bigint,uuid,text) TO service_role;
