CREATE OR REPLACE FUNCTION public.anonymize_and_delete_user(target_user_id uuid, source text)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  target_email text;
  target_name text;
begin
  if source not in ('admin', 'self') then
    raise exception 'Érvénytelen törlési forrás.' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_roles where user_id = target_user_id and is_superadmin) then
    raise exception 'A superadmin fiókja nem törölhető.' using errcode = '42501';
  end if;

  select email into target_email from auth.users where id = target_user_id for update;
  if not found then raise exception 'A felhasználó nem található.' using errcode = 'P0002'; end if;

  -- Aktív, még le nem zajlott (mai vagy jövőbeli) átvételi napú rendelés
  -- mellett nem törlünk: előbb le kell mondani. Ugyanaz a határ, mint a
  -- cancel_order-ben.
  if exists (
    select 1
    from public.orders o
    join public.pickup_days pd on pd.id = o.pickup_day_id
    where o.user_id = target_user_id
      and o.status = 'submitted'
      and o.archived_at is null
      and pd.pickup_date >= (clock_timestamp() at time zone 'Europe/Budapest')::date
  ) then
    raise exception 'A fiók nem törölhető, amíg aktív, még le nem zajlott átvételi napra szóló rendelés tartozik hozzá. Előbb mondja le a rendeléseket.' using errcode = 'P0001';
  end if;

  select nullif(trim(concat_ws(' ', last_name, first_name)), '') into target_name
  from public.profiles where id = target_user_id;

  insert into public.deleted_users (full_name, deletion_source)
  values (coalesce(target_name, 'Ismeretlen név'), source);

  -- Rendelések anonimizálása: a jegyzet szabad szöveg, személyes adatot
  -- tartalmazhat, ezért kiürítjük. A user_id az FK SET NULL-ja miatt a
  -- felhasználó törlésekor nullázódik.
  update public.order_items oi set note = null
  from public.order_versions ov, public.orders o
  where oi.order_version_id = ov.id and ov.order_id = o.id and o.user_id = target_user_id;

  delete from public.user_consents where user_id = target_user_id;
  delete from public.registration_invites where used_by_user_id = target_user_id or lower(email) = lower(target_email);
  delete from public.season_launch_sends where user_id = target_user_id;
  delete from public.user_roles where user_id = target_user_id;
  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
  return true;
end;
$function$;

REVOKE ALL ON FUNCTION anonymize_and_delete_user(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
