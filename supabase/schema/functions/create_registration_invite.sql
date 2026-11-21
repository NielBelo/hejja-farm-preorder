CREATE OR REPLACE FUNCTION public.create_registration_invite(invitee_email text)
 RETURNS TABLE(invite_id uuid, invite_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  generated_token text;
begin
  generated_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  return query
  with inserted as (
    insert into public.registration_invites (email, token_hash)
    values (lower(trim(invitee_email)), extensions.digest(generated_token, 'sha256'))
    returning id
  )
  select inserted.id, generated_token from inserted;
end;
$function$;

REVOKE ALL ON FUNCTION create_registration_invite(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_registration_invite(text) TO service_role;
