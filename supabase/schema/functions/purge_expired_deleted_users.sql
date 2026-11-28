CREATE OR REPLACE FUNCTION public.purge_expired_deleted_users()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  removed integer;
begin
  delete from public.deleted_users where deleted_at < now() - interval '3 years';
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

REVOKE ALL ON FUNCTION purge_expired_deleted_users() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION purge_expired_deleted_users() TO service_role;
