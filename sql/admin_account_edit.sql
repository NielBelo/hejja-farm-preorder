-- Adminisztrátori személyesadat-módosítás a Fiók / Szerkesztés oldalhoz.
create or replace function public.update_admin_account_profile(target_user_id uuid, profile_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_name text;
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
    or trim(profile_data ->> 'county') = ''
    or (profile_data ->> 'phone') !~ '^\+36[0-9]{9}$' then
    raise exception 'Hiányzó név, vármegye vagy érvénytelen telefonszám.' using errcode = '22023';
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
  return true;
end;
$$;

revoke all on function public.update_admin_account_profile(uuid, jsonb) from public, anon;
grant execute on function public.update_admin_account_profile(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
