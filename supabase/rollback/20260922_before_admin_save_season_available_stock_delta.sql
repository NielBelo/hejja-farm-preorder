-- ROLLBACK - a 20260922030000_admin_save_season_available_stock_delta.sql
-- migráció ELŐTTI admin_save_season_parameters definíció visszaállítása.
--
-- Forrás: a 20260921010000_bacskiskun_dunavecse.sql migrációban
-- verziózott definíció szó szerinti másolata - ez a legutóbbi, a repóban
-- rögzített admin_save_season_parameters verzió a fenti migráció előtt,
-- amit maga a 20260921010000 migráció is egy valódi éles
-- pg_get_functiondef()-pillanatkép alapján vezetett be.
--
-- FONTOS KORLÁTOZÁS: ha a 20260922030000 migráció már lefutott és élesben
-- ment(ek) is napi limitet, ez a rollback CSAK a function DEFINÍCIÓJÁT
-- állítja vissza a korábbi (delta-korrekció nélküli) viselkedésre - a
-- pickup_days.available_stock időközben már elvégzett delta-korrekcióit NEM
-- vonja vissza. Ha az adatokat is pontosan az előző állapotra kell
-- visszaállítani, A MIGRÁCIÓ FUTTATÁSA ELŐTT mentsd le:
--   SELECT id, planned_stock, available_stock FROM public.pickup_days WHERE kind = 'normal';
-- és azt az exportot használd a visszaállításhoz.
--
-- Használat: csak akkor fusson, ha a 20260922030000 migrációt (a napi limit
-- módosításakor az available_stock delta-alapú korrekciója) vissza kell
-- vonni.

BEGIN;

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
  v_blocked_dates text;
  v_last_normal_date date;
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

  -- Olyan (normál) nap, amit a form már nem tartalmaz, de van hozzá
  -- rendelés: ezt a delete lent úgysem törölné, ezért itt, a mentés elején
  -- egyértelmű hibaüzenettel elutasítjuk, ahelyett hogy csendben megtartanánk.
  -- A DUNAVECSE napot ez a védelem nem érinti, az sosincs a form napjai
  -- között, és a hozzá tartozó rendelések önmagában a nap deaktiválásával,
  -- fizikai törlés nélkül védettek.
  if v_id is not null then
    select string_agg(to_char(p.pickup_date, 'YYYY.MM.DD'), ', ' order by p.pickup_date)
    into v_blocked_dates
    from public.pickup_days p
    where p.season_parameter_id = v_id
      and p.kind = 'normal'
      and exists (select 1 from public.orders o where o.pickup_day_id = p.id)
      and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date = p.pickup_date);

    if v_blocked_dates is not null then
      raise exception 'A következő átvételi nap(ok)hoz már van rendelés, ezért nem törölhetők: %. Deaktiválja őket törlés helyett.', v_blocked_dates
        using errcode = '22023';
    end if;
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
  -- Kivett átvételi napok törlése; a fenti ellenőrzés miatt ide már csak
  -- olyan NORMÁL napok jutnak el, amelyekhez soha nem tartozott semmilyen
  -- (submitted vagy cancelled) rendelés - a rendelési előzmény megőrzése
  -- érdekében egy már valaha megrendelt nap fizikailag nem törölhető, csak
  -- inaktiválható. A DUNAVECSE nap (kind = 'dunavecse') ezt a törlést soha
  -- nem érinti.
  delete from public.pickup_days p where p.season_parameter_id = v_season_id
    and p.kind = 'normal'
    and not exists (select 1 from public.orders o where o.pickup_day_id = p.id)
    and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date = p.pickup_date);
  for v_day in select * from jsonb_array_elements(v_days) loop
    v_date := (v_day->>'date')::date; v_limit := (v_day->>'limit')::integer;
    v_day_active := coalesce((v_day->>'active')::boolean, true);
    update public.pickup_days
      set planned_stock = v_limit, is_active = v_day_active, year = v_year, season = v_season
      where season_parameter_id = v_season_id and pickup_date = v_date and kind = 'normal';
    if not found then
      insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
      values(v_year, v_season, v_date, v_limit, v_limit, v_day_active, 1, 1, v_season_id, 'normal');
    end if;
  end loop;

  -- DUNAVECSE technikai nap: minden szezonhoz pontosan egy tartozik,
  -- automatikusan létrehozva/karbantartva, sosem szerepel a fenti,
  -- adminisztrátor által szerkesztett napok listájában. Dátuma mindig a
  -- szezon (az imént mentett) utolsó NORMÁL átvételi napjával egyezik,
  -- ezért minden mentéskor újraszámoljuk. Az is_active mezőt itt sosem
  -- írjuk felül, hogy az admin_set_pickup_day_active-en keresztüli
  -- deaktiválás egy soron következő szezon-mentéskor ne álljon vissza
  -- csendben aktívra.
  select max(pickup_date) into v_last_normal_date
    from public.pickup_days
    where season_parameter_id = v_season_id and kind = 'normal';

  update public.pickup_days
    set pickup_date = v_last_normal_date, year = v_year, season = v_season
    where season_parameter_id = v_season_id and kind = 'dunavecse';

  if not found then
    insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
    values(v_year, v_season, v_last_normal_date, null, null, true, 1, 1, v_season_id, 'dunavecse');
  end if;

  return true;
end;
$$;

revoke all on function public.admin_save_season_parameters(jsonb) from public, anon;
grant execute on function public.admin_save_season_parameters(jsonb) to authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
