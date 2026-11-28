CREATE OR REPLACE FUNCTION public.delete_own_account()
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'A fiók törléséhez jelentkezzen be.' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_roles where user_id = caller and role = 'admin') then
    raise exception 'Adminisztrátori fiók nem törölhető saját kezűleg.' using errcode = '42501';
  end if;
  return public.anonymize_and_delete_user(caller, 'self');
end;
$function$;

REVOKE ALL ON FUNCTION delete_own_account() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_own_account() TO authenticated;
GRANT EXECUTE ON FUNCTION delete_own_account() TO service_role;
