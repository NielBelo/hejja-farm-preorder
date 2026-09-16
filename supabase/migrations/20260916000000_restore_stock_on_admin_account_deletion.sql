-- delete_admin_account eddig nem adta vissza a törölt felhasználó aktív
-- (le nem mondott) rendeléseinek lefoglalt készletét a pickup_days
-- táblában, ellentétben a cancel_order függvénnyel (sql/cancel_order.sql),
-- amely mindig visszaadja a lemondott rendelés mennyiségét. Emiatt egy
-- aktív rendeléssel rendelkező fiók törlése tartósan csökkentette az
-- elérhető készletet a valós állapothoz képest.

create or replace function public.delete_admin_account(target_user_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target_email text;
begin
  if caller is null or not exists (select 1 from public.user_roles where user_id = caller and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if target_user_id is null or target_user_id = caller then
    raise exception 'A saját fiók nem törölhető.' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_roles where user_id = target_user_id and is_superadmin) then
    raise exception 'A superadmin fiókja nem törölhető.' using errcode = '42501';
  end if;
  select email into target_email from auth.users where id = target_user_id for update;
  if not found then raise exception 'A felhasználó nem található.' using errcode = 'P0002'; end if;

  -- Az aktív (le nem mondott) rendelések lefoglalt mennyiségét visszaadjuk
  -- az érintett átvételi napok elérhető készletéhez, mielőtt a rendelések
  -- törlődnének.
  update public.pickup_days pd
  set available_stock = pd.available_stock + restored.total_quantity
  from (
    select o.pickup_day_id, coalesce(sum(oi.quantity), 0) as total_quantity
    from public.orders o
    join public.order_items oi on oi.order_version_id = o.current_version_id
    where o.user_id = target_user_id and o.status = 'submitted'
    group by o.pickup_day_id
  ) as restored
  where pd.id = restored.pickup_day_id;

  delete from public.user_consents where user_id = target_user_id;
  delete from public.registration_invites where used_by_user_id = target_user_id or lower(email) = lower(target_email);
  update public.orders set current_version_id = null where user_id = target_user_id;
  delete from public.order_items oi using public.order_versions ov, public.orders o where oi.order_version_id = ov.id and ov.order_id = o.id and o.user_id = target_user_id;
  delete from public.order_versions ov using public.orders o where ov.order_id = o.id and o.user_id = target_user_id;
  delete from public.orders where user_id = target_user_id;
  delete from public.user_roles where user_id = target_user_id;
  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
  return true;
end;
$$;

revoke all on function public.delete_admin_account(uuid) from public, anon;
grant execute on function public.delete_admin_account(uuid) to authenticated;
notify pgrst, 'reload schema';
