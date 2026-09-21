-- Ellenőrző SQL script a 20260922000000_size_preference_limit_counts.sql
-- migrációhoz: közvetlenül a `public.orders`-en beállított
-- trg_enforce_size_preference_limit triggert és a
-- `public.get_size_preference_locks()` RPC-t teszteli, valós adatokkal.
--
-- FONTOS - miért van erre külön script, és mit NEM garantál:
-- Ebben a projektben nincs verziózva a `public.orders`, `public.profiles`,
-- `public.season_parameters`, `public.pickup_days` táblák TELJES DDL-je
-- (a bázissémát még a migrációk bevezetése előtt hozták létre élesben,
-- lásd 20260921000000_baseline_finalize_order.sql fejléce), és nincs helyi
-- Postgres/Docker vagy adatbázis-hozzáférés, amivel ezt a scriptet előre le
-- lehetett volna futtatni és kijavítani. Az itt használt INSERT oszloplisták
-- (season_parameters, pickup_days, orders) szó szerint a repóban lévő,
-- ÉLESBEN MŰKÖDŐ RPC-k (admin_save_season_parameters, finalize_order)
-- forráskódjából származnak, tehát ismerten elégségesek. HA a script egy
-- ismeretlen NOT NULL oszlopon elakad, azt a hibaüzenet pontosan megmondja -
-- egészítsd ki azzal az oszloppal, a lényegi (méretpreferencia-korlátozási)
-- logikát ez nem érinti.
--
-- Teszt-vásárlók: a `auth.users` táblán élő `on_invited_auth_user_created`
-- trigger (lásd sql/registration_invites.sql) MINDEN beszúrásnál lefut és
-- 'registration_invite_required' hibával elutasít minden olyan sort, ahol
-- nincs érvényes meghívó-token a raw_user_meta_data-ban - ezt a scriptet
-- ez a valós meghívásos regisztrációs folyamaton keresztül, nem a trigger
-- megkerülésével elégíti ki (lásd pg_temp.create_test_user lejjebb): előbb
-- létrehoz egy valódi `registration_invites` sort a megfelelő token-hash-sel,
-- majd az `auth.users` insert raw_user_meta_data-jában átadja a plaintext
-- tokent - pontosan úgy, ahogy azt a valódi regisztrációs oldal tenné. A
-- profiles sort emiatt maga a trigger hozza létre (email, first_name,
-- last_name, phone, county, city mezőkkel); a special_size_preference-et
-- (amit a trigger nem állít be) egy külön UPDATE adja hozzá utólag, ahogy
-- azt élesben az admin fiókszerkesztő felület tenné.
--
-- HASZNÁLAT:
--   - Futtasd egy LOCAL vagy STAGING Supabase projekt SQL Editorában, vagy
--     psql-lel a connection stringre kötve, ADMIN/postgres jogosultsággal
--     (tehát NEM a publikus anon/authenticated JWT-vel bejelentkezve) -
--     a script a `request.jwt.claims` GUC közvetlen beállításával szimulálja
--     a különböző bejelentkezett vásárlókat (auth.uid()), ehhez a
--     kapcsolatnak RLS-t megkerülő, teljes tábla-hozzáféréssel kell
--     rendelkeznie.
--   - A script elején BEGIN, a végén ROLLBACK van: semmilyen adat nem marad
--     bent, biztonságos staging adatbázison is kipróbálni.
--   - Csak INSERT útvonalat tesztel (nem UPDATE OF pickup_day_id-t) - a
--     trigger logikája nem tesz különbséget a kettő között, ez elég a
--     szabályok ellenőrzéséhez.
--   - Ha végigfut és a legutolsó sor "ALL SIZE-PREFERENCE LIMIT TESTS
--     PASSED" NOTICE-t írja ki hiba nélkül, a migráció a specifikációnak
--     megfelelően működik. Ha bármelyik lépés nem a várt módon viselkedik,
--     a script RAISE EXCEPTION-nel azonnal megáll és pontosan megmondja,
--     melyik eset hibázott.

