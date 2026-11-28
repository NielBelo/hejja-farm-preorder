CREATE OR REPLACE FUNCTION public.finalize_season_launch_send(p_id bigint, p_status text, p_provider_message_id text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION finalize_season_launch_send(bigint,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION finalize_season_launch_send(bigint,text,text,text) TO service_role;
