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
