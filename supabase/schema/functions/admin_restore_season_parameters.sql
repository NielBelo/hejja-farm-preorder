CREATE OR REPLACE FUNCTION public.admin_restore_season_parameters(target_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_archived_at timestamptz;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  select archived_at into v_archived_at
    from public.season_parameters
    where id = target_id
    for update;

  if not found then
    raise exception 'A szezon nem található.' using errcode = 'P0002';
  end if;
  if v_archived_at is null then
    raise exception 'A szezon nincs törölve.' using errcode = '22023';
  end if;

  -- Csak a szezonnal EGYÜTT (ugyanazzal az időbélyeggel) törölt napok jönnek
  -- vissza; a korábban külön törölt napok archiváltak maradnak. Minden
  -- inaktívan áll vissza, az admin kapcsolja be tudatosan.
  update public.pickup_days
    set archived_at = null, is_active = false
    where season_parameter_id = target_id and archived_at = v_archived_at;

  update public.season_parameters
    set archived_at = null, is_active = false
    where id = target_id;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_restore_season_parameters(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_restore_season_parameters(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_restore_season_parameters(bigint) TO service_role;
