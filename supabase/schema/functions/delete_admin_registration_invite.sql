CREATE OR REPLACE FUNCTION public.delete_admin_registration_invite(target_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if exists (select 1 from auth.users where lower(email) = lower(trim(target_email))) then
    raise exception 'A regisztrált felhasználót a fiók törlésével kell eltávolítani.' using errcode = '22023';
  end if;
  delete from public.registration_invites
  where lower(email) = lower(trim(target_email)) and used_at is null;
  return found;
end;
$function$;

REVOKE ALL ON FUNCTION delete_admin_registration_invite(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_admin_registration_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_admin_registration_invite(text) TO service_role;
