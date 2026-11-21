CREATE OR REPLACE FUNCTION public.admin_create_registration_invite(invitee_email text)
 RETURNS TABLE(invite_id uuid, invite_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  return query select * from public.create_registration_invite(invitee_email);
end;
$function$;

REVOKE ALL ON FUNCTION admin_create_registration_invite(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_create_registration_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_create_registration_invite(text) TO service_role;
