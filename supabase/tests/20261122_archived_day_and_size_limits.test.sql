-- Ellenőrző script a 20261122010000_archived_day_and_size_limits.sql
-- migrációhoz: az archivált napra rendelés tiltását és a napi kisebb/nagyobb
-- méret limitet (enforce_daily_size_limit trigger), valamint a
-- get_pickup_day_size_availability() függvényt teszteli.
--
-- HASZNÁLAT: Supabase SQL Editorban (postgres jogosultsággal) futtatható.
-- BEGIN ... ROLLBACK: semmilyen adat nem marad bent. Kell hozzá egy meglévő
-- admin felhasználó és legalább két meglévő, NEM admin profil, valamint
-- legalább egy termék és csomag. A 2099-es "Ősz" tesztszezont hozza létre.
-- A felhasználókat a request.jwt.claims GUC beállításával szimulálja
-- (auth.uid()). Sikeres futás: hiba nélkül lefut (a Supabase Editor a NOTICE
-- üzenetet nem mutatja); hiba esetén RAISE EXCEPTION mondja meg, melyik eset
-- hibázott.
BEGIN;

-- Rendelés létrehozása adott felhasználóként úgy, ahogy a finalize_order teszi:
-- fejléc, verzió, tétel, majd a current_version_id beállítása (ez indítja az
-- ellenőrző triggereket).
create function pg_temp.make_order(p_user uuid, p_season bigint, p_day bigint, p_size text, p_qty integer)
returns bigint language plpgsql as $f$
declare
  v_order bigint;
  v_version bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  insert into public.orders (user_id, season_parameter_id, pickup_day_id, public_order_number)
  values (p_user, p_season, p_day, public.generate_order_number())
  returning id into v_order;
  insert into public.order_versions (order_id, version_number, change_type, created_by)
  values (v_order, 1, 'created', p_user)
  returning id into v_version;
  insert into public.order_items (order_version_id, product_id, package_id, quantity, size_preference)
  values (v_version, (select min(id) from public.products), (select min(id) from public.packages), p_qty, p_size);
  update public.orders set current_version_id = v_version where id = v_order;
  return v_order;
end
$f$;

DO $test$
declare
  v_admin uuid;
  v_a uuid;
  v_b uuid;
  v_season_id bigint;
  v_day1 bigint;
  v_day2 bigint;
  v_order_a bigint;
  v_order bigint;
  v_small integer;
  v_large integer;
  v_failed boolean;
  v_small_label text := 'Átlagostól kisebb méret';
  v_large_label text := 'Átlagostól nagyobb méret';
begin
  select ur.user_id into v_admin from public.user_roles ur
    join auth.users u on u.id = ur.user_id
    where ur.role = 'admin' limit 1;
  select p.id into v_a from public.profiles p
    where p.id not in (select user_id from public.user_roles where role = 'admin') order by p.id limit 1;
  select p.id into v_b from public.profiles p
    where p.id not in (select user_id from public.user_roles where role = 'admin') and p.id <> v_a order by p.id limit 1;
  if v_admin is null or v_a is null or v_b is null then
    raise exception 'TEST SETUP: kell egy admin és két nem admin profil.';
  end if;

  -- Szezon: 1. nap kisebb méret limit 3, nagyobb méret korlátlan; 2. nap korlátlan.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_save_season_parameters(jsonb_build_object(
    'year', 2099, 'type', 'Ősz', 'price', 1000, 'weightMin', 2, 'weightMax', 3,
    'orderStart', '2099-01-01', 'orderEnd', '2099-02-01',
    'pickupTimeStart', '09:00', 'pickupTimeEnd', '17:00', 'localPickupTimeStart', '08:00',
    'active', false,
    'pickupDays', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true, 'smallSizeLimit', 3),
      jsonb_build_object('date', '2099-03-08', 'limit', 1000, 'active', true))));
  select id into v_season_id from public.season_parameters where year = 2099 and season = 'Ősz';
  select id into v_day1 from public.pickup_days where season_parameter_id = v_season_id and pickup_date = '2099-03-01' and kind = 'normal';
  select id into v_day2 from public.pickup_days where season_parameter_id = v_season_id and pickup_date = '2099-03-08' and kind = 'normal';

  -- 1) A limiten belül rendelhető
  v_order_a := pg_temp.make_order(v_a, v_season_id, v_day1, v_small_label, 2);

  -- 2) A limit átlépése hibát ad
  v_failed := false;
  begin
    perform pg_temp.make_order(v_b, v_season_id, v_day1, v_small_label, 2);
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 2: a kisebb méret limit átlépése nem hibázott.';
  end if;

  -- 3) Pontosan a limitig még rendelhető
  perform pg_temp.make_order(v_b, v_season_id, v_day1, v_small_label, 1);

  -- 4) A korlátlan (NULL) nagyobb méretre nincs limit; az "Átlagos méret" sem számít
  perform pg_temp.make_order(v_a, v_season_id, v_day1, v_large_label, 500);
  perform pg_temp.make_order(v_a, v_season_id, v_day1, 'Átlagos méret', 5);

  -- 5) Hátralévő mennyiség: kisebb 0, nagyobb NULL (korlátlan)
  select small_remaining, large_remaining into v_small, v_large
    from public.get_pickup_day_size_availability() where pickup_day_id = v_day1;
  if v_small is distinct from 0 or v_large is not null then
    raise exception 'FAIL 5: hibás hátralévő mennyiség (kicsi: %, nagy: %).', v_small, v_large;
  end if;
  if exists (select 1 from public.get_pickup_day_size_availability() where pickup_day_id = v_day2) then
    raise exception 'FAIL 5b: a korlátlan nap szerepel az elérhetőség-listában.';
  end if;

  -- 6) A lemondott rendelés felszabadítja a keretet
  update public.orders set status = 'cancelled' where id = v_order_a;
  perform pg_temp.make_order(v_b, v_season_id, v_day1, v_small_label, 2);

  -- 7) Archivált napra a vásárló nem rendelhet, az admin igen
  update public.pickup_days set archived_at = now() where id = v_day2;
  v_failed := false;
  begin
    perform pg_temp.make_order(v_a, v_season_id, v_day2, 'Átlagos méret', 1);
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 7: archivált napra rendelni lehetett vásárlóként.';
  end if;
  perform pg_temp.make_order(v_admin, v_season_id, v_day2, 'Átlagos méret', 1);

  -- 8) Az archivált nap nem szerepel az elérhetőség-listában
  update public.pickup_days set archived_at = now(), small_size_limit = 5 where id = v_day1;
  if exists (select 1 from public.get_pickup_day_size_availability() where pickup_day_id = v_day1) then
    raise exception 'FAIL 8: archivált nap szerepel az elérhetőség-listában.';
  end if;

  raise notice 'ALL ARCHIVED-DAY AND SIZE-LIMIT TESTS PASSED';
end
$test$;

ROLLBACK;
