-- ROLLBACK - a 20260921020000_larger_preference_edge_days.sql migráció
-- ELŐTTI, tényleges éles (production) állapot visszaállítása.
--
-- Ez a fájl NEM automatikus, vak visszaállító script: a pg_get_functiondef()
-- és pg_get_triggerdef() 2026.09.21-i, éles adatbázisból exportált
-- eredménye alapján készült (a felhasználó által a beszélgetésben
-- visszaküldött snapshot), és kizárólag a function/RPC és trigger
-- definíciókat, valamint a get_size_preference_locks jogosultságait
-- (GRANT/REVOKE) állítja vissza szó szerint az akkori éles értékükre.
--
-- Az éles snapshot alapján mindkét function teste szó szerint megegyezett a
-- repóban a 20260921010000_bacskiskun_dunavecse.sql migráció végén rögzített
-- verzióval - nem volt drift -, ezért ez a rollback egyszerűen azt a
-- (korábban már éles) állapotot állítja vissza.
--
-- Használat: csak akkor fusson, ha a 20260921020000 migrációt (a "Nagyobb
-- méret preferáció" első/utolsó napi korlátozását) vissza kell vonni.

BEGIN;

------------------------------------------------------------------
-- 1. enforce_size_preference_limit()
--    SECURITY DEFINER · search_path = ''
--    Grants: 4 szerepkör (owner + anon + authenticated + service_role -
--    ezt a function-t soha semmilyen migráció nem szigorította explicit
--    REVOKE-kal, ezért a Postgres-alapértelmezés szerinti PUBLIC EXECUTE
--    érvényes rá; ezt a rollback nem módosítja).
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_size_preference_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_preference text;
  v_pickup_kind text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    return new;
  end if;

  select kind into v_pickup_kind from public.pickup_days where id = new.pickup_day_id;

  if v_pickup_kind = 'dunavecse' then
    return new;
  end if;

  select special_size_preference into v_preference
  from public.profiles where id = new.user_id;

  if v_preference is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pickup_day_size_preference:' || new.pickup_day_id || ':' || v_preference, 0)
  );

  if exists (
    select 1
    from public.orders o
    join public.profiles p on p.id = o.user_id
    where o.pickup_day_id = new.pickup_day_id
      and o.status = 'submitted'
      and o.user_id <> new.user_id
      and p.special_size_preference = v_preference
  ) then
    raise exception 'Erre a napra már foglalt a keret a(z) "%" méretpreferenciájú vásárlók számára.',
      case v_preference when 'smaller' then 'Kisebb méret preferáció' else 'Nagyobb méret preferáció' end
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

------------------------------------------------------------------
-- 2. trg_enforce_size_preference_limit trigger
--    (a definíció - időzítés, esemény, függvény - nem változott a
--    migrációval, de az explicit DROP/CREATE biztonsági okból itt is
--    szerepel, konzisztensen a forward migrációval).
------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_enforce_size_preference_limit ON public.orders;
CREATE TRIGGER trg_enforce_size_preference_limit
  BEFORE INSERT OR UPDATE OF pickup_day_id, current_version_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION enforce_size_preference_limit();

------------------------------------------------------------------
-- 3. get_size_preference_locks()
--    STABLE SECURITY DEFINER · search_path = ''
--    Grants: owner + authenticated + service_role (PUBLIC és anon
--    explicit REVOKE-olva) - visszaállítva szó szerint.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_size_preference_locks()
 RETURNS TABLE(pickup_day_id bigint, preference text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select distinct o.pickup_day_id, p.special_size_preference as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  join public.pickup_days pd on pd.id = o.pickup_day_id
  where o.status = 'submitted'
    and p.special_size_preference is not null
    and o.user_id is distinct from auth.uid()
    and pd.kind = 'normal'
$function$;

REVOKE ALL ON FUNCTION public.get_size_preference_locks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_size_preference_locks() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
