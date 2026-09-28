-- admin_save_season_parameters: az átvételi nap "Napi limit" (planned_stock)
-- módosításakor az elérhető készletet (available_stock) a limit
-- VÁLTOZÁSÁNAK deltájával korrigáljuk, nem írjuk felül vakon.
--
-- Eddigi hibás viselkedés: a napi ciklus egyszerűen
--   update public.pickup_days set planned_stock = v_limit, ...
-- -t futtatott, az available_stock érintetlenül hagyásával. Ez azt
-- jelentette, hogy limit emelésekor az emelés NEM jelent meg elérhető
-- készletként (a plusz kapacitás "elveszett"), limit csökkentésekor pedig az
-- available_stock a réginél nagyobb is maradhatott a planned_stock-nál - azaz
-- a már lefoglalt mennyiség (planned_stock - available_stock) a limit
-- módosításakor helytelenül megváltozott, holott a ténylegesen lefoglalt
-- (rendelt) mennyiség nem változott.
--
-- Új viselkedés:
--   delta = new_planned_stock - old_planned_stock
--   new_available_stock = old_available_stock + delta
-- Ez a planned_stock - available_stock (= lefoglalt mennyiség) különbséget
-- változatlanul hagyja, kizárólag a limit változásának deltájával tolja el az
-- elérhető készletet - NEM számolja újra a rendelésekből.
--
-- Védelem negatív available_stock ellen: ha a csökkentés miatt
-- new_available_stock negatív lenne (azaz az új limit kisebb, mint a napra
-- már lefoglalt mennyiség), a mentés egy érthető hibaüzenettel explicit
-- meghiúsul, nem menti el vakon a negatív értéket.
--
-- Konkurencia/duplikált mentés elleni védelem: a sor módosítása előtt
-- `SELECT ... FOR UPDATE`-del zároljuk az adott pickup_days sort, majd A MÁR
-- ZÁROLT, AKTUÁLIS planned_stock/available_stock értékekből számoljuk a
-- deltát. Két konkurens mentés emiatt sorosan, egymás után fut (a második a
-- FOR UPDATE-en blokkol, majd az első által már frissített planned_stock-ot
-- olvassa "régi" értékként) - így nem történhet dupla korrekció. Ugyanez
-- védi az ismételt (pl. duplán elküldött) mentést is: a második futás a
-- delta-t a már megváltozott planned_stock-hoz képest számolja újra
-- (jellemzően 0 delta, ha a beküldött limit nem változott az első mentés
-- óta), nem egy elavult "régi" értékhez képest.
--
-- A DUNAVECSE (kind = 'dunavecse') technikai napot ez a ciklus nem érinti -
-- a WHERE/kereső feltétel változatlanul kind = 'normal'-ra szűkít, a
-- DUNAVECSE nap karbantartása a függvény alábbi, külön szakaszában történik,
-- azt ez a migráció nem módosítja.
--
-- A függvény minden más része (validáció, szezon insert/update, kivezetett
-- napok törlése, DUNAVECSE nap karbantartása) szó szerint megegyezik a
-- legutóbbi verziózott definícióval
-- (20260921010000_bacskiskun_dunavecse.sql) - ez a migráció kizárólag a napi
-- ciklus készletkorrekciós logikáját cseréli le.
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
  v_existing_id bigint;
  v_old_planned_stock integer;
  v_old_available_stock integer;
  v_delta integer;
  v_new_available_stock integer;
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

    -- A sor zárolása (FOR UPDATE) a delta-számítás előtt: konkurens mentések
    -- így sorosan, a másik által már elvégzett korrekciót látva futnak,
    -- ismételt/duplán elküldött mentésnél pedig a delta a már frissített
    -- planned_stock-hoz képest 0-ra adódik - egyik esetben sem történik
    -- dupla készletkorrekció.
    select id, planned_stock, available_stock
      into v_existing_id, v_old_planned_stock, v_old_available_stock
      from public.pickup_days
      where season_parameter_id = v_season_id and pickup_date = v_date and kind = 'normal'
      for update;

    if found then
      v_delta := v_limit - v_old_planned_stock;
      v_new_available_stock := v_old_available_stock + v_delta;

      if v_new_available_stock < 0 then
        raise exception 'A(z) % napi limitje (% db) kisebb, mint az erre a napra már lefoglalt mennyiség (% db). Növelje a limitet, vagy mondasson le rendelés(eke)t a csökkentés előtt.',
          to_char(v_date, 'YYYY.MM.DD'), v_limit, v_old_planned_stock - v_old_available_stock
          using errcode = '22023';
      end if;

      update public.pickup_days
        set planned_stock = v_limit, available_stock = v_new_available_stock,
            is_active = v_day_active, year = v_year, season = v_season
        where id = v_existing_id;
    else
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
