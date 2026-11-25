-- Ellenőrző script a 20261126000000_soft_delete_day_orders.sql migrációhoz: a
-- törölt (archivált) átvételi nap rendelései is törlődnek (soft delete) a
-- vásárlók értesítése nélkül, a vásárlók előzményeiből eltűnnek, nem
-- számítanak a statisztikába és a méretkeretbe, és a nap vagy a szezon
-- visszaállításakor automatikusan visszakerülnek. Az inaktív nap rendelései
-- változatlanok.
--
-- HASZNÁLAT: Supabase SQL Editorban (postgres jogosultsággal) futtatható.
-- BEGIN ... ROLLBACK: semmi nem marad bent. Kell hozzá egy meglévő admin
-- felhasználó, két meglévő NEM admin profil, legalább egy termék és csomag. A
-- 2099-es "Ősz" tesztszezont hozza létre. Hiba nélküli lefutás = siker; hiba
-- esetén a RAISE EXCEPTION megmondja, melyik eset hibázott.
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

-- Hány rendelést lát a vásárló (RLS-sel, "authenticated" szerepkörben)
create function pg_temp.visible_orders(p_user uuid, p_ids bigint[])
returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.orders where id = any(p_ids);
  perform set_config('role', 'postgres', true);
  return v_count;
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
  v_o1 bigint;   -- 1. nap, A vásárló
  v_o2 bigint;   -- 2. nap, A vásárló (kisebb méret, 2 db)
  v_o3 bigint;   -- 2. nap, B vásárló (lemondott)
  v_payload jsonb;
  v_count integer;
  v_failed boolean;
  v_small integer;
  v_small_label text := 'Átlagostól kisebb méret';
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

  -- Szezon két aktív nappal; a 2. napon kisebb méret limit 5.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_payload := jsonb_build_object(
    'year', 2099, 'type', 'Ősz', 'price', 1000, 'weightMin', 2, 'weightMax', 3,
    'orderStart', '2099-01-01', 'orderEnd', '2099-02-01',
    'pickupTimeStart', '09:00', 'pickupTimeEnd', '17:00', 'localPickupTimeStart', '08:00',
    'active', false,
    'pickupDays', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true),
      jsonb_build_object('date', '2099-03-08', 'limit', 1000, 'active', true, 'smallSizeLimit', 5)));
  perform public.admin_save_season_parameters(v_payload);
  select id into v_season_id from public.season_parameters where year = 2099 and season = 'Ősz';
  select id into v_day1 from public.pickup_days where season_parameter_id = v_season_id and pickup_date = '2099-03-01' and kind = 'normal';
  select id into v_day2 from public.pickup_days where season_parameter_id = v_season_id and pickup_date = '2099-03-08' and kind = 'normal';
  v_payload := v_payload || jsonb_build_object('id', v_season_id);

  v_o1 := pg_temp.make_order(v_a, v_season_id, v_day1, 'Átlagos méret', 3);
  v_o2 := pg_temp.make_order(v_a, v_season_id, v_day2, v_small_label, 2);
  v_o3 := pg_temp.make_order(v_b, v_season_id, v_day2, v_small_label, 1);
  update public.orders set status = 'cancelled' where id = v_o3;   -- a lemondott rendelés is a naphoz tartozik

  -- 1) A nap törlése élő rendelés mellett megerősítést kér
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true))));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 1: a nap törlése élő rendelés mellett megerősítés nélkül sikerült.';
  end if;
  if exists (select 1 from public.orders where id in (v_o1, v_o2, v_o3) and archived_at is not null) then
    raise exception 'FAIL 1b: a megerősítés nélküli törlés mégis archiválta a rendeléseket.';
  end if;

  -- 2) Megerősítéssel a nap és MINDEN rendelése (a lemondott is) törlődik; a másik nap rendelése nem
  perform public.admin_save_season_parameters(
    jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true)))
    || jsonb_build_object('confirmLiveOrders', true));
  if (select archived_at from public.pickup_days where id = v_day2) is null then
    raise exception 'FAIL 2a: a nap nem archiválódott.';
  end if;
  if (select count(*) from public.orders where id in (v_o2, v_o3) and archived_at = (select archived_at from public.pickup_days where id = v_day2)) <> 2 then
    raise exception 'FAIL 2b: a nap rendelései (a lemondott is) nem archiválódtak a nap időbélyegével.';
  end if;
  if (select archived_at from public.orders where id = v_o1) is not null then
    raise exception 'FAIL 2c: a másik nap rendelése is archiválódott.';
  end if;
  if (select status from public.orders where id = v_o3) <> 'cancelled' or (select status from public.orders where id = v_o2) <> 'submitted' then
    raise exception 'FAIL 2d: az archiválás megváltoztatta a rendelések állapotát.';
  end if;

  -- 3) A vásárló nem látja a törölt nap rendelését, a másikat igen
  if pg_temp.visible_orders(v_a, array[v_o1, v_o2]) <> 1 then
    raise exception 'FAIL 3a: A vásárló nem pontosan 1 rendelést lát (a törölt nap rendelése eltűnhetett volna).';
  end if;
  if pg_temp.visible_orders(v_b, array[v_o3]) <> 0 then
    raise exception 'FAIL 3b: B vásárló látja a törölt nap lemondott rendelését.';
  end if;

  -- 4) A statisztika: nincs élő rendelés, a törölt rendelések száma látszik
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select live_order_count, archived_order_count into v_count, v_small
    from public.pickup_day_order_stats where pickup_day_id = v_day2;
  if v_count <> 0 or v_small <> 2 then
    raise exception 'FAIL 4: a törölt nap statisztikája hibás (élő: %, törölt: %).', v_count, v_small;
  end if;

  -- 5) A törölt rendelés nem módosítható / nem mondható le a vásárló által
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform public.cancel_order(v_o2);
  exception when others then v_failed := (sqlerrm like '%nem létezik%');
  end;
  if not v_failed then
    raise exception 'FAIL 5: a törölt nap rendelése lemondható volt, vagy más hibát kaptunk.';
  end if;

  -- 6) A nap visszaállítása a rendeléseket is visszahozza (a lemondott marad lemondott)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_restore_pickup_day(v_day2);
  if exists (select 1 from public.orders where id in (v_o1, v_o2, v_o3) and archived_at is not null) then
    raise exception 'FAIL 6a: a nap visszaállítása után maradt archivált rendelés.';
  end if;
  if (select status from public.orders where id = v_o3) <> 'cancelled' then
    raise exception 'FAIL 6b: a lemondott rendelés állapota megváltozott a visszaállításkor.';
  end if;
  if pg_temp.visible_orders(v_a, array[v_o1, v_o2]) <> 2 then
    raise exception 'FAIL 6c: A vásárló nem látja újra mindkét rendelését.';
  end if;

  -- 7) Az inaktív nap rendelései változatlanok (nem archiválódnak)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
    jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true),
    jsonb_build_object('date', '2099-03-08', 'limit', 1000, 'active', false, 'smallSizeLimit', 5))));
  if exists (select 1 from public.orders where id in (v_o1, v_o2, v_o3) and archived_at is not null) then
    raise exception 'FAIL 7: az inaktívvá tett nap rendelései archiválódtak.';
  end if;

  -- 8) A nap törlése a mentő függvényből, majd visszaállítása újra felvétellel (ugyanaz a dátum)
  perform public.admin_save_season_parameters(
    jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true)))
    || jsonb_build_object('confirmLiveOrders', true));
  if (select archived_at from public.orders where id = v_o2) is null then
    raise exception 'FAIL 8a: a nap újbóli törlése nem archiválta a rendelést.';
  end if;
  perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(
    jsonb_build_object('date', '2099-03-01', 'limit', 1000, 'active', true),
    jsonb_build_object('date', '2099-03-08', 'limit', 1000, 'active', false, 'smallSizeLimit', 5))));
  if (select archived_at from public.orders where id = v_o2) is not null then
    raise exception 'FAIL 8b: a nap újrafelvétele (visszaállítása) nem hozta vissza a rendelését.';
  end if;

  -- 9) A szezon törlése a napjainak rendeléseit is törli, a visszaállítása visszahozza
  perform public.admin_delete_season_parameters(v_season_id, true);
  if (select count(*) from public.orders where id in (v_o1, v_o2, v_o3) and archived_at is not null) <> 3 then
    raise exception 'FAIL 9a: a szezon törlése nem archiválta mindhárom rendelést.';
  end if;
  perform public.admin_restore_season_parameters(v_season_id);
  if exists (select 1 from public.orders where id in (v_o1, v_o2, v_o3) and archived_at is not null) then
    raise exception 'FAIL 9b: a szezon visszaállítása nem hozta vissza a rendeléseket.';
  end if;

  raise notice 'ALL SOFT DELETE DAY ORDERS TESTS PASSED';
end
$test$;

ROLLBACK;
