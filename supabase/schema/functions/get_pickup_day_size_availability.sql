CREATE OR REPLACE FUNCTION public.get_pickup_day_size_availability()
 RETURNS TABLE(pickup_day_id bigint, small_remaining integer, large_remaining integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Naponként a még rendelhető kisebb/nagyobb méretű csirkék darabszáma
  -- (NULL = nincs korlát). Az összes élő (submitted) rendelést számolja, a
  -- hívó saját rendelését is: szerkesztéskor a felület hozzáadja vissza.
  select
    pd.id,
    case when pd.small_size_limit is null then null
         else greatest(pd.small_size_limit - s.live_small_quantity, 0) end,
    case when pd.large_size_limit is null then null
         else greatest(pd.large_size_limit - s.live_large_quantity, 0) end
  from public.pickup_days pd
  join public.pickup_day_order_stats s on s.pickup_day_id = pd.id
  where pd.kind = 'normal'
    and pd.archived_at is null
    and (pd.small_size_limit is not null or pd.large_size_limit is not null)
$function$;

REVOKE ALL ON FUNCTION get_pickup_day_size_availability() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_pickup_day_size_availability() TO authenticated;
GRANT EXECUTE ON FUNCTION get_pickup_day_size_availability() TO service_role;
