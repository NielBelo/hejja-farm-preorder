CREATE OR REPLACE FUNCTION public.admin_delete_season_parameters(target_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.season_parameters where id = target_id) then
    raise exception 'A szezon nem található.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.pickup_days p
    join public.orders o on o.pickup_day_id = p.id
    where p.season_parameter_id = target_id
  ) then
    raise exception 'A szezon nem törölhető, mert már vannak hozzá rendelések.' using errcode = '23503';
  end if;

  delete from public.pickup_days where season_parameter_id = target_id;
  delete from public.season_parameters where id = target_id;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_delete_season_parameters(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_delete_season_parameters(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_season_parameters(bigint) TO service_role;
