CREATE OR REPLACE FUNCTION public.login_email_exists(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(p_email))
  );
$function$;

REVOKE ALL ON FUNCTION login_email_exists(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION login_email_exists(text) TO anon;
GRANT EXECUTE ON FUNCTION login_email_exists(text) TO authenticated;
GRANT EXECUTE ON FUNCTION login_email_exists(text) TO service_role;
