CREATE OR REPLACE FUNCTION public.get_size_preference_locks()
 RETURNS TABLE(pickup_day_id bigint, preference text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select o.pickup_day_id, 'smaller'::text as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  join public.pickup_days pd on pd.id = o.pickup_day_id
  where o.status = 'submitted'
    and p.special_size_preference = 'smaller'
    and o.user_id is distinct from auth.uid()
    and pd.kind = 'normal'
  group by o.pickup_day_id
  having count(distinct o.user_id) >= 2
  union
  select o.pickup_day_id, 'larger'::text as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  join public.pickup_days pd on pd.id = o.pickup_day_id
  where o.status = 'submitted'
    and p.special_size_preference = 'larger'
    and o.user_id is distinct from auth.uid()
    and pd.kind = 'normal'
  group by o.pickup_day_id
  having count(distinct o.user_id) >= 1
  union
  select pd.id, 'larger'::text
  from public.pickup_days pd
  where pd.kind = 'normal'
    and pd.pickup_date in (
      select min(pickup_date) from public.pickup_days
      where season_parameter_id = pd.season_parameter_id and kind = 'normal'
      union
      select max(pickup_date) from public.pickup_days
      where season_parameter_id = pd.season_parameter_id and kind = 'normal'
    )
$function$;

REVOKE ALL ON FUNCTION get_size_preference_locks() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_size_preference_locks() TO authenticated;
GRANT EXECUTE ON FUNCTION get_size_preference_locks() TO service_role;
