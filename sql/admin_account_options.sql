-- Admin fiókszerkesztő: adminjog, tartós méretigény és védett superadmin.
-- A meglévő sql/admin_accounts.sql és sql/admin_account_edit.sql helyett ezt a
-- kiegészítő, idempotens szkriptet futtasd a Supabase SQL Editorban.

alter table public.profiles
  add column if not exists special_size_preference text;

alter table public.profiles
  add column if not exists oroshazi_delivery boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_special_size_preference_check;

alter table public.profiles
  add constraint profiles_special_size_preference_check
  check (
    special_size_preference is null
    or special_size_preference in ('smaller', 'larger')
  );

alter table public.user_roles
  add column if not exists is_superadmin boolean not null default false;

do $$
declare
  superadmin_id uuid;
begin
  select id into superadmin_id
  from auth.users
  where lower(email) = 'kissdaniel60@gmail.com';

  if superadmin_id is null then
    raise exception 'A superadminnak kijelölt felhasználó nem található.';
  end if;

  insert into public.user_roles (user_id, role, is_superadmin)
  values (superadmin_id, 'admin', true)
  on conflict (user_id) do update
    set role = 'admin',
        is_superadmin = true;
end;
$$;

create or replace function public.prevent_superadmin_role_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_superadmin then
    if tg_op = 'DELETE' then
      raise exception 'A superadmin jogosultsági rekordja nem törölhető.' using errcode = '42501';
    end if;

    if new.is_superadmin is not true or new.role <> 'admin' then
      raise exception 'A superadmin adminisztrátori jogosultsága nem vonható vissza.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_superadmin_role_changes() from public, anon, authenticated;

drop trigger if exists protect_superadmin_role on public.user_roles;
create trigger protect_superadmin_role
before update or delete on public.user_roles
for each row execute function public.prevent_superadmin_role_changes();

create or replace function public.prevent_superadmin_profile_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.user_roles
    where user_id = old.id and is_superadmin = true
  ) then
    raise exception 'A superadmin profilja nem törölhető.' using errcode = '42501';
  end if;

  return old;
end;
$$;

revoke all on function public.prevent_superadmin_profile_deletion() from public, anon, authenticated;

drop trigger if exists protect_superadmin_profile on public.profiles;
create trigger protect_superadmin_profile
before delete on public.profiles
for each row execute function public.prevent_superadmin_profile_deletion();

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
        p.first_name, p.last_name, p.phone, p.county, p.city, p.special_size_preference, p.oroshazi_delivery,
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
        null::text, null::text, null::text, null::text, null::text, null::text, false,
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

create or replace function public.update_admin_account_profile(target_user_id uuid, profile_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_name text;
  requested_role text;
  requested_size_preference text;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  foreach field_name in array array['first_name', 'last_name', 'phone', 'county', 'city'] loop
    if jsonb_typeof(profile_data -> field_name) is distinct from 'string'
      or length(trim(profile_data ->> field_name)) > 100 then
      raise exception 'Érvénytelen személyes adatok.' using errcode = '22023';
    end if;
  end loop;

  if trim(profile_data ->> 'first_name') = '' or trim(profile_data ->> 'last_name') = ''
    or trim(profile_data ->> 'county') = '' or trim(profile_data ->> 'city') = ''
    or (profile_data ->> 'phone') !~ '^\+36[0-9]{9}$' then
    raise exception 'Hiányzó név, vármegye, település vagy érvénytelen telefonszám.' using errcode = '22023';
  end if;

  requested_role := profile_data ->> 'role';
  if requested_role not in ('user', 'admin') then
    raise exception 'Érvénytelen jogosultsági beállítás.' using errcode = '22023';
  end if;

  requested_size_preference := nullif(profile_data ->> 'special_size_preference', '');
  if requested_size_preference is not null and requested_size_preference not in ('smaller', 'larger') then
    raise exception 'Érvénytelen méretigény.' using errcode = '22023';
  end if;

  update public.profiles set
    first_name = trim(profile_data ->> 'first_name'),
    last_name = trim(profile_data ->> 'last_name'),
    phone = profile_data ->> 'phone',
    county = trim(profile_data ->> 'county'),
    city = trim(profile_data ->> 'city'),
    special_size_preference = requested_size_preference
  where id = target_user_id;
  if not found then
    raise exception 'A felhasználó személyes adatlapja nem található.' using errcode = 'P0002';
  end if;

  insert into public.user_roles (user_id, role)
  values (target_user_id, case when requested_role = 'admin' then 'admin' else 'user' end)
  on conflict (user_id) do update set role = excluded.role;

  return true;
end;
$$;

revoke all on function public.update_admin_account_profile(uuid, jsonb) from public, anon;
grant execute on function public.update_admin_account_profile(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- Orosházi kiszállítás: futtasd ezt a blokkot akkor is, ha a fenti
-- fiókbeállítási szkript már korábban élesben lefutott.
create or replace function public.update_admin_oroshazi_delivery(target_user_id uuid, enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  update public.profiles set oroshazi_delivery = enabled where id = target_user_id;
  if not found then raise exception 'A felhasználó személyes adatlapja nem található.' using errcode = 'P0002'; end if;
  return true;
end;
$$;
revoke all on function public.update_admin_oroshazi_delivery(uuid, boolean) from public, anon;
grant execute on function public.update_admin_oroshazi_delivery(uuid, boolean) to authenticated;
notify pgrst, 'reload schema';
