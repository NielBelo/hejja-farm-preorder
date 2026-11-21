CREATE OR REPLACE FUNCTION public.admin_set_pickup_day_active(target_id bigint, is_active boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_season_active boolean;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if admin_set_pickup_day_active.is_active then
    select sp.is_active into v_season_active
    from public.pickup_days pd
    join public.season_parameters sp on sp.id = pd.season_parameter_id
    where pd.id = target_id;
    if not found then
      raise exception 'Az átvételi nap nem található.' using errcode = 'P0002';
    end if;
    if v_season_active is not true then
      raise exception 'Átvételi nap csak aktív szezonban aktiválható.' using errcode = '22023';
    end if;
  end if;
  update public.pickup_days set is_active = admin_set_pickup_day_active.is_active where id = target_id;
  if not found then
    raise exception 'Az átvételi nap nem található.' using errcode = 'P0002';
  end if;
  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_set_pickup_day_active(bigint,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_set_pickup_day_active(bigint,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_pickup_day_active(bigint,boolean) TO service_role;