BEGIN;

------------------------------------------------------------------
-- Segédfüggvények (csak erre a sessionre, pg_temp - a tranzakcióval együtt
-- automatikusan eltűnnek).
------------------------------------------------------------------

-- Beállítja auth.uid()-t p_user-re, majd megpróbál beszúrni egy
-- 'submitted' rendelést a megadott napra. p_expect_success szerint
-- ellenőrzi, hogy a trigger elfogadta vagy elutasította-e - ha nem az
-- elvárt történt, RAISE EXCEPTION-nel jelez.
CREATE FUNCTION pg_temp.try_insert_order(
  p_label text,
  p_user uuid,
  p_season bigint,
  p_pickup_day bigint,
  p_expect_success boolean
) RETURNS void LANGUAGE plpgsql AS $fn$
declare
  v_failed boolean := false;
  v_errmsg text;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text)::text,
    true
  );

  begin
    insert into public.orders (user_id, season_parameter_id, pickup_day_id, public_order_number, status)
    values (p_user, p_season, p_pickup_day, public.generate_order_number(), 'submitted');
  exception when others then
    v_failed := true;
    v_errmsg := sqlerrm;
  end;

  if p_expect_success and v_failed then
    raise exception 'TEST FAILED [%]: SIKERT vártunk, de kivétel jött: %', p_label, v_errmsg;
  elsif (not p_expect_success) and (not v_failed) then
    raise exception 'TEST FAILED [%]: ELUTASÍTÁST vártunk, de a beszúrás sikerült', p_label;
  else
    raise notice 'OK [%]', p_label;
  end if;
end;
$fn$;

-- Beállítja auth.uid()-t p_viewer-re, meghívja get_size_preference_locks()-ot,
-- és ellenőrzi, hogy a megadott (pickup_day, preference) pár szerepel-e a
-- találati listában, a p_expected_locked elvárással összevetve.
CREATE FUNCTION pg_temp.assert_lock(
  p_label text,
  p_viewer uuid,
  p_pickup_day bigint,
  p_preference text,
  p_expected_locked boolean
) RETURNS void LANGUAGE plpgsql AS $fn$
declare
  v_found boolean;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_viewer::text)::text,
    true
  );

  select exists(
    select 1 from public.get_size_preference_locks() l
    where l.pickup_day_id = p_pickup_day and l.preference = p_preference
  ) into v_found;

  if v_found is distinct from p_expected_locked then
    raise exception 'TEST FAILED [%]: azt vártuk, hogy locked=%, de locked=% jött', p_label, p_expected_locked, v_found;
  else
    raise notice 'OK [%]', p_label;
  end if;
end;
$fn$;

-- Létrehoz egy teszt-vásárlót a VALÓS meghívásos regisztrációs folyamaton
-- keresztül: előbb egy registration_invites sort (a token plaintext
-- változatával), majd az auth.users beszúrást a megfelelő
-- raw_user_meta_data-val, hogy az on_invited_auth_user_created trigger
-- (sql/registration_invites.sql) elfogadja és létrehozza a profiles sort.
-- Ugyanazt a mintát követi, mint sql/registration_invites.sql
-- create_registration_invite()/handle_invited_user_registration() párja.
CREATE FUNCTION pg_temp.create_test_user(
  p_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text
) RETURNS void LANGUAGE plpgsql AS $fn$
declare
  v_email text := 'size-pref-test-' || p_id || '@example.invalid';
  v_token text := 'test-invite-token-' || p_id::text;
begin
  insert into public.registration_invites (email, token_hash)
  values (v_email, extensions.digest(v_token, 'sha256'));

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    v_email, 'not-a-real-password',
    now(), now(), now(), '{}'::jsonb,
    jsonb_build_object(
      'registration_invite_token', v_token,
      'privacy_policy_accepted', true,
      'first_name', p_first_name,
      'last_name', p_last_name,
      'phone', p_phone,
      'county', 'Teszt megye',
      'city', 'Tesztváros'
    )
  );
end;
$fn$;

