-- A vásárlói méretpreferencia (profiles.special_size_preference) és az orosházi
-- kiszállítás jelölő (profiles.oroshazi_delivery) megszűnik. A méretkorlát
-- ezentúl kizárólag a napi limiteken (pickup_days.small/large_size_limit)
-- alapul (enforce_daily_size_limit).
--
-- FIGYELEM: csak AZUTÁN futtatható, hogy a kód (5485c8b, 686b1e4) élesben van:
-- a korábbi deploy még olvassa a két oszlopot, és hívja az
-- update_admin_oroshazi_delivery függvényt.
--
-- Az oszlopok adata elvész (a felhasználó jóváhagyta; szükség esetén mentésből
-- visszaállítható). Rollback: supabase/rollback/20261123_before_drop_size_preference_and_oroshazi.sql
BEGIN;

-- 1) Régi méretpreferencia-korlát: trigger és függvényei.
DROP TRIGGER IF EXISTS trg_enforce_size_preference_limit ON public.orders;
DROP FUNCTION IF EXISTS public.enforce_size_preference_limit();
DROP FUNCTION IF EXISTS public.get_size_preference_locks();

-- 2) get_admin_accounts: a két oszlop nélküli, önálló definíció (a korábbi
--    get_admin_accounts_without_oroshazi_delivery köztes függvény megszűnik).
CREATE OR REPLACE FUNCTION public.get_admin_accounts(page_offset integer DEFAULT 0, page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  return (
    with accounts as (
      select u.id::text as id, u.id as user_id, u.email,
        p.first_name, p.last_name, p.phone, p.county, p.city,
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
        null::text, null::text, null::text, null::text, null::text,
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
$function$;

REVOKE ALL ON FUNCTION get_admin_accounts(integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_admin_accounts(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_accounts(integer,integer) TO service_role;

DROP FUNCTION IF EXISTS public.get_admin_accounts_without_oroshazi_delivery(integer, integer);
DROP FUNCTION IF EXISTS public.update_admin_oroshazi_delivery(uuid, boolean);

-- 3) update_admin_account_profile: a méretigény kezelése megszűnik, a függvény
--    többi része változatlan.
CREATE OR REPLACE FUNCTION public.update_admin_account_profile(target_user_id uuid, profile_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  field_name text;
  requested_role text;
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

  update public.profiles set
    first_name = trim(profile_data ->> 'first_name'),
    last_name = trim(profile_data ->> 'last_name'),
    phone = profile_data ->> 'phone',
    county = trim(profile_data ->> 'county'),
    city = trim(profile_data ->> 'city')
  where id = target_user_id;
  if not found then
    raise exception 'A felhasználó személyes adatlapja nem található.' using errcode = 'P0002';
  end if;

  insert into public.user_roles (user_id, role)
  values (target_user_id, case when requested_role = 'admin' then 'admin' else 'user' end)
  on conflict (user_id) do update set role = excluded.role;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION update_admin_account_profile(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_admin_account_profile(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION update_admin_account_profile(uuid,jsonb) TO service_role;

-- 4) Az oszlopok eldobása (a profiles_special_size_preference_check constraint
--    az oszloppal együtt megszűnik).
ALTER TABLE public.profiles
  DROP COLUMN special_size_preference,
  DROP COLUMN oroshazi_delivery;

COMMIT;
