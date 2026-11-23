-- Ellenőrző script a 20261123010000_season_note_and_product_prices_save.sql
-- migrációhoz: a szezon megjegyzése és a termékárak mentése.
--
-- HASZNÁLAT: Supabase SQL Editorban (postgres jogosultsággal) futtatható.
-- BEGIN ... ROLLBACK: semmi nem marad bent. Kell hozzá egy meglévő admin
-- felhasználó (user_roles.role = 'admin') és legalább 3 termék (products).
-- Siker esetén az utolsó NOTICE: "ALL SEASON NOTE / PRICES TESTS PASSED".
BEGIN;

DO $test$
declare
  v_admin uuid;
  v_season_id bigint;
  v_payload jsonb;
  v_p1 bigint; v_p2 bigint; v_p3 bigint;
  v_failed boolean;
begin
  select user_id into v_admin from public.user_roles where role = 'admin' limit 1;
  select min(id), (array_agg(id order by id))[2], (array_agg(id order by id))[3] into v_p1, v_p2, v_p3 from public.products;
  if v_admin is null or v_p3 is null then
    raise exception 'TEST SETUP: kell egy admin felhasználó és legalább 3 termék.';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_payload := jsonb_build_object(
    'year', 2099, 'type', 'Ősz', 'price', 1000, 'weightMin', 2, 'weightMax', 3,
    'orderStart', '2099-01-01', 'orderEnd', '2099-02-01',
    'pickupTimeStart', '09:00', 'pickupTimeEnd', '17:00', 'localPickupTimeStart', '08:00',
    'active', false, 'note', '  Őszi kiadás, teszt  ',
    'prices', jsonb_build_array(
      jsonb_build_object('productId', v_p1, 'price', 1000),
      jsonb_build_object('productId', v_p2, 'price', 1200),
      jsonb_build_object('productId', v_p3, 'price', 1500)),
    'pickupDays', jsonb_build_array(jsonb_build_object('date', '2099-03-01', 'limit', 10, 'active', false)));

  -- 1) Létrehozás: a megjegyzés trimmelve, az árak mentve
  perform public.admin_save_season_parameters(v_payload);
  select id into v_season_id from public.season_parameters where year = 2099 and season = 'Ősz';
  if (select note from public.season_parameters where id = v_season_id) is distinct from 'Őszi kiadás, teszt' then
    raise exception 'FAIL 1a: a megjegyzés mentése/trimmelése hibás.';
  end if;
  if (select count(*) from public.season_product_prices where season_parameter_id = v_season_id) <> 3
     or (select price from public.season_product_prices where season_parameter_id = v_season_id and product_id = v_p2) <> 1200 then
    raise exception 'FAIL 1b: a termékárak mentése hibás.';
  end if;
  v_payload := v_payload || jsonb_build_object('id', v_season_id);

  -- 2) Módosítás: ár felülírása (upsert), nem beküldött termék ára marad
  perform public.admin_save_season_parameters(jsonb_set(v_payload, '{prices}',
    jsonb_build_array(jsonb_build_object('productId', v_p2, 'price', 1300))));
  if (select price from public.season_product_prices where season_parameter_id = v_season_id and product_id = v_p2) <> 1300
     or (select price from public.season_product_prices where season_parameter_id = v_season_id and product_id = v_p1) <> 1000 then
    raise exception 'FAIL 2: az árak módosítása hibás.';
  end if;

  -- 3) A kulcsok hiánya nem érinti a megjegyzést és az árakat
  perform public.admin_save_season_parameters((v_payload - 'note') - 'prices');
  if (select note from public.season_parameters where id = v_season_id) is distinct from 'Őszi kiadás, teszt'
     or (select price from public.season_product_prices where season_parameter_id = v_season_id and product_id = v_p2) <> 1300 then
    raise exception 'FAIL 3: a hiányzó note/prices kulcs módosította az adatot.';
  end if;

  -- 4) Üres megjegyzés törli (NULL)
  perform public.admin_save_season_parameters(v_payload || jsonb_build_object('note', '   '));
  if (select note from public.season_parameters where id = v_season_id) is not null then
    raise exception 'FAIL 4: az üres megjegyzés nem törölte a megjegyzést.';
  end if;

  -- 5) Érvénytelen bemenetek hibát adnak
  v_failed := false;
  begin
    perform public.admin_save_season_parameters(v_payload || jsonb_build_object('note', repeat('x', 101)));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 5a: a 101 karakteres megjegyzés elfogadva.'; end if;

  v_failed := false;
  begin
    perform public.admin_save_season_parameters(jsonb_set(v_payload, '{prices}',
      jsonb_build_array(jsonb_build_object('productId', v_p1, 'price', -5))));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 5b: a negatív ár elfogadva.'; end if;

  v_failed := false;
  begin
    perform public.admin_save_season_parameters(jsonb_set(v_payload, '{prices}',
      jsonb_build_array(jsonb_build_object('productId', 999999, 'price', 100))));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 5c: a nem létező termék ára elfogadva.'; end if;

  v_failed := false;
  begin
    perform public.admin_save_season_parameters(jsonb_set(v_payload, '{prices}',
      jsonb_build_array(jsonb_build_object('productId', v_p1, 'price', 100), jsonb_build_object('productId', v_p1, 'price', 200))));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 5d: az ismétlődő termék elfogadva.'; end if;

  -- 6) A hibás mentések nem módosítottak semmit
  if (select price from public.season_product_prices where season_parameter_id = v_season_id and product_id = v_p1) <> 1000 then
    raise exception 'FAIL 6: egy elutasított mentés mégis módosította az árat.';
  end if;

  raise notice 'ALL SEASON NOTE / PRICES TESTS PASSED';
end
$test$;

ROLLBACK;
