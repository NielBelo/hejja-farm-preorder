-- A fióktörlés (20261129000000_account_deletion_anonymization.sql) ellenőrző
-- tesztje. Futtatás: Supabase SQL Editor, a migráció lefuttatása UTÁN.
--
-- BIZTONSÁGOS: a teszt egyetlen DO blokk, amely a végén SZÁNDÉKOSAN hibával áll
-- le, így az adatbázis teljes tartalma visszagörgetődik - semmi nem marad meg
-- (sem a teszt-felhasználók, sem a törlés-naplók). Az eredmény a hibaüzenetben
-- jelenik meg: "✔" = sikeres ellenőrzés, "✘" = hibás. A hibaüzenet "TESZT
-- EREDMÉNY" fejléce jelzi, hogy minden ✔ volt-e.
--
-- Tesztelt tulajdonságok:
--   * aktív jövőbeli rendelés blokkolja a törlést (saját és admin törlésnél is)
--   * törlés után a személyes adatok mindenhol eltűnnek
--   * a rendelések megmaradnak, user_id NULL, a jegyzet kiürül
--   * más felhasználó rendelése és jegyzete érintetlen
--   * deleted_users: csak név + idő + forrás
--   * jogosultságok (nem admin, admin önmagát, superadmin, kliens a belső
--     függvényre)
--   * update_order: az anonim rendelést nem admin nem módosíthatja
--   * deleted_users RLS és a 3 éves purge
DO $test$
declare
  rep text := '';
  fails int := 0;
  ok boolean;
  n int;
  t timestamptz := now();

  v_admin uuid;
  v_super uuid;
  v_season bigint;
  v_day_past bigint;
  v_day_future bigint;
  v_product bigint;
  v_package bigint;

  ua uuid := gen_random_uuid();  -- önállóan töröl, múltbeli + lemondott jövőbeli rendelés
  ub uuid := gen_random_uuid();  -- aktív jövőbeli rendelés, előbb blokkolt
  ud uuid := gen_random_uuid();  -- admin törli, nincs rendelése
  ue uuid := gen_random_uuid();  -- normál, nem törölt felhasználó (kontroll)

  oa1 bigint; oa2 bigint; ob1 bigint; oe1 bigint;
  v_ver bigint;
  v_name text;
  v_src text;
  v_msg text;
