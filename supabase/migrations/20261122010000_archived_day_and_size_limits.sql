-- Rendelés-védelem és napi méret limit.
--
--  * enforce_pickup_day_active: a nem-admin felhasználó nem adhat le és nem
--    módosíthat rendelést archivált (törölt) átvételi napra. A lemondás
--    (status változás) nem érintett, az admin kivétel marad. A
--    finalize_order / update_order függvények változatlanok: mindkettő a nap
--    sorát zárolja, majd az orders update-je indítja a triggert.
--  * Új enforce_daily_size_limit trigger az orders táblán: a nap élő
--    (submitted) rendeléseinek kisebb/nagyobb méretű csirkedarabszáma
--    (order_items.size_preference alapján) a rendelés új verziójával együtt
--    nem lépheti át a pickup_days.small_size_limit / large_size_limit értéket
--    (NULL = korlátlan, admin és DUNAVECSE nap kivétel). A régi, profilhoz
--    kötött enforce_size_preference_limit trigger ebben a migrációban még él,
--    kivezetése külön lépés.
--  * Új get_pickup_day_size_availability(): naponként a hátralévő kisebb/
--    nagyobb darabszám az ügyfél felületnek.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_pickup_day_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_day_active boolean;
  v_day_archived boolean;
begin
  select is_active, (archived_at is not null) into v_day_active, v_day_archived
    from public.pickup_days where id = new.pickup_day_id;
  if not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    if v_day_archived is true then
      raise exception 'A kiválasztott átvételi nap törölve lett, ezért erre a napra nem adható le és nem módosítható rendelés.' using errcode = '22023';
    end if;
    if v_day_active is false then
      raise exception 'A kiválasztott átvételi nap jelenleg nem elérhető.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION enforce_pickup_day_active() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO PUBLIC;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO anon;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO authenticated;
GRANT EXECUTE ON FUNCTION enforce_pickup_day_active() TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_daily_size_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind text;
  v_small_limit integer;
  v_large_limit integer;
  v_mine_small integer;
  v_mine_large integer;
  v_other_small integer;
  v_other_large integer;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  -- Rendelés-létrehozáskor a tételek még nincsenek meg (a current_version_id
  -- később kerül beállításra): az ellenőrzés akkor fut, amikor a tételek már
  -- léteznek.
  if new.current_version_id is null then
    return new;
  end if;

  if exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    return new;
  end if;

  select kind, small_size_limit, large_size_limit
    into v_kind, v_small_limit, v_large_limit
    from public.pickup_days where id = new.pickup_day_id;

  -- A DUNAVECSE technikai napnak nincs méret limitje; NULL limit = korlátlan.
  if v_kind is distinct from 'normal' or (v_small_limit is null and v_large_limit is null) then
    return new;
  end if;

  -- Konkurens rendelések ellen: tranzakció-szintű advisory lock a napra.
  perform pg_advisory_xact_lock(
    hashtextextended('pickup_day_size_limit:' || new.pickup_day_id, 0)
  );

  select
    coalesce(sum(oi.quantity) filter (where oi.size_preference = 'Átlagostól kisebb méret'), 0),
    coalesce(sum(oi.quantity) filter (where oi.size_preference = 'Átlagostól nagyobb méret'), 0)
  into v_mine_small, v_mine_large
  from public.order_items oi
  where oi.order_version_id = new.current_version_id;

  select
    coalesce(sum(oi.quantity) filter (where oi.size_preference = 'Átlagostól kisebb méret'), 0),
    coalesce(sum(oi.quantity) filter (where oi.size_preference = 'Átlagostól nagyobb méret'), 0)
  into v_other_small, v_other_large
  from public.orders o
  join public.order_items oi on oi.order_version_id = o.current_version_id
  where o.pickup_day_id = new.pickup_day_id
    and o.status = 'submitted'
    and o.id <> new.id;

  if v_small_limit is not null and v_other_small + v_mine_small > v_small_limit then
    raise exception 'Erre a napra a kisebb méretű csirkékre vonatkozó keret betelt. Kérjük, csökkentse a mennyiséget, vagy válasszon másik méretet.'
      using errcode = '22023';
  end if;

  if v_large_limit is not null and v_other_large + v_mine_large > v_large_limit then
    raise exception 'Erre a napra a nagyobb méretű csirkékre vonatkozó keret betelt. Kérjük, csökkentse a mennyiséget, vagy válasszon másik méretet.'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION enforce_daily_size_limit() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_pickup_day_size_availability()
 RETURNS TABLE(pickup_day_id bigint, small_remaining integer, large_remaining integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Naponként a még rendelhető kisebb/nagyobb méretű csirkék darabszáma
  -- (NULL = nincs korlát). Az összes élő (submitted) rendelést számolja, a
  -- hívó saját rendelését is: szerkesztéskor a felület hozzáadja vissza.
  select
    pd.id,
    case when pd.small_size_limit is null then null
         else greatest(pd.small_size_limit - s.live_small_quantity, 0) end,
    case when pd.large_size_limit is null then null
         else greatest(pd.large_size_limit - s.live_large_quantity, 0) end
  from public.pickup_days pd
  join public.pickup_day_order_stats s on s.pickup_day_id = pd.id
  where pd.kind = 'normal'
    and pd.archived_at is null
    and (pd.small_size_limit is not null or pd.large_size_limit is not null)
$function$;

REVOKE ALL ON FUNCTION get_pickup_day_size_availability() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_pickup_day_size_availability() TO authenticated;
GRANT EXECUTE ON FUNCTION get_pickup_day_size_availability() TO service_role;

drop trigger if exists trg_enforce_daily_size_limit on public.orders;
create trigger trg_enforce_daily_size_limit BEFORE INSERT OR UPDATE OF pickup_day_id, current_version_id ON public.orders FOR EACH ROW execute function public.enforce_daily_size_limit();

NOTIFY pgrst, 'reload schema';

COMMIT;
