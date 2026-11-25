-- Ellenőrző script a 20261125000000_save_dunavecse_active.sql migrációhoz: a
-- DUNAVECSE technikai nap aktív állapota a szezon mentésével együtt módosul
-- (opcionális "dunavecseActive" kulcs), a normál napokhoz hasonlóan.
--
-- HASZNÁLAT: Supabase SQL Editorban (postgres jogosultsággal) futtatható.
-- BEGIN ... ROLLBACK: semmi nem marad bent. Kell hozzá egy meglévő admin
-- felhasználó (user_roles.role = 'admin'). A 2099-es "Ősz" tesztszezont hozza
-- létre. Hiba nélküli lefutás = siker; hiba esetén a RAISE EXCEPTION megmondja,
-- melyik eset hibázott.
BEGIN;

DO $test$
declare
  v_admin uuid;
  v_season_id bigint;
  v_payload jsonb;
  v_failed boolean;
begin
  select ur.user_id into v_admin from public.user_roles ur
    join auth.users u on u.id = ur.user_id
    where ur.role = 'admin' limit 1;
  if v_admin is null then
    raise exception 'TEST SETUP: kell egy admin felhasználó.';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_payload := jsonb_build_object(
    'year', 2099, 'type', 'Ősz', 'price', 1000, 'weightMin', 2, 'weightMax', 3,
    'orderStart', '2099-01-01', 'orderEnd', '2099-02-01',
    'pickupTimeStart', '09:00', 'pickupTimeEnd', '17:00', 'localPickupTimeStart', '08:00',
    'active', true,
    'pickupDays', jsonb_build_array(jsonb_build_object('date', '2099-03-01', 'limit', 10, 'active', true)));

  -- 1) Új szezon a kulcs nélkül: a DUNAVECSE nap alapértelmezetten aktív (a korábbi viselkedés)
  perform public.admin_save_season_parameters(v_payload);
  select id into v_season_id from public.season_parameters where year = 2099 and season = 'Ősz';
  if (select is_active from public.pickup_days where season_parameter_id = v_season_id and kind = 'dunavecse') is distinct from true then
    raise exception 'FAIL 1: az új szezon DUNAVECSE napja alapértelmezetten nem aktív.';
  end if;
  v_payload := v_payload || jsonb_build_object('id', v_season_id);

  -- 2) dunavecseActive = false: a szezon mentésével inaktívvá válik
  perform public.admin_save_season_parameters(v_payload || jsonb_build_object('dunavecseActive', false));
  if (select is_active from public.pickup_days where season_parameter_id = v_season_id and kind = 'dunavecse') is distinct from false then
    raise exception 'FAIL 2: a dunavecseActive=false nem inaktiválta a DUNAVECSE napot.';
  end if;

  -- 3) A kulcs hiánya nem módosítja az állapotot
  perform public.admin_save_season_parameters(v_payload);
  if (select is_active from public.pickup_days where season_parameter_id = v_season_id and kind = 'dunavecse') is distinct from false then
    raise exception 'FAIL 3: a hiányzó dunavecseActive kulcs módosította a DUNAVECSE nap állapotát.';
  end if;

  -- 4) dunavecseActive = true: újra aktív
  perform public.admin_save_season_parameters(v_payload || jsonb_build_object('dunavecseActive', true));
  if (select is_active from public.pickup_days where season_parameter_id = v_season_id and kind = 'dunavecse') is distinct from true then
    raise exception 'FAIL 4: a dunavecseActive=true nem aktiválta a DUNAVECSE napot.';
  end if;

  -- 5) A normál nap állapotát a dunavecseActive nem érinti
  perform public.admin_save_season_parameters(v_payload || jsonb_build_object('dunavecseActive', false));
  if (select is_active from public.pickup_days where season_parameter_id = v_season_id and kind = 'normal' and pickup_date = '2099-03-01') is distinct from true then
    raise exception 'FAIL 5: a dunavecseActive módosította a normál nap állapotát.';
  end if;

  -- 6) Nem logikai érték hibát ad, és nem módosít semmit
  v_failed := false;
  begin
    perform public.admin_save_season_parameters(v_payload || jsonb_build_object('dunavecseActive', 'igen'));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 6: a nem logikai dunavecseActive érték elfogadva.';
  end if;
  if (select is_active from public.pickup_days where season_parameter_id = v_season_id and kind = 'dunavecse') is distinct from false then
    raise exception 'FAIL 6b: a hibás mentés mégis módosította a DUNAVECSE napot.';
  end if;

  raise notice 'ALL DUNAVECSE ACTIVE SAVE TESTS PASSED';
end
$test$;

ROLLBACK;
