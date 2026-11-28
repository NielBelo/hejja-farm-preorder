CREATE OR REPLACE FUNCTION public.delete_admin_account(target_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not exists (select 1 from public.user_roles where user_id = caller and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if target_user_id is null or target_user_id = caller then
    raise exception 'A saját fiók nem törölhető.' using errcode = '22023';
  end if;
  return public.anonymize_and_delete_user(target_user_id, 'admin');
end;
$function$;

REVOKE ALL ON FUNCTION delete_admin_account(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_admin_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_admin_account(uuid) TO service_role;
