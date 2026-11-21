CREATE OR REPLACE FUNCTION public.handle_invited_user_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  locked_invite public.registration_invites%rowtype;
begin
  if nullif(new.raw_user_meta_data ->> 'registration_invite_token', '') is null then
    raise exception 'registration_invite_required';
  end if;

  select * into locked_invite
  from public.registration_invites
  where token_hash = extensions.digest(new.raw_user_meta_data ->> 'registration_invite_token', 'sha256')
  for update;

  if not found then raise exception 'registration_invite_invalid'; end if;
  if locked_invite.used_at is not null then raise exception 'registration_invite_used'; end if;
  if lower(trim(new.email)) <> locked_invite.email then raise exception 'registration_invite_email_mismatch'; end if;
  if coalesce((new.raw_user_meta_data ->> 'privacy_policy_accepted')::boolean, false) is not true then
    raise exception 'privacy_policy_consent_required';
  end if;

  insert into public.profiles (id, first_name, last_name, phone, county, city, email)
  values (
    new.id,
    trim(new.raw_user_meta_data ->> 'first_name'),
    trim(new.raw_user_meta_data ->> 'last_name'),
    trim(new.raw_user_meta_data ->> 'phone'),
    trim(new.raw_user_meta_data ->> 'county'),
    trim(coalesce(new.raw_user_meta_data ->> 'city', '')),
    lower(trim(new.email))
  );

  insert into public.user_consents (user_id, document_type, document_version)
  values (new.id, 'privacy_policy', '2026-09-05');

  update public.registration_invites
  set used_at = now(), used_by_user_id = new.id
  where id = locked_invite.id;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION handle_invited_user_registration() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION handle_invited_user_registration() TO service_role;