------------------------------------------------------------------
-- Fixture-ök: 1 teszt-szezon, 6 átvételi nap (5 normál nap - ebből 2 a
-- szezon első/utolsó, "edge" napja - plusz 1 DUNAVECSE technikai nap),
-- 9 teszt-vásárló (auth.users + profiles, a valós meghívásos folyamaton
-- keresztül).
------------------------------------------------------------------

DO $$
declare
  v_season_id bigint;

  v_day_first bigint;      -- szezon első NORMÁL napja (edge, 'larger'-nek tiltott)
  v_day_last bigint;       -- szezon utolsó NORMÁL napja (edge, 'larger'-nek tiltott)
  v_day_larger_cap bigint; -- köztes normál nap: itt teszteljük a 'larger' napi 1 fős keretét
  v_day_larger_free bigint;-- köztes normál nap, amit senki nem foglal le: kontroll (sosem tiltott)
  v_day_smaller bigint;    -- köztes normál nap: itt teszteljük a 'smaller' 1 fősről 2 fősre emelt keretét
  v_day_dunavecse bigint;  -- DUNAVECSE technikai nap: mindkét preferenciánál teljes kivétel

  v_larger_a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_larger_b uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_larger_viewer uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  v_smaller_a uuid := 'aaaaaaaa-0000-4000-8000-000000000004';
  v_smaller_b uuid := 'aaaaaaaa-0000-4000-8000-000000000005';
  v_smaller_c uuid := 'aaaaaaaa-0000-4000-8000-000000000006';
  v_smaller_viewer uuid := 'aaaaaaaa-0000-4000-8000-000000000007';
  v_normal_pref uuid := 'aaaaaaaa-0000-4000-8000-000000000008';
  v_admin uuid := 'aaaaaaaa-0000-4000-8000-000000000009';
