CREATE OR REPLACE FUNCTION public.update_admin_oroshazi_delivery(target_user_id uuid, enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  update public.profiles
  set oroshazi_delivery = enabled
  where id = target_user_id;

  if not found then
    raise exception 'A felhasználó személyes adatlapja nem található.' using errcode = 'P0002';
  end if;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION update_admin_oroshazi_delivery(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_admin_oroshazi_delivery(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION update_admin_oroshazi_delivery(uuid,boolean) TO service_role;
