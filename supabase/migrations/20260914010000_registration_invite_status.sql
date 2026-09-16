-- Meghívók állapotának követése a Fiók / Szerkesztés listában.
-- A weboldalon létrehozott, fel nem használt meghívó "Meghívó elküldve"
-- állapotú. A sent_at mező csak a kiküldés időpontjának auditadata.

create or replace function public.mark_registration_invite_sent(target_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  update public.registration_invites
  set sent_at = coalesce(sent_at, now())
  where id = target_invite_id
    and used_at is null;

  return found;
end;
$$;

revoke all on function public.mark_registration_invite_sent(uuid) from public, anon;
grant execute on function public.mark_registration_invite_sent(uuid) to authenticated;

create or replace function public.admin_create_registration_invite(invitee_email text)
returns table(invite_id uuid, invite_token text)
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  return query select * from public.create_registration_invite(invitee_email);
end;
$$;

create or replace function public.admin_mark_registration_invite_sent(target_invite_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  update public.registration_invites set sent_at = now() where id = target_invite_id and used_at is null;
  if not found then raise exception 'A meghívó nem található vagy már felhasználták.' using errcode = 'P0002'; end if;
  return true;
end;
$$;

revoke all on function public.admin_create_registration_invite(text) from public, anon;
revoke all on function public.admin_mark_registration_invite_sent(uuid) from public, anon;
grant execute on function public.admin_create_registration_invite(text) to authenticated;
grant execute on function public.admin_mark_registration_invite_sent(uuid) to authenticated;

create or replace function public.get_admin_accounts(page_offset integer default 0, page_size integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  return (
    with accounts as (
      select u.id::text as id, u.id as user_id, u.email,
        p.first_name, p.last_name, p.phone, p.county, p.city, p.special_size_preference,
        coalesce(r.role::text, 'user') as role,
        coalesce(r.is_superadmin, false) as is_superadmin,
        case
          when u.email_confirmed_at is not null then 'registered'
          when u.invited_at is not null or exists (
            select 1 from public.registration_invites i
            where i.used_by_user_id is null
              and i.email = lower(u.email)
          ) then 'invited'
          else 'unconfirmed'
        end as status,
        u.created_at as registered_at, u.updated_at, u.email_confirmed_at,
        u.last_sign_in_at, u.invited_at, u.confirmation_sent_at,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id, 'email', i.email, 'created_at', i.created_at,
          'sent_at', i.sent_at, 'used_at', i.used_at
        ) order by i.created_at), '[]'::jsonb)
        from public.registration_invites i where i.used_by_user_id = u.id
          or (i.used_by_user_id is null and i.email = lower(u.email))) as invites,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'document_type', c.document_type,
          'document_version', c.document_version, 'accepted_at', c.accepted_at
        ) order by c.accepted_at), '[]'::jsonb)
        from public.user_consents c where c.user_id = u.id) as consents
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join public.user_roles r on r.user_id = u.id

      union all

      select 'invite:' || i.email, null::uuid, i.email,
        null::text, null::text, null::text, null::text, null::text, null::text,
        'user'::text, false,
        'invited'::text,
        null::timestamptz, null::timestamptz, null::timestamptz,
        null::timestamptz, null::timestamptz, null::timestamptz,
        jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email,
          'created_at', i.created_at, 'sent_at', i.sent_at, 'used_at', i.used_at)
          order by i.created_at), '[]'::jsonb
      from public.registration_invites i
      where i.used_by_user_id is null
        and not exists (select 1 from auth.users u where lower(u.email) = i.email)
      group by i.email
    )
    select coalesce(jsonb_agg(to_jsonb(page) order by page.id), '[]'::jsonb)
    from (select * from accounts order by id
      limit greatest(1, least(page_size, 200)) offset greatest(0, page_offset)) page
  );
end;
$$;

revoke all on function public.get_admin_accounts(integer, integer) from public, anon;
grant execute on function public.get_admin_accounts(integer, integer) to authenticated;

notify pgrst, 'reload schema';
