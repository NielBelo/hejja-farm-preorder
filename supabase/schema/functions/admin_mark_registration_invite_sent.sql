CREATE OR REPLACE FUNCTION public.admin_mark_registration_invite_sent(target_invite_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  update public.registration_invites set sent_at = now() where id = target_invite_id and used_at is null;
  if not found then raise exception 'A meghívó nem található vagy már felhasználták.' using errcode = 'P0002'; end if;
  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_mark_registration_invite_sent(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_mark_registration_invite_sent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_mark_registration_invite_sent(uuid) TO service_role;
