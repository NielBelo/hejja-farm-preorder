-- Egyes átvételi napok külön aktiválása/inaktiválása.
--
-- Eddig egy szezon mentésekor az összes hozzá tartozó átvételi nap
-- is_active mezője kényszerítve a szezon aktív állapotára állt (lásd a
-- korábbi admin_save_season_parameters-t). Mostantól minden nap saját,
-- egymástól és a szezon állapotától is független is_active állapottal
-- rendelkezik: a kliens (SeasonManager) az egyes napokhoz tartozó
-- pickupDays[].active mezőt küldi, és ezt a mentés figyelembe veszi
-- a korábbi automatikus felülírás helyett.
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
  v_pickup_time_start time := (season_data ->> 'pickupTimeStart')::time;
  v_pickup_time_end time := (season_data ->> 'pickupTimeEnd')::time;
  v_local_pickup_time_start time := (season_data ->> 'localPickupTimeStart')::time;
  v_days jsonb := season_data -> 'pickupDays';
  v_active boolean := coalesce((season_data ->> 'active')::boolean, false);
  v_day jsonb; v_date date; v_limit integer; v_day_active boolean;
  v_season_id bigint;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if v_year is null or v_season not in ('Tavasz','Ősz') or v_price is null or v_price < 0
    or v_weight_min is null or v_weight_min <= 0 or v_weight_max is null or v_weight_max < v_weight_min
    or v_start is null or v_end is null or v_start > v_end
    or v_pickup_time_start is null or v_pickup_time_end is null or v_pickup_time_start >= v_pickup_time_end
    or v_local_pickup_time_start is null
    or jsonb_typeof(v_days) <> 'array'
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
    insert into public.season_parameters(
      year, season, weight_min, weight_max, price, is_active,
      time_window_start, time_window_end, pickup_time_start, pickup_time_end, local_pickup_time_start
    )
    values(
      v_year, v_season, v_weight_min, v_weight_max, v_price, v_active,
      v_start::timestamptz, v_end::timestamptz, v_pickup_time_start, v_pickup_time_end, v_local_pickup_time_start
    )
    returning id into v_season_id;
  else
    update public.season_parameters
      set year = v_year, season = v_season, weight_min = v_weight_min, weight_max = v_weight_max,
          price = v_price, is_active = v_active, time_window_start = v_start::timestamptz, time_window_end = v_end::timestamptz,
          pickup_time_start = v_pickup_time_start, pickup_time_end = v_pickup_time_end,
          local_pickup_time_start = v_local_pickup_time_start
      where id = v_id
      returning id into v_season_id;
  end if;
  -- Kivett átvételi napok törlése, kivéve amelyekre már érkezett rendelés.
  delete from public.pickup_days p where p.season_parameter_id = v_season_id
    and not exists (select 1 from public.orders o where o.pickup_day_id = p.id)
    and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date = p.pickup_date);
  for v_day in select * from jsonb_array_elements(v_days) loop
    v_date := (v_day->>'date')::date; v_limit := (v_day->>'limit')::integer;
    v_day_active := coalesce((v_day->>'active')::boolean, true);
    update public.pickup_days
      set planned_stock = v_limit, is_active = v_day_active, year = v_year, season = v_season
      where season_parameter_id = v_season_id and pickup_date = v_date;
    if not found then
      insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id)
      values(v_year, v_season, v_date, v_limit, v_limit, v_day_active, 1, 1, v_season_id);
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.admin_save_season_parameters(jsonb) from public, anon;
grant execute on function public.admin_save_season_parameters(jsonb) to authenticated;

-- Egyetlen átvételi nap gyors aktiválása/inaktiválása a teljes szezon-
-- szerkesztő megnyitása és a többi mező újbóli elmentése nélkül.
--
-- Átvételi nap csak akkor aktiválható, ha a hozzá tartozó szezon is aktív -
-- egy inaktív szezon napjainak egyenkénti aktiválása értelmetlen volna,
-- hiszen a szezon inaktív állapota már önmagában kizárja a rendelést.
-- Inaktiválni viszont bármikor lehet, a szezon állapotától függetlenül.
create or replace function public.admin_set_pickup_day_active(target_id bigint, is_active boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_season_active boolean;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if admin_set_pickup_day_active.is_active then
    select sp.is_active into v_season_active
    from public.pickup_days pd
    join public.season_parameters sp on sp.id = pd.season_parameter_id
    where pd.id = target_id;
    if not found then
      raise exception 'Az átvételi nap nem található.' using errcode = 'P0002';
    end if;
    if v_season_active is not true then
      raise exception 'Átvételi nap csak aktív szezonban aktiválható.' using errcode = '22023';
    end if;
  end if;
  update public.pickup_days set is_active = admin_set_pickup_day_active.is_active where id = target_id;
  if not found then
    raise exception 'Az átvételi nap nem található.' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke all on function public.admin_set_pickup_day_active(bigint, boolean) from public, anon;
grant execute on function public.admin_set_pickup_day_active(bigint, boolean) to authenticated;

-- Inaktív átvételi napra normál felhasználó sem új rendelést nem adhat le,
-- sem meglévő rendelést nem módosíthat (sem a tartalmát, sem az átvételi
-- napját nem válthatja át erre a napra) - a korábban leadott rendelések
-- ettől függetlenül megmaradnak, és admin továbbra is kezelheti őket.
--
-- A finalize_order és update_order RPC-k forráskódját szándékosan nem
-- módosítjuk itt (előbbié nincs is verziózva ebben a migrációs mappában);
-- ehelyett egy trigger ellenőrzi a public.orders tábla pickup_day_id
-- oszlopát minden beszúráskor, illetve minden olyan módosításkor, amely a
-- pickup_day_id-t vagy a current_version_id-t (azaz a rendelés tartalmát)
-- érinti - ez utóbbi kettőt update_order minden módosításkor átállítja,
-- így ez lefedi mind a napváltást, mind a tételek módosítását.
create or replace function public.enforce_pickup_day_active()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_day_active boolean;
begin
  select is_active into v_day_active from public.pickup_days where id = new.pickup_day_id;
  if v_day_active is false and not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'A kiválasztott átvételi nap jelenleg nem elérhető.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_pickup_day_active on public.orders;
create trigger trg_enforce_pickup_day_active
  before insert or update of pickup_day_id, current_version_id on public.orders
  for each row execute function public.enforce_pickup_day_active();

notify pgrst, 'reload schema';
