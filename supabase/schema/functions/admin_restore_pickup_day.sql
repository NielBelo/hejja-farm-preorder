CREATE OR REPLACE FUNCTION public.admin_restore_pickup_day(target_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind text;
  v_season_id bigint;
  v_archived_at timestamptz;
  v_season_archived_at timestamptz;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  select kind, season_parameter_id, archived_at
    into v_kind, v_season_id, v_archived_at
    from public.pickup_days
    where id = target_id
    for update;

  if not found then
    raise exception 'Az átvételi nap nem található.' using errcode = 'P0002';
  end if;
  if v_archived_at is null then
    raise exception 'Az átvételi nap nincs törölve.' using errcode = '22023';
  end if;
  if v_kind <> 'normal' then
    raise exception 'A DUNAVECSE nap csak a szezonnal együtt állítható vissza.' using errcode = '22023';
  end if;

  select archived_at into v_season_archived_at from public.season_parameters where id = v_season_id;
  if v_season_archived_at is not null then
    raise exception 'A nap szezonja törölve van, előbb a szezont állítsa vissza.' using errcode = '22023';
  end if;

  if (select count(*) from public.pickup_days
        where season_parameter_id = v_season_id and kind = 'normal' and archived_at is null) >= 5 then
    raise exception 'Egy szezonban legfeljebb 5 átvételi nap lehet; előbb töröljön egy másikat.' using errcode = '22023';
  end if;

  -- A nap törlésekor törölt rendelések automatikusan visszakerülnek.
  update public.orders
    set archived_at = null
    where pickup_day_id = target_id and archived_at = v_archived_at;

  -- Visszaállítás után a nap inaktív, az admin kapcsolja be tudatosan.
  update public.pickup_days set archived_at = null, is_active = false where id = target_id;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_restore_pickup_day(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_restore_pickup_day(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_restore_pickup_day(bigint) TO service_role;
