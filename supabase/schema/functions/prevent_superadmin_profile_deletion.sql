CREATE OR REPLACE FUNCTION public.prevent_superadmin_profile_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (
    select 1 from public.user_roles
    where user_id = old.id and is_superadmin = true
  ) then
    raise exception 'A superadmin profilja nem törölhető.' using errcode = '42501';
  end if;

  return old;
end;
$function$;

REVOKE ALL ON FUNCTION prevent_superadmin_profile_deletion() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prevent_superadmin_profile_deletion() TO service_role;
