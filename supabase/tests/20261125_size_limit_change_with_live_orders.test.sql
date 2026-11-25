-- Ellenőrző script: egy AKTÍV átvételi nap kisebb/nagyobb méret limitjének
-- módosítása élő (leadott) rendelések mellett. A limit bármely irányba
-- módosítható (emelés, csökkentés, korlátlanra állítás, korlátozás), de nem
-- mehet a már rendelt mennyiség alá, és a leadott rendelések nem változnak.
-- Az admin_save_season_parameters függvényt és a
-- get_pickup_day_size_availability() visszaadott értékeit teszteli.
--
-- HASZNÁLAT: Supabase SQL Editorban (postgres jogosultsággal) futtatható.
-- BEGIN ... ROLLBACK: semmilyen adat nem marad bent. Kell hozzá egy meglévő
-- admin felhasználó és két meglévő, NEM admin profil, legalább egy termék és
-- egy csomag. A 2099-es "Ősz" tesztszezont hozza létre. Hiba nélküli lefutás =
-- siker; hiba esetén a RAISE EXCEPTION megmondja, melyik eset hibázott.
BEGIN;

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
  v_day bigint;
  v_payload jsonb;
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

  -- Aktív nap (a szezon a teszt egyszerűségéért inaktív, mint a többi teszt):
  -- kisebb limit 3, nagyobb limit 6.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_payload := jsonb_build_object(
    'year', 2099, 'type', 'Ősz', 'price', 1000, 'weightMin', 2, 'weightMax', 3,
    'orderStart', '2099-01-01', 'orderEnd', '2099-02-01',
    'pickupTimeStart', '09:00', 'pickupTimeEnd', '17:00', 'localPickupTimeStart', '08:00',
    'active', false,
    'pickupDays', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true, 'smallSizeLimit', 3, 'largeSizeLimit', 6)));
  perform public.admin_save_season_parameters(v_payload);
  select id into v_season_id from public.season_parameters where year = 2099 and season = 'Ősz';
  select id into v_day from public.pickup_days where season_parameter_id = v_season_id and pickup_date = '2099-03-01' and kind = 'normal';
  v_payload := v_payload || jsonb_build_object('id', v_season_id);

  -- Élő rendelések: kisebb 2 + 1 = 3 db, nagyobb 4 db.
  perform pg_temp.make_order(v_a, v_season_id, v_day, v_small_label, 2);
  perform pg_temp.make_order(v_b, v_season_id, v_day, v_small_label, 1);
  perform pg_temp.make_order(v_a, v_season_id, v_day, v_large_label, 4);

  -- 1) Emelés: mindkét limit nő, a rendelések nem változnak, a hátralévő nő.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
    jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true, 'smallSizeLimit', 10, 'largeSizeLimit', 8))));
  select small_remaining, large_remaining into v_small, v_large
    from public.get_pickup_day_size_availability() where pickup_day_id = v_day;
  if v_small is distinct from 7 or v_large is distinct from 4 then
    raise exception 'FAIL 1: emelés után hibás hátralévő mennyiség (kicsi: %, nagy: %).', v_small, v_large;
  end if;

  -- 2) Csökkentés pontosan a már rendelt mennyiségig: engedett, hátralévő 0.
  perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
    jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true, 'smallSizeLimit', 3, 'largeSizeLimit', 4))));
  select small_remaining, large_remaining into v_small, v_large
    from public.get_pickup_day_size_availability() where pickup_day_id = v_day;
  if v_small is distinct from 0 or v_large is distinct from 0 then
    raise exception 'FAIL 2: a rendelt mennyiségig csökkentett limit után a hátralévő nem 0 (kicsi: %, nagy: %).', v_small, v_large;
  end if;

  -- 3) A kisebb méret limit a rendelt mennyiség (3) alá nem csökkenthető.
  v_failed := false;
  begin
    perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true, 'smallSizeLimit', 2, 'largeSizeLimit', 4))));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 3: a kisebb méret limit a rendelt mennyiség alá csökkenthető volt.';
  end if;

  -- 4) A nagyobb méret limit a rendelt mennyiség (4) alá nem csökkenthető.
  v_failed := false;
  begin
    perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true, 'smallSizeLimit', 3, 'largeSizeLimit', 3))));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 4: a nagyobb méret limit a rendelt mennyiség alá csökkenthető volt.';
  end if;

  -- 5) A hibás mentések nem módosítottak semmit.
  if (select small_size_limit from public.pickup_days where id = v_day) is distinct from 3
     or (select large_size_limit from public.pickup_days where id = v_day) is distinct from 4 then
    raise exception 'FAIL 5: egy elutasított mentés mégis módosította a limiteket.';
  end if;

  -- 6) Korlátlanra állítás (NULL) engedett; a hátralévő lista nem tartalmazza a napot.
  perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
    jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true, 'smallSizeLimit', null, 'largeSizeLimit', null))));
  if exists (select 1 from public.get_pickup_day_size_availability() where pickup_day_id = v_day) then
    raise exception 'FAIL 6: a korlátlan nap szerepel a méretkeret-listában.';
  end if;

  -- 7) Korlátlanról újra korlátozás: a rendelt mennyiség alá nem lehet.
  v_failed := false;
  begin
    perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true, 'smallSizeLimit', 2, 'largeSizeLimit', null))));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 7: korlátlanról a rendelt mennyiség alatti limit beállítható volt.';
  end if;

  -- 8) Ha a kulcs hiányzik a kérésből, a limit változatlan marad.
  perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
    jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true, 'smallSizeLimit', 5))));
  if (select small_size_limit from public.pickup_days where id = v_day) is distinct from 5
     or (select large_size_limit from public.pickup_days where id = v_day) is not null then
    raise exception 'FAIL 8: a hiányzó largeSizeLimit kulcs módosította a nagyobb limitet, vagy a kisebb nem mentődött.';
  end if;

  -- 9) A leadott rendelések végig változatlanok.
  select coalesce(sum(oi.quantity) filter (where oi.size_preference = v_small_label), 0),
         coalesce(sum(oi.quantity) filter (where oi.size_preference = v_large_label), 0)
    into v_small, v_large
    from public.orders o
    join public.order_items oi on oi.order_version_id = o.current_version_id
    where o.pickup_day_id = v_day and o.status = 'submitted';
  if v_small <> 3 or v_large <> 4 then
    raise exception 'FAIL 9: a leadott rendelések mennyisége megváltozott (kicsi: %, nagy: %).', v_small, v_large;
  end if;

  raise notice 'ALL SIZE LIMIT CHANGE TESTS PASSED';
end
$test$;

ROLLBACK;
