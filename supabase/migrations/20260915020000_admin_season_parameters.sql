-- Szezonkezelés a meglévő season_parameters és pickup_days táblákhoz.
--
-- Az átvételi napokat a pickup_days.season_parameter_id idegen kulcs
-- alapján párosítjuk a szezonhoz (nem az év+szezon szöveg alapján), hogy
-- ugyanarra az évre/szezonra (pl. "2026 Ősz") több különálló szezon kártya
-- is létezhessen anélkül, hogy az átvételi napjaik összekeverednének.
alter table public.pickup_days
  add column if not exists season_parameter_id bigint references public.season_parameters(id) on delete set null;

create or replace function public.admin_save_season_parameters(season_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint := nullif(season_data ->> 'id','')::bigint;
  v_year integer := (season_data ->> 'year')::integer;
  v_season text := season_data ->> 'type';
  v_price integer := (season_data ->> 'price')::integer;
  v_weight_min numeric := (season_data ->> 'weightMin')::numeric;
  v_weight_max numeric := (season_data ->> 'weightMax')::numeric;
  v_start date := (season_data ->> 'orderStart')::date;
  v_end date := (season_data ->> 'orderEnd')::date;
  v_days jsonb := season_data -> 'pickupDays';
  v_active boolean := coalesce((season_data ->> 'active')::boolean, false);
  v_day jsonb; v_date date; v_limit integer;
  v_season_id bigint;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if v_year is null or v_season not in ('Tavasz','Ősz') or v_price is null or v_price < 0
    or v_weight_min is null or v_weight_min <= 0 or v_weight_max is null or v_weight_max < v_weight_min
    or v_start is null or v_end is null or v_start > v_end or jsonb_typeof(v_days) <> 'array'
    or jsonb_array_length(v_days) not between 1 and 5 then
    raise exception 'Érvénytelen szezonadatok.' using errcode = '22023';
  end if;
  if v_id is not null and not exists (select 1 from public.season_parameters where id = v_id) then
    raise exception 'A szezon nem található.' using errcode = 'P0002';
  end if;
  if v_active then
    update public.season_parameters set is_active = false where is_active and id is distinct from v_id;
    update public.pickup_days set is_active = false
      where is_active and season_parameter_id is distinct from v_id;
  end if;
  if v_id is null then
    insert into public.season_parameters(year, season, weight_min, weight_max, price, is_active, time_window_start, time_window_end)
    values(v_year, v_season, v_weight_min, v_weight_max, v_price, v_active, v_start::timestamptz, v_end::timestamptz)
    returning id into v_season_id;
  else
    update public.season_parameters
      set year = v_year, season = v_season, weight_min = v_weight_min, weight_max = v_weight_max,
          price = v_price, is_active = v_active, time_window_start = v_start::timestamptz, time_window_end = v_end::timestamptz
      where id = v_id
      returning id into v_season_id;
  end if;
  -- Kivett átvételi napok törlése, kivéve amelyekre már érkezett rendelés.
  delete from public.pickup_days p where p.season_parameter_id = v_season_id
    and not exists (select 1 from public.orders o where o.pickup_day_id = p.id)
    and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date = p.pickup_date);
  for v_day in select * from jsonb_array_elements(v_days) loop
    v_date := (v_day->>'date')::date; v_limit := (v_day->>'limit')::integer;
    update public.pickup_days
      set planned_stock = v_limit, is_active = v_active, year = v_year, season = v_season
      where season_parameter_id = v_season_id and pickup_date = v_date;
    if not found then
      insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id)
      values(v_year, v_season, v_date, v_limit, v_limit, v_active, 1, 1, v_season_id);
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.admin_save_season_parameters(jsonb) from public, anon;
grant execute on function public.admin_save_season_parameters(jsonb) to authenticated;

create or replace function public.admin_delete_season_parameters(target_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.season_parameters where id = target_id) then
    raise exception 'A szezon nem található.' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.pickup_days p
    join public.orders o on o.pickup_day_id = p.id
    where p.season_parameter_id = target_id
  ) then
    raise exception 'A szezon nem törölhető, mert már vannak hozzá rendelések.' using errcode = '23503';
  end if;
  delete from public.pickup_days where season_parameter_id = target_id;
  delete from public.season_parameters where id = target_id;
  return true;
end;
$$;
revoke all on function public.admin_delete_season_parameters(bigint) from public, anon;
grant execute on function public.admin_delete_season_parameters(bigint) to authenticated;

-- Egyszeri visszatöltés: a season_parameter_id bevezetése előtt létrehozott
-- átvételi napoknál ez a mező NULL maradt. Ott, ahol az év+szezon
-- kombináció egyértelműen egy szezonhoz tartozik, pótoljuk a kapcsolatot.
update public.pickup_days p
set season_parameter_id = sp.id
from public.season_parameters sp
where p.season_parameter_id is null
  and p.year = sp.year
  and p.season = sp.season
  and (
    select count(*) from public.season_parameters sp2
    where sp2.year = p.year and sp2.season = p.season
  ) = 1;

notify pgrst, 'reload schema';
