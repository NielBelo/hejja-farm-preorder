CREATE OR REPLACE FUNCTION public.admin_delete_season_parameters(target_id bigint, confirm_live_orders boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_live_orders integer;
  v_now timestamptz := now();
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.season_parameters where id = target_id) then
    raise exception 'A szezon nem található.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.season_parameters where id = target_id and archived_at is not null) then
    raise exception 'A szezon már törölve van.' using errcode = '22023';
  end if;

  -- A szezon napjainak zárolása az élő rendelések ellenőrzése előtt.
  perform 1 from public.pickup_days where season_parameter_id = target_id for update;

  select count(*) into v_live_orders
  from public.orders o
  join public.pickup_days p on p.id = o.pickup_day_id
  where p.season_parameter_id = target_id and o.status = 'submitted' and o.archived_at is null;

  if v_live_orders > 0 and not confirm_live_orders then
    raise exception 'A szezonhoz % élő rendelés tartozik. A szezon törlésekor a napjainak rendelései is törlődnek (a vásárlók értesítése nélkül, az előzményeikből eltűnnek), a szezon visszaállításakor visszakerülnek. A törléshez megerősítés szükséges.', v_live_orders
      using errcode = '22023', hint = 'LIVE_ORDERS_CONFIRMATION_REQUIRED';
  end if;

  -- Soft delete: a szezon és az összes napja (a DUNAVECSE is) ugyanazzal az
  -- időbélyeggel archiválódik, így a visszaállítás pontosan ezeket hozza
  -- vissza. A napok rendelései is törlődnek (soft delete, ugyanazzal az
  -- időbélyeggel, a vásárlók értesítése nélkül); a visszaállításkor visszakerülnek.
  update public.pickup_days
    set archived_at = v_now, is_active = false
    where season_parameter_id = target_id and archived_at is null;

  update public.orders o
    set archived_at = v_now
    from public.pickup_days p
    where o.pickup_day_id = p.id
      and p.season_parameter_id = target_id
      and p.archived_at = v_now
      and o.archived_at is null;

  update public.season_parameters
    set archived_at = v_now, is_active = false
    where id = target_id;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_delete_season_parameters(bigint,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_delete_season_parameters(bigint,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_season_parameters(bigint,boolean) TO service_role;
