-- Ellenőrző script a 20261122000000_soft_delete_functions.sql migrációhoz:
-- a szezon/nap archiválását (soft delete), a megerősítés-kényszert élő
-- rendelésnél és a visszaállítást teszteli.
--
-- HASZNÁLAT: Supabase SQL Editorban (postgres jogosultsággal) futtatható.
-- A script elején BEGIN, a végén ROLLBACK van: semmilyen adat nem marad
-- bent. Egy meglévő admin felhasználó (user_roles.role = 'admin') és egy
-- meglévő profil kell hozzá; a teszt a 2099-es "Ősz" szezont hozza létre,
-- ez a rollback miatt eltűnik. Siker esetén az utolsó NOTICE:
-- "ALL SOFT DELETE TESTS PASSED". Hiba esetén RAISE EXCEPTION mondja meg,
-- melyik eset hibázott.
BEGIN;

DO $test$
declare
  v_admin uuid;
  v_customer uuid;
  v_season_id bigint;
  v_day1 bigint;
  v_day2 bigint;
  v_dunavecse bigint;
  v_order_id bigint;
  v_hint text;
  v_ts1 timestamptz;
  v_ts2 timestamptz;
  v_payload jsonb;
begin
  select user_id into v_admin from public.user_roles where role = 'admin' limit 1;
  select id into v_customer from public.profiles limit 1;
  if v_admin is null or v_customer is null then
    raise exception 'TEST SETUP: nincs admin felhasználó vagy profil.';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_payload := jsonb_build_object(
    'year', 2099, 'type', 'Ősz', 'price', 1000, 'weightMin', 2, 'weightMax', 3,
    'orderStart', '2099-01-01', 'orderEnd', '2099-02-01',
    'pickupTimeStart', '09:00', 'pickupTimeEnd', '17:00', 'localPickupTimeStart', '08:00',
    'active', false,
    'pickupDays', jsonb_build_array(
      jsonb_build_object('date', '2099-03-01', 'limit', 10, 'active', false, 'smallSizeLimit', 4, 'largeSizeLimit', 6),
      jsonb_build_object('date', '2099-03-08', 'limit', 10, 'active', false)));

  -- 1) Létrehozás
  perform public.admin_save_season_parameters(v_payload);
  select id into v_season_id from public.season_parameters where year = 2099 and season = 'Ősz';
  select id into v_day1 from public.pickup_days where season_parameter_id = v_season_id and pickup_date = '2099-03-01' and kind = 'normal';
  select id into v_day2 from public.pickup_days where season_parameter_id = v_season_id and pickup_date = '2099-03-08' and kind = 'normal';
  select id into v_dunavecse from public.pickup_days where season_parameter_id = v_season_id and kind = 'dunavecse';
  if v_day1 is null or v_day2 is null or v_dunavecse is null then
    raise exception 'FAIL 1: a szezon vagy a napjai nem jöttek létre.';
  end if;
  -- A további mentések már a létrejött szezont módosítják (id nélkül új szezon jönne létre).
  v_payload := v_payload || jsonb_build_object('id', v_season_id);
  if (select small_size_limit from public.pickup_days where id = v_day1) is distinct from 4
     or (select large_size_limit from public.pickup_days where id = v_day1) is distinct from 6
     or (select small_size_limit from public.pickup_days where id = v_day2) is not null then
    raise exception 'FAIL 1b: a napi méret limitek mentése hibás.';
  end if;

  -- Élő rendelés az 1. napon
  insert into public.orders (user_id, season_parameter_id, pickup_day_id, public_order_number)
  values (v_customer, v_season_id, v_day1, public.generate_order_number())
  returning id into v_order_id;

  -- 2) Élő rendelésű nap kivétele megerősítés nélkül -> hiba
  v_hint := null;
  begin
    perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(v_payload->'pickupDays'->1)));
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'LIVE_ORDERS_CONFIRMATION_REQUIRED' then
    raise exception 'FAIL 2: élő rendelésű nap törlése megerősítés nélkül nem hibázott (hint: %).', v_hint;
  end if;

  -- 3) Megerősítéssel archiválódik, a rendelés érintetlen
  perform public.admin_save_season_parameters(
    jsonb_set(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(v_payload->'pickupDays'->1)), '{confirmLiveOrders}', 'true'));
  if (select archived_at from public.pickup_days where id = v_day1) is null then
    raise exception 'FAIL 3: a nap nem archiválódott.';
  end if;
  if not exists (select 1 from public.orders where id = v_order_id and status = 'submitted' and pickup_day_id = v_day1) then
    raise exception 'FAIL 3b: a rendelés módosult az archiváláskor.';
  end if;

  -- 4) Ugyanarra a dátumra újrafelvéve a RÉGI sor áll vissza
  perform public.admin_save_season_parameters(v_payload);
  if (select archived_at from public.pickup_days where id = v_day1) is not null
     or (select count(*) from public.pickup_days where season_parameter_id = v_season_id and pickup_date = '2099-03-01' and kind = 'normal') <> 1 then
    raise exception 'FAIL 4: az újrafelvett nap nem a régi sor.';
  end if;

  -- 5) Nap egyedi törlése és visszaállítása (rendelés nélküli 2. nap)
  perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(v_payload->'pickupDays'->0)));
  if (select archived_at from public.pickup_days where id = v_day2) is null then
    raise exception 'FAIL 5: a 2. nap nem archiválódott.';
  end if;
  select archived_at into v_ts2 from public.pickup_days where id = v_day2;
  perform public.admin_restore_pickup_day(v_day2);
  if (select archived_at from public.pickup_days where id = v_day2) is not null
     or (select is_active from public.pickup_days where id = v_day2) is not false then
    raise exception 'FAIL 5b: a nap visszaállítása hibás (inaktívnak kellene lennie).';
  end if;
  -- Újra külön archiváljuk a 2. napot, hogy a szezon-visszaállítás ne hozza vissza.
  perform public.admin_save_season_parameters(jsonb_set(v_payload, '{pickupDays}', jsonb_build_array(v_payload->'pickupDays'->0)));
  -- A teszt egyetlen tranzakció, ahol now() végig ugyanaz; élesben a két törlés
  -- külön tranzakció, ezért az időbélyegek eltérnek. Ezt szimuláljuk.
  update public.pickup_days set archived_at = archived_at - interval '1 day' where id = v_day2;

  -- 6) Szezon törlése élő rendeléssel megerősítés nélkül -> hiba
  v_hint := null;
  begin
    perform public.admin_delete_season_parameters(v_season_id);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'LIVE_ORDERS_CONFIRMATION_REQUIRED' then
    raise exception 'FAIL 6: szezontörlés megerősítés nélkül nem hibázott (hint: %).', v_hint;
  end if;

  -- 7) Megerősítéssel: szezon + napok (DUNAVECSE is) archiválódnak, rendelés marad
  perform public.admin_delete_season_parameters(v_season_id, true);
  select archived_at into v_ts1 from public.season_parameters where id = v_season_id;
  if v_ts1 is null
     or (select archived_at from public.pickup_days where id = v_day1) is distinct from v_ts1
     or (select archived_at from public.pickup_days where id = v_dunavecse) is distinct from v_ts1 then
    raise exception 'FAIL 7: a szezon és a napjai nem ugyanazzal az időbélyeggel archiválódtak.';
  end if;
  if not exists (select 1 from public.orders where id = v_order_id and status = 'submitted') then
    raise exception 'FAIL 7b: a rendelés módosult a szezontörléskor.';
  end if;

  -- 8) Archivált szezon napja nem állítható vissza; mentés sem
  begin
    perform public.admin_restore_pickup_day(v_day1);
    raise exception 'FAIL 8: törölt szezon napja visszaállítható volt.';
  exception when sqlstate '22023' then null;
  end;

  -- 9) Szezon visszaállítása: a vele együtt törölt napok jönnek vissza, inaktívan;
  --    a korábban külön törölt 2. nap archivált marad.
  perform public.admin_restore_season_parameters(v_season_id);
  if (select archived_at from public.season_parameters where id = v_season_id) is not null
     or (select is_active from public.season_parameters where id = v_season_id) is not false
     or (select archived_at from public.pickup_days where id = v_day1) is not null
     or (select archived_at from public.pickup_days where id = v_dunavecse) is not null
     or (select is_active from public.pickup_days where id = v_day1) is not false then
    raise exception 'FAIL 9: a szezon visszaállítása hibás.';
  end if;
  if (select archived_at from public.pickup_days where id = v_day2) is null then
    raise exception 'FAIL 9b: a korábban külön törölt nap visszajött a szezonnal.';
  end if;

  raise notice 'ALL SOFT DELETE TESTS PASSED';
end
$test$;

ROLLBACK;
