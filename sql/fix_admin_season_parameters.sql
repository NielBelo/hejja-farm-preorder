-- Futtasd a Supabase SQL Editorban. A rendelést tartalmazó szezonok
-- átvételi napjai ezután is szerkeszthetők maradnak.
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
  if v_active then
    update public.season_parameters set is_active = false where is_active;
    update public.pickup_days set is_active = false where is_active;
  end if;
  if v_id is null then
    insert into public.season_parameters(year, season, weight_min, weight_max, price, is_active, time_window_start, time_window_end)
    values(v_year, v_season, v_weight_min, v_weight_max, v_price, v_active, v_start::timestamptz, v_end::timestamptz);
  else
    update public.season_parameters set year=v_year, season=v_season, weight_min=v_weight_min, weight_max=v_weight_max, price=v_price, is_active=v_active, time_window_start=v_start::timestamptz, time_window_end=v_end::timestamptz where id=v_id;
  end if;
  delete from public.pickup_days p where p.year=v_year and p.season=v_season
    and not exists (select 1 from public.orders o where o.pickup_day_id=p.id)
    and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date=p.pickup_date);
  for v_day in select * from jsonb_array_elements(v_days) loop
    v_date := (v_day->>'date')::date; v_limit := (v_day->>'limit')::integer;
    update public.pickup_days set planned_stock=v_limit, is_active=v_active where year=v_year and season=v_season and pickup_date=v_date;
    if not found then
      insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group)
      values(v_year, v_season, v_date, v_limit, v_limit, v_active, 1, 1);
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.admin_save_season_parameters(jsonb) from public, anon;
grant execute on function public.admin_save_season_parameters(jsonb) to authenticated;