begin
  ------------------------------------------------------------------
  -- Teszt-vásárlók a valós meghívásos regisztrációs folyamaton keresztül
  -- (lásd a fájl elején lévő megjegyzést és pg_temp.create_test_user-t) -
  -- ez hozza létre az auth.users ÉS a profiles sorokat is (utóbbit az
  -- on_invited_auth_user_created trigger).
  ------------------------------------------------------------------
  perform pg_temp.create_test_user(v_larger_a, 'Teszt', 'LargerA', '+36301111101');
  perform pg_temp.create_test_user(v_larger_b, 'Teszt', 'LargerB', '+36301111102');
  perform pg_temp.create_test_user(v_larger_viewer, 'Teszt', 'LargerViewer', '+36301111103');
  perform pg_temp.create_test_user(v_smaller_a, 'Teszt', 'SmallerA', '+36301111104');
  perform pg_temp.create_test_user(v_smaller_b, 'Teszt', 'SmallerB', '+36301111105');
  perform pg_temp.create_test_user(v_smaller_c, 'Teszt', 'SmallerC', '+36301111106');
  perform pg_temp.create_test_user(v_smaller_viewer, 'Teszt', 'SmallerViewer', '+36301111107');
  perform pg_temp.create_test_user(v_normal_pref, 'Teszt', 'Normal', '+36301111108');
  perform pg_temp.create_test_user(v_admin, 'Teszt', 'Admin', '+36301111109');

  -- A special_size_preference-et a regisztrációs trigger nem állítja be
  -- (nincs benne a handle_invited_user_registration() insert
  -- oszloplistájában, lásd sql/registration_invites.sql) - ezt itt, a
  -- valós regisztráció UTÁN adjuk hozzá, ahogy azt élesben az admin
  -- fiókszerkesztő felület (update_admin_account_profile) tenné.
  update public.profiles set special_size_preference = 'larger'
    where id in (v_larger_a, v_larger_b, v_larger_viewer);
  update public.profiles set special_size_preference = 'smaller'
    where id in (v_smaller_a, v_smaller_b, v_smaller_c, v_smaller_viewer);

  insert into public.user_roles (user_id, role)
  values (v_admin, 'admin');

  ------------------------------------------------------------------
  -- Szezon + átvételi napok - oszloplista szó szerint az
  -- admin_save_season_parameters() (20260918000000) éles INSERT-jéből.
  ------------------------------------------------------------------
  insert into public.season_parameters (
    year, season, weight_min, weight_max, price, is_active,
    time_window_start, time_window_end,
    pickup_time_start, pickup_time_end, local_pickup_time_start
  ) values (
    2999, 'Ősz', 1, 2, 1000, true,
    now() - interval '1 day', now() + interval '30 days',
    '17:00', '18:15', '16:00'
  )
  returning id into v_season_id;

  insert into public.pickup_days (year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
  values (2999, 'Ősz', date '2999-09-01', 100, 100, true, 1, 1, v_season_id, 'normal')
  returning id into v_day_first;

  insert into public.pickup_days (year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
  values (2999, 'Ősz', date '2999-09-08', 100, 100, true, 1, 1, v_season_id, 'normal')
  returning id into v_day_larger_cap;

  insert into public.pickup_days (year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
  values (2999, 'Ősz', date '2999-09-15', 100, 100, true, 1, 1, v_season_id, 'normal')
  returning id into v_day_larger_free;

  insert into public.pickup_days (year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
  values (2999, 'Ősz', date '2999-09-22', 100, 100, true, 1, 1, v_season_id, 'normal')
  returning id into v_day_smaller;

  insert into public.pickup_days (year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
  values (2999, 'Ősz', date '2999-10-06', 100, 100, true, 1, 1, v_season_id, 'normal')
  returning id into v_day_last;

  insert into public.pickup_days (year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
  values (2999, 'Ősz', date '2999-10-06', null, null, true, 1, 1, v_season_id, 'dunavecse')
  returning id into v_day_dunavecse;

  ------------------------------------------------------------------
  -- 1) 'larger': első/utolsó normál nap - VÁLTOZATLAN tiltás.
  ------------------------------------------------------------------
  perform pg_temp.try_insert_order('larger @ első nap -> tiltva', v_larger_a, v_season_id, v_day_first, false);
  perform pg_temp.try_insert_order('larger @ utolsó nap -> tiltva', v_larger_a, v_season_id, v_day_last, false);

  ------------------------------------------------------------------
  -- 2) 'larger': ÚJ napi 1 fős keret egy köztes napon.
  ------------------------------------------------------------------
  perform pg_temp.try_insert_order('larger A @ köztes nap, 1. foglaló -> siker', v_larger_a, v_season_id, v_day_larger_cap, true);
  perform pg_temp.try_insert_order('larger A @ ugyanaz a nap, 2. saját rendelés -> siker (vásárlónkénti, nem rendelésenkénti keret)', v_larger_a, v_season_id, v_day_larger_cap, true);
  perform pg_temp.try_insert_order('larger B @ ugyanaz a nap -> tiltva (a napi 1 fős keret már betelt)', v_larger_b, v_season_id, v_day_larger_cap, false);

  ------------------------------------------------------------------
  -- 3) 'larger': DUNAVECSE nap - teljes kivétel, a napi keret és az
  --    első/utolsó napi tiltás sem érvényes rá, TÖBB különböző vásárló is
  --    rendelhet ugyanarra a napra.
  ------------------------------------------------------------------
  perform pg_temp.try_insert_order('larger A @ DUNAVECSE -> siker (kivétel)', v_larger_a, v_season_id, v_day_dunavecse, true);
  perform pg_temp.try_insert_order('larger B @ DUNAVECSE, 2. különböző larger vásárló -> siker (nincs napi keret DUNAVECSE-n)', v_larger_b, v_season_id, v_day_dunavecse, true);

  ------------------------------------------------------------------
  -- 4) 'smaller': napi keret 1-ről 2 különböző vásárlóra emelve.
  ------------------------------------------------------------------
  perform pg_temp.try_insert_order('smaller A @ köztes nap, 1. foglaló -> siker', v_smaller_a, v_season_id, v_day_smaller, true);
  perform pg_temp.assert_lock('nap NEM zárolt smaller-nek, amíg csak 1 másik vásárló van rajta (keret: 2)', v_smaller_viewer, v_day_smaller, 'smaller', false);

  perform pg_temp.try_insert_order('smaller B @ ugyanaz a nap, 2. különböző vásárló -> siker (1 < 2-es keret)', v_smaller_b, v_season_id, v_day_smaller, true);
  perform pg_temp.try_insert_order('smaller A @ ugyanaz a nap, saját 2. rendelés -> siker (vásárlónkénti, nem rendelésenkénti keret)', v_smaller_a, v_season_id, v_day_smaller, true);
  perform pg_temp.try_insert_order('smaller C @ ugyanaz a nap, 3. különböző vásárló -> tiltva (2-es keret betelt)', v_smaller_c, v_season_id, v_day_smaller, false);

  ------------------------------------------------------------------
  -- 5) 'smaller' rendelés a DUNAVECSE napon: szintén teljes kivétel.
  ------------------------------------------------------------------
  perform pg_temp.try_insert_order('smaller C @ DUNAVECSE -> siker (kivétel, a köztes napon elutasított vásárló itt szabadon rendelhet)', v_smaller_c, v_season_id, v_day_dunavecse, true);

  ------------------------------------------------------------------
  -- 6) Nincs méretpreferencia beállítva -> semmilyen korlátozás, MÉG az
  --    első/utolsó napra sem vonatkozik.
  ------------------------------------------------------------------
  perform pg_temp.try_insert_order('preferencia nélküli vásárló @ első nap -> siker (nincs rá szabály)', v_normal_pref, v_season_id, v_day_first, true);

  ------------------------------------------------------------------
  -- 7) Admin bypass - változatlan.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  update public.profiles set special_size_preference = 'larger' where id = v_admin;
  perform pg_temp.try_insert_order('admin @ első nap -> siker (admin bypass)', v_admin, v_season_id, v_day_first, true);
  update public.profiles set special_size_preference = null where id = v_admin;

  ------------------------------------------------------------------
  -- 8) get_size_preference_locks() konzisztencia-ellenőrzés a fenti
  --    végállapotra: pontosan azok a napok szerepeljenek, amiket a fenti
  --    beszúrási próbák szerint zárolni kellene.
  ------------------------------------------------------------------
  perform pg_temp.assert_lock('locks: első nap zárolt larger-nek (edge)', v_larger_viewer, v_day_first, 'larger', true);
  perform pg_temp.assert_lock('locks: utolsó nap zárolt larger-nek (edge)', v_larger_viewer, v_day_last, 'larger', true);
  perform pg_temp.assert_lock('locks: larger-cap nap zárolt larger-nek (1 fős keret betelt)', v_larger_viewer, v_day_larger_cap, 'larger', true);
  perform pg_temp.assert_lock('locks: érintetlen köztes nap NEM zárolt larger-nek', v_larger_viewer, v_day_larger_free, 'larger', false);
  perform pg_temp.assert_lock('locks: DUNAVECSE nap sosem jelenik meg larger zárolásként', v_larger_viewer, v_day_dunavecse, 'larger', false);

  perform pg_temp.assert_lock('locks: smaller nap zárolt smaller-nek (2 fős keret betelt)', v_smaller_viewer, v_day_smaller, 'smaller', true);
  perform pg_temp.assert_lock('locks: érintetlen köztes nap NEM zárolt smaller-nek', v_smaller_viewer, v_day_larger_free, 'smaller', false);
  perform pg_temp.assert_lock('locks: első nap NEM zárolt smaller-nek (a smaller szabály nem edge-alapú)', v_smaller_viewer, v_day_first, 'smaller', false);
  perform pg_temp.assert_lock('locks: DUNAVECSE nap sosem jelenik meg smaller zárolásként', v_smaller_viewer, v_day_dunavecse, 'smaller', false);

  raise notice 'ALL SIZE-PREFERENCE LIMIT TESTS PASSED';
end;
$$;

ROLLBACK;
