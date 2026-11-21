CREATE OR REPLACE FUNCTION public.enforce_pickup_day_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_day_active boolean;
  v_day_archived boolean;
begin
  select is_active, (archived_at is not null) into v_day_active, v_day_archived
    from public.pickup_days where id = new.pickup_day_id;
  if not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    if v_day_archived is true then
      raise exception 'A kiválasztott átvételi nap törölve lett, ezért erre a napra nem adható le és nem módosítható rendelés.' using errcode = '22023';
    end if;
    if v_day_active is false then
      raise exception 'A kiválasztott átvételi nap jelenleg nem elérhető.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION enforce_pickup_day_active() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO PUBLIC;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO anon;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO authenticated;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO service_role;
