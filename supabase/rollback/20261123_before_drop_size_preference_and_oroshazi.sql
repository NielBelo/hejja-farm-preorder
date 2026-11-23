-- Rollback a 20261123000000_drop_size_preference_and_oroshazi.sql migrációhoz.
-- A függvények, a trigger és a constraint a migráció ELŐTTI éles állapot
-- (supabase/schema tükör). A két oszlop újra létrejön, de az ADATUK NEM áll
-- vissza: azt biztonsági mentésből kell visszatölteni.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN special_size_preference text,
  ADD COLUMN oroshazi_delivery boolean DEFAULT false NOT NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_special_size_preference_check CHECK (((special_size_preference IS NULL) OR (special_size_preference = ANY (ARRAY['smaller'::text, 'larger'::text]))));

CREATE OR REPLACE FUNCTION public.get_admin_accounts_without_oroshazi_delivery(page_offset integer DEFAULT 0, page_size integer DEFAULT 200)
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
$function$;

REVOKE ALL ON FUNCTION get_admin_accounts_without_oroshazi_delivery(integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_admin_accounts_without_oroshazi_delivery(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_accounts_without_oroshazi_delivery(integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_accounts(page_offset integer DEFAULT 0, page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  accounts jsonb;
begin
  accounts := public.get_admin_accounts_without_oroshazi_delivery(page_offset, page_size);
  return coalesce((
    select jsonb_agg(account || jsonb_build_object(
      'oroshazi_delivery', coalesce((
        select p.oroshazi_delivery
        from public.profiles p
        where p.id = nullif(account ->> 'user_id', '')::uuid
      ), false)
    ) order by account ->> 'id')
    from jsonb_array_elements(accounts) account
  ), '[]'::jsonb);
end;
$function$;

REVOKE ALL ON FUNCTION get_admin_accounts(integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_admin_accounts(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_accounts(integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.update_admin_oroshazi_delivery(target_user_id uuid, enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  update public.profiles
  set oroshazi_delivery = enabled
  where id = target_user_id;

  if not found then
    raise exception 'A felhasználó személyes adatlapja nem található.' using errcode = 'P0002';
  end if;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION update_admin_oroshazi_delivery(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_admin_oroshazi_delivery(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION update_admin_oroshazi_delivery(uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.update_admin_account_profile(target_user_id uuid, profile_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION update_admin_account_profile(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_admin_account_profile(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION update_admin_account_profile(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_size_preference_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_preference text;
  v_pickup_kind text;
  v_season_parameter_id bigint;
  v_pickup_date date;
  v_first_normal_date date;
  v_last_normal_date date;
  v_limit int;
  v_other_customers int;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    return new;
  end if;

  select kind, season_parameter_id, pickup_date
  into v_pickup_kind, v_season_parameter_id, v_pickup_date
  from public.pickup_days where id = new.pickup_day_id;

  if v_pickup_kind = 'dunavecse' then
    return new;
  end if;

  select special_size_preference into v_preference
  from public.profiles where id = new.user_id;

  if v_preference is null then
    return new;
  end if;

  if v_preference = 'larger' then
    select min(pickup_date), max(pickup_date)
    into v_first_normal_date, v_last_normal_date
    from public.pickup_days
    where season_parameter_id = v_season_parameter_id and kind = 'normal';

    if v_pickup_date = v_first_normal_date or v_pickup_date = v_last_normal_date then
      raise exception 'A "Nagyobb méret preferáció" vásárlók a szezon első és utolsó átvételi napjára nem rendelhetnek.'
        using errcode = '22023';
    end if;

    v_limit := 1;
  else
    v_limit := 2;
  end if;

  -- Konkurens rendelések ellen: a tényleges darabszám-ellenőrzés előtt egy
  -- tranzakció-szintű advisory lockot veszünk fel az (átvételi nap,
  -- preferencia) párra, így két egyidejű tranzakció nem láthatja
  -- egymástól függetlenül "szabadnak" ugyanazt a keretet.
  perform pg_advisory_xact_lock(
    hashtextextended('pickup_day_size_preference:' || new.pickup_day_id || ':' || v_preference, 0)
  );

  select count(distinct o.user_id) into v_other_customers
  from public.orders o
  join public.profiles p on p.id = o.user_id
  where o.pickup_day_id = new.pickup_day_id
    and o.status = 'submitted'
    and o.user_id <> new.user_id
    and p.special_size_preference = v_preference;

  if v_other_customers >= v_limit then
    raise exception 'Erre a napra már foglalt a keret a(z) "%" méretpreferenciájú vásárlók számára.',
      case v_preference when 'smaller' then 'Kisebb méret preferáció' else 'Nagyobb méret preferáció' end
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION enforce_size_preference_limit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enforce_size_preference_limit() TO PUBLIC;
GRANT EXECUTE ON FUNCTION enforce_size_preference_limit() TO anon;
GRANT EXECUTE ON FUNCTION enforce_size_preference_limit() TO authenticated;
GRANT EXECUTE ON FUNCTION enforce_size_preference_limit() TO service_role;

CREATE OR REPLACE FUNCTION public.get_size_preference_locks()
 RETURNS TABLE(pickup_day_id bigint, preference text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select o.pickup_day_id, 'smaller'::text as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  join public.pickup_days pd on pd.id = o.pickup_day_id
  where o.status = 'submitted'
    and p.special_size_preference = 'smaller'
    and o.user_id is distinct from auth.uid()
    and pd.kind = 'normal'
  group by o.pickup_day_id
  having count(distinct o.user_id) >= 2
  union
  select o.pickup_day_id, 'larger'::text as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  join public.pickup_days pd on pd.id = o.pickup_day_id
  where o.status = 'submitted'
    and p.special_size_preference = 'larger'
    and o.user_id is distinct from auth.uid()
    and pd.kind = 'normal'
  group by o.pickup_day_id
  having count(distinct o.user_id) >= 1
  union
  select pd.id, 'larger'::text
  from public.pickup_days pd
  where pd.kind = 'normal'
    and pd.pickup_date in (
      select min(pickup_date) from public.pickup_days
      where season_parameter_id = pd.season_parameter_id and kind = 'normal'
      union
      select max(pickup_date) from public.pickup_days
      where season_parameter_id = pd.season_parameter_id and kind = 'normal'
    )
$function$;

REVOKE ALL ON FUNCTION get_size_preference_locks() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_size_preference_locks() TO authenticated;
GRANT EXECUTE ON FUNCTION get_size_preference_locks() TO service_role;

CREATE TRIGGER trg_enforce_size_preference_limit BEFORE INSERT OR UPDATE OF pickup_day_id, current_version_id ON public.orders FOR EACH ROW EXECUTE FUNCTION enforce_size_preference_limit();

COMMIT;
