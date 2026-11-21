CREATE OR REPLACE FUNCTION public.enforce_pickup_day_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_day_active boolean;
begin
  select is_active into v_day_active from public.pickup_days where id = new.pickup_day_id;
  if v_day_active is false and not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'A kiválasztott átvételi nap jelenleg nem elérhető.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION enforce_pickup_day_active() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO PUBLIC;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO anon;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO authenticated;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO service_role;
