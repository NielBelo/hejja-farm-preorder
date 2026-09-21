-- ROLLBACK - a 20260922000000_size_preference_limit_counts.sql migráció
-- ELŐTTI állapot visszaállítása.
--
-- FONTOS KORLÁTOZÁS: ezt a rollback fájlt NEM egy éles adatbázisból frissen
-- exportált pg_get_functiondef()/pg_get_triggerdef() snapshot alapján
-- készítettük (ellentétben pl. a 20260921_before_larger_preference_edge_days.sql
-- fájllal) - ebben a munkamenetben nem állt rendelkezésre adatbázis-elérés
-- (sem Docker/helyi Supabase, sem SUPABASE_ACCESS_TOKEN). A tartalma a
-- repóban lévő 20260921020000_larger_preference_edge_days.sql migráció
-- végén rögzített function-definíciók szó szerinti visszaírása. Ha az éles
-- adatbázisban azóta drift történt (pl. valaki kézzel módosította ott a
-- function-t), ellenőrizd `pg_get_functiondef('public.enforce_size_preference_limit'::regproc)`
-- és `pg_get_functiondef('public.get_size_preference_locks'::regproc)`
-- lekérdezésekkel MIELŐTT ezt futtatod.
--
-- Használat: csak akkor fusson, ha a 20260922000000 migrációt (a napi
-- darabszám-korlát bevezetése 'larger'-re és 2-re emelése 'smaller'-nél)
-- vissza kell vonni.

BEGIN;

------------------------------------------------------------------
-- 1. enforce_size_preference_limit()
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
  v_season_parameter_id bigint;
  v_pickup_date date;
  v_first_normal_date date;
  v_last_normal_date date;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    return new;
  end if;

  select kind, season_parameter_id, pickup_date
  into v_pickup_kind, v_season_parameter_id, v_pickup_date
  from public.pickup_days where id = new.pickup_day_id;

  if v_pickup_kind = 'dunavecse' then
    return new;
  end if;

  select special_size_preference into v_preference
  from public.profiles where id = new.user_id;

  if v_preference is null then
    return new;
  end if;

  if v_preference = 'larger' then
    select min(pickup_date), max(pickup_date)
    into v_first_normal_date, v_last_normal_date
    from public.pickup_days
    where season_parameter_id = v_season_parameter_id and kind = 'normal';

    if v_pickup_date = v_first_normal_date or v_pickup_date = v_last_normal_date then
      raise exception 'A "Nagyobb méret preferáció" vásárlók a szezon első és utolsó átvételi napjára nem rendelhetnek.'
        using errcode = '22023';
    end if;

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
    raise exception 'Erre a napra már foglalt a keret a(z) "Kisebb méret preferáció" méretpreferenciájú vásárlók számára.'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

------------------------------------------------------------------
-- 2. trg_enforce_size_preference_limit trigger
------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_enforce_size_preference_limit ON public.orders;
CREATE TRIGGER trg_enforce_size_preference_limit
  BEFORE INSERT OR UPDATE OF pickup_day_id, current_version_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION enforce_size_preference_limit();

------------------------------------------------------------------
-- 3. get_size_preference_locks()
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
    and p.special_size_preference = 'smaller'
    and o.user_id is distinct from auth.uid()
    and pd.kind = 'normal'
  union
  select pd.id, 'larger'::text
  from public.pickup_days pd
  where pd.kind = 'normal'
    and pd.pickup_date in (
      select min(pickup_date) from public.pickup_days
      where season_parameter_id = pd.season_parameter_id and kind = 'normal'
      union
      select max(pickup_date) from public.pickup_days
      where season_parameter_id = pd.season_parameter_id and kind = 'normal'
    )
$function$;

REVOKE ALL ON FUNCTION public.get_size_preference_locks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_size_preference_locks() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