begin
  select user_id into v_admin from public.user_roles where role = 'admin' order by is_superadmin limit 1;
  select user_id into v_super from public.user_roles where is_superadmin limit 1;
  if v_admin is null then
    raise exception 'A teszthez legalább egy admin felhasználó kell az adatbázisban.';
  end if;

  -- ===== Teszt-adatok létrehozása (admin jogosultsággal) =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- Felhasználók a valódi regisztrációs triggeren át (meghívó + token).
  insert into public.registration_invites (email, token_hash)
  select lower(e), extensions.digest(tok, 'sha256')
  from (values ('zz-test-a@example.invalid', 'tok-a'), ('zz-test-b@example.invalid', 'tok-b'),
               ('zz-test-d@example.invalid', 'tok-d'), ('zz-test-e@example.invalid', 'tok-e')) as x(e, tok);

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
         jsonb_build_object('registration_invite_token', tok, 'privacy_policy_accepted', true,
                            'first_name', fn, 'last_name', 'Teszt', 'phone', '+36301234567',
                            'county', 'Pest', 'city', 'Budapest')
  from (values (ua, 'zz-test-a@example.invalid', 'tok-a', 'Anna'),
               (ub, 'zz-test-b@example.invalid', 'tok-b', 'Béla'),
               (ud, 'zz-test-d@example.invalid', 'tok-d', 'Dóra'),
               (ue, 'zz-test-e@example.invalid', 'tok-e', 'Elek')) as x(id, email, tok, fn);

  insert into public.season_parameters (year, season) values (2099, 'TESZT') returning id into v_season;
  insert into public.pickup_days (year, season, pickup_date, planned_stock, available_stock, is_active, season_parameter_id, kind)
  values (2099, 'TESZT', (now() at time zone 'Europe/Budapest')::date - 10, 100, 100, true, v_season, 'normal')
  returning id into v_day_past;
  insert into public.pickup_days (year, season, pickup_date, planned_stock, available_stock, is_active, season_parameter_id, kind)
  values (2099, 'TESZT', (now() at time zone 'Europe/Budapest')::date + 10, 100, 100, true, v_season, 'normal')
  returning id into v_day_future;
  insert into public.products (name) values ('TESZT termék') returning id into v_product;
  insert into public.packages (name) values ('TESZT csomag') returning id into v_package;

  insert into public.season_launch_sends (season_parameter_id, user_id, email)
  values (v_season, ua, 'zz-test-a@example.invalid');

  -- Rendelések: (felhasználó, nap, státusz, jegyzet)
  insert into public.orders (user_id, season_parameter_id, pickup_day_id, status, public_order_number)
  values (ua, v_season, v_day_past, 'submitted', 'ZZTEST-A1') returning id into oa1;
  insert into public.orders (user_id, season_parameter_id, pickup_day_id, status, public_order_number, cancelled_at, cancelled_by)
  values (ua, v_season, v_day_future, 'cancelled', 'ZZTEST-A2', now(), ua) returning id into oa2;
  insert into public.orders (user_id, season_parameter_id, pickup_day_id, status, public_order_number)
  values (ub, v_season, v_day_future, 'submitted', 'ZZTEST-B1') returning id into ob1;
  insert into public.orders (user_id, season_parameter_id, pickup_day_id, status, public_order_number)
  values (ue, v_season, v_day_past, 'submitted', 'ZZTEST-E1') returning id into oe1;

  -- Egy verzió + egy tétel minden rendeléshez, személyes jegyzettel.
  for v_ver in select unnest(array[oa1, oa2, ob1, oe1]) loop
    declare vid bigint; begin
      insert into public.order_versions (order_id, version_number, change_type, created_by)
      values (v_ver, 1, 'created', (select user_id from public.orders where id = v_ver)) returning id into vid;
      insert into public.order_items (product_id, package_id, quantity, note, size_preference, order_version_id)
      values (v_product, v_package, 2,
              case when v_ver = oe1 then 'KEEP-ME' else 'SZEMÉLYES JEGYZET ' || v_ver end,
              'Átlagostól kisebb méret', vid);
      update public.orders set current_version_id = vid where id = v_ver;
    end;
  end loop;

  select count(*) into n from public.profiles where id in (ua, ub, ud, ue);
  rep := rep || case when n = 4 then '✔ ' else '✘ ' end || 'előkészítés: 4 teszt-profil létrejött (' || n || E')\n';
  if n <> 4 then fails := fails + 1; end if;

  -- ===== 1. Aktív jövőbeli rendelés blokkolja a törlést =====
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ub::text, true);
  ok := false;
  begin
    perform public.delete_own_account();
  exception when others then
    ok := sqlstate = 'P0001'; v_msg := sqlerrm;
  end;
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'saját törlés blokkolva aktív jövőbeli rendelésnél\n';
  if not ok then fails := fails + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  ok := false;
  begin
    perform public.delete_admin_account(ub);
  exception when others then
    ok := sqlstate = 'P0001';
  end;
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'admin törlés blokkolva aktív jövőbeli rendelésnél\n';
  if not ok then fails := fails + 1; end if;

  select count(*) into n from public.profiles where id = ub;
  ok := n = 1 and not exists (select 1 from public.deleted_users where full_name = 'Teszt Béla');
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'blokkolt törlés nem hagy félkész nyomot (profil megvan, napló üres)\n';
  if not ok then fails := fails + 1; end if;

  -- ===== 2. Saját törlés (A): személyes adatok eltűnnek, rendelések anonimak =====
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  v_msg := null;
  ok := false;
  begin
    ok := public.delete_own_account();
  exception when others then
    v_msg := sqlerrm;
  end;
  rep := rep || case when ok then '✔ ' else '✘ ' end || 'saját törlés lefutott (múltbeli + lemondott jövőbeli rendelés mellett)' || coalesce(' - ' || v_msg, '') || E'\n';
  if not ok then fails := fails + 1; end if;

  ok := not exists (select 1 from auth.users where id = ua)
    and not exists (select 1 from public.profiles where id = ua)
    and not exists (select 1 from public.user_roles where user_id = ua)
    and not exists (select 1 from public.user_consents where user_id = ua)
    and not exists (select 1 from public.season_launch_sends where user_id = ua)
    and not exists (select 1 from public.registration_invites where lower(email) = 'zz-test-a@example.invalid' or used_by_user_id = ua);
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'auth/profil/szerepkör/hozzájárulás/szezonindító-napló/meghívó mind törölve\n';
  if not ok then fails := fails + 1; end if;

  select count(*) into n from public.orders where id in (oa1, oa2) and user_id is null;
  rep := rep || case when n = 2 then '✔ ' else '✘ ' end || 'mindkét rendelés megmaradt, user_id NULL (' || n || E'/2)\n';
  if n <> 2 then fails := fails + 1; end if;

  select count(*) into n from public.orders where id in (oa1, oa2) and cancelled_by is null;
  rep := rep || case when n = 2 then '✔ ' else '✘ ' end || E'cancelled_by sem utal a törölt felhasználóra\n';
  if n <> 2 then fails := fails + 1; end if;

  select count(*) into n from public.order_items oi join public.order_versions ov on ov.id = oi.order_version_id
   where ov.order_id in (oa1, oa2);
  ok := n = 2 and not exists (select 1 from public.order_items oi join public.order_versions ov on ov.id = oi.order_version_id
                              where ov.order_id in (oa1, oa2) and oi.note is not null);
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'rendelési tételek megmaradtak, a jegyzetek kiürültek\n';
  if not ok then fails := fails + 1; end if;

  select count(*) into n from public.order_versions where order_id in (oa1, oa2) and created_by is not null;
  rep := rep || case when n = 0 then '✔ ' else '✘ ' end || E'order_versions.created_by nullázva\n';
  if n <> 0 then fails := fails + 1; end if;

  ok := exists (select 1 from public.order_items oi join public.order_versions ov on ov.id = oi.order_version_id
                where ov.order_id = oe1 and oi.note = 'KEEP-ME')
    and exists (select 1 from public.orders where id = oe1 and user_id = ue);
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'másik felhasználó rendelése és jegyzete érintetlen\n';
  if not ok then fails := fails + 1; end if;

  select full_name, deletion_source into v_name, v_src from public.deleted_users where full_name = 'Teszt Anna';
  ok := v_name = 'Teszt Anna' and v_src = 'self';
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'deleted_users: név ("Teszt Anna") + forrás ("self") rögzítve\n';
  if not ok then fails := fails + 1; end if;

  ok := (select deleted_at from public.deleted_users where full_name = 'Teszt Anna') >= t;
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'deleted_users: törlés ideje rögzítve\n';
  if not ok then fails := fails + 1; end if;

  -- ===== 3. Lemondás után a blokkolt felhasználó törölhető (admin törlés) =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  update public.orders set status = 'cancelled', cancelled_at = now() where id = ob1;
  v_msg := null;
  ok := false;
  begin
    ok := public.delete_admin_account(ub);
  exception when others then
    v_msg := sqlerrm;
  end;
  rep := rep || case when ok then '✔ ' else '✘ ' end || 'lemondás után az admin törölheti (B)' || coalesce(' - ' || v_msg, '') || E'\n';
  if not ok then fails := fails + 1; end if;

  v_msg := null;
  ok := false;
  begin ok := public.delete_admin_account(ud); exception when others then v_msg := sqlerrm; end;
  select deletion_source into v_src from public.deleted_users where full_name = 'Teszt Dóra';
  ok := ok and v_src = 'admin';
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'rendelés nélküli felhasználó admin törlése, forrás = "admin"\n';
  if not ok then fails := fails + 1; end if;

  -- ===== 4. Jogosultságok =====
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ue::text, true);
  ok := false;
  begin perform public.delete_admin_account(gen_random_uuid()); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'nem admin nem hívhatja a delete_admin_account-ot\n';
  if not ok then fails := fails + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  ok := false;
  begin perform public.delete_admin_account(v_admin); exception when others then ok := sqlstate = '22023'; end;
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'admin nem törölheti saját magát az admin függvénnyel\n';
  if not ok then fails := fails + 1; end if;

  ok := false;
  begin perform public.delete_own_account(); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'admin nem törölheti magát a saját-törlés függvénnyel\n';
  if not ok then fails := fails + 1; end if;

  if v_super is not null and v_super <> v_admin then
    ok := false;
    begin perform public.delete_admin_account(v_super); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || case when ok then '✔ ' else '✘ ' end || E'superadmin nem törölhető\n';
    if not ok then fails := fails + 1; end if;
  else
    rep := rep || E'- superadmin-teszt kihagyva (nincs külön superadmin és admin)\n';
  end if;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  ok := false;
  begin perform public.delete_own_account(); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'bejelentkezés nélkül nem törölhető\n';
  if not ok then fails := fails + 1; end if;

  -- A belső függvényt és a purge-ot a kliens (authenticated) nem hívhatja.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.anonymize_and_delete_user(ue, 'admin'); exception when others then ok := sqlstate = '42501'; end;
  reset role;
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'anonymize_and_delete_user kliensből nem hívható\n';
  if not ok then fails := fails + 1; end if;

  set local role authenticated;
  ok := false;
  begin perform public.purge_expired_deleted_users(); exception when others then ok := sqlstate = '42501'; end;
  reset role;
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'purge_expired_deleted_users kliensből nem hívható\n';
  if not ok then fails := fails + 1; end if;

  -- ===== 5. update_order: az anonim rendelést nem admin nem módosíthatja =====
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ue::text, true);
  ok := false;
  begin
    perform public.update_order(oa1, '[{"quantity": 1}]'::jsonb);
  exception when others then
    ok := sqlerrm like 'Nincs jogosultsága%';
    v_msg := sqlerrm;
  end;
  rep := rep || case when ok then '✔ ' else '✘ ' end || 'update_order: anonim rendelést nem admin nem módosíthat' || case when ok then '' else ' (hiba: ' || coalesce(v_msg, 'nem dobott') || ')' end || E'\n';
  if not ok then fails := fails + 1; end if;

  -- ===== 6. deleted_users láthatóság (RLS) =====
  set local role authenticated;
  select count(*) into n from public.deleted_users;
  reset role;
  rep := rep || case when n = 0 then '✔ ' else '✘ ' end || E'nem admin nem látja a törölt felhasználók listáját\n';
  if n <> 0 then fails := fails + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  select count(*) into n from public.deleted_users where full_name in ('Teszt Anna', 'Teszt Béla', 'Teszt Dóra');
  reset role;
  rep := rep || case when n = 3 then '✔ ' else '✘ ' end || 'admin látja a törölt felhasználókat (' || n || E'/3)\n';
  if n <> 3 then fails := fails + 1; end if;

  -- ===== 7. 3 éves megőrzési határ (purge) =====
  insert into public.deleted_users (full_name, deleted_at, deletion_source) values
    ('ZZ Régi Törölt', now() - interval '3 years 1 day', 'self'),
    ('ZZ Friss Törölt', now() - interval '2 years 11 months', 'self');
  perform public.purge_expired_deleted_users();
  ok := not exists (select 1 from public.deleted_users where full_name = 'ZZ Régi Törölt')
    and exists (select 1 from public.deleted_users where full_name = 'ZZ Friss Törölt');
  rep := rep || case when ok then '✔ ' else '✘ ' end || E'purge: 3 évnél régebbi sor törölve, fiatalabb megmarad\n';
  if not ok then fails := fails + 1; end if;

  -- ===== Eredmény + szándékos visszagörgetés =====
  raise exception E'TESZT EREDMÉNY: % (a hiba a szándékos visszagörgetés, az adatbázis nem változott)\n\n%',
    case when fails = 0 then 'MINDEN ELLENŐRZÉS SIKERES' else fails || ' ELLENŐRZÉS HIBÁS' end, rep;
end;
$test$;
