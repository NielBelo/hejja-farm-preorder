CREATE OR REPLACE FUNCTION public.validate_registration_invite(invite_token text)
 RETURNS TABLE(status text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    case when i.used_at is null then 'valid' else 'used' end,
    case when i.used_at is null then i.email else null end
  from public.registration_invites i
  where i.token_hash = extensions.digest(invite_token, 'sha256')
  union all
  select 'invalid', null
  where not exists (
    select 1 from public.registration_invites i
    where i.token_hash = extensions.digest(invite_token, 'sha256')
  )
  limit 1;
$function$;

REVOKE ALL ON FUNCTION validate_registration_invite(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION validate_registration_invite(text) TO anon;
GRANT EXECUTE ON FUNCTION validate_registration_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION validate_registration_invite(text) TO service_role;
