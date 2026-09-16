-- Meghívásos regisztráció és verziózott kötelező elfogadások.
-- Futtatás előtt ellenőrizd a Dashboardban az auth.users meglévő triggereit:
-- ez a migráció nem töröl vagy ír felül ismeretlen profil-létrehozó triggert.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.registration_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email)) and email <> ''),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  used_at timestamptz,
  used_by_user_id uuid,
  constraint registration_invites_usage_consistent check (
    (used_at is null and used_by_user_id is null)
    or (used_at is not null and used_by_user_id is not null)
  )
);

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document_type text not null check (document_type <> ''),
  document_version text not null check (document_version <> ''),
  accepted_at timestamptz not null default now(),
  unique (user_id, document_type, document_version)
);

alter table public.registration_invites enable row level security;
alter table public.user_consents enable row level security;

revoke all on public.registration_invites from anon, authenticated;
revoke all on public.user_consents from anon, authenticated;
grant select on public.user_consents to authenticated;

drop policy if exists "Users can read own consents" on public.user_consents;
create policy "Users can read own consents"
  on public.user_consents for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.validate_registration_invite(invite_token text)
returns table(status text, email text)
language sql
security definer
set search_path = ''
stable
as $$
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
$$;

revoke all on function public.validate_registration_invite(text) from public;
grant execute on function public.validate_registration_invite(text) to anon, authenticated;

-- Kézi/admin használatra: a visszaadott plaintext tokent kell a linkbe tenni.
-- Az adatbázis csak a hash-t őrzi, ezért a token később nem olvasható vissza.
create or replace function public.create_registration_invite(invitee_email text)
returns table(invite_id uuid, invite_token text)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.create_registration_invite(text) from public, anon, authenticated;

create or replace function public.handle_invited_user_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.handle_invited_user_registration() from public, anon, authenticated;

drop trigger if exists on_invited_auth_user_created on auth.users;
create trigger on_invited_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_invited_user_registration();

comment on column public.registration_invites.token_hash is
  'SHA-256 hash of the URL-safe invite token; plaintext is returned only when created.';
comment on table public.user_consents is
  'Append-only audit events for accepted, versioned documents.';
