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
    and o.archived_at is null
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
