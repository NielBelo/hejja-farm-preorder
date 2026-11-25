-- Rollback a 20261126000000_soft_delete_day_orders.sql migrációhoz: a
-- függvények, a nézetek és a policy a migráció ELŐTTI éles állapot (supabase/
-- schema tükör). A törölt napok rendelései (orders.archived_at) a rollback után
-- újra láthatóvá és élővé válnak, mert az oszlop megszűnik.
BEGIN;

DROP POLICY "Users can view own orders" ON public.orders;
CREATE POLICY "Users can view own orders" ON public.orders AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP VIEW public.season_order_stats;
DROP VIEW public.pickup_day_order_stats;

CREATE VIEW public.pickup_day_order_stats WITH (security_invoker = true) AS
 SELECT pd.id AS pickup_day_id,
    pd.season_parameter_id,
    count(DISTINCT o.id) FILTER (WHERE (o.status = 'submitted'::text)) AS live_order_count,
    count(DISTINCT o.id) AS total_order_count,
    (COALESCE(sum(oi.quantity) FILTER (WHERE ((o.status = 'submitted'::text) AND (oi.size_preference = 'Átlagostól kisebb méret'::text))), (0)::bigint))::integer AS live_small_quantity,
    (COALESCE(sum(oi.quantity) FILTER (WHERE ((o.status = 'submitted'::text) AND (oi.size_preference = 'Átlagostól nagyobb méret'::text))), (0)::bigint))::integer AS live_large_quantity
   FROM ((pickup_days pd
     LEFT JOIN orders o ON ((o.pickup_day_id = pd.id)))
     LEFT JOIN order_items oi ON ((oi.order_version_id = o.current_version_id)))
  GROUP BY pd.id, pd.season_parameter_id;

CREATE VIEW public.season_order_stats WITH (security_invoker = true) AS
 SELECT sp.id AS season_parameter_id,
    (COALESCE(sum(s.live_order_count), (0)::numeric))::integer AS live_order_count,
    (COALESCE(sum(s.total_order_count), (0)::numeric))::integer AS total_order_count,
    (COALESCE(sum(s.live_small_quantity), (0)::numeric))::integer AS live_small_quantity,
    (COALESCE(sum(s.live_large_quantity), (0)::numeric))::integer AS live_large_quantity
   FROM (season_parameters sp
     LEFT JOIN pickup_day_order_stats s ON ((s.season_parameter_id = sp.id)))
  GROUP BY sp.id;

REVOKE ALL ON TABLE public.pickup_day_order_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pickup_day_order_stats TO authenticated;
GRANT SELECT ON TABLE public.pickup_day_order_stats TO service_role;
REVOKE ALL ON TABLE public.season_order_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.season_order_stats TO authenticated;
GRANT SELECT ON TABLE public.season_order_stats TO service_role;

CREATE OR REPLACE FUNCTION public.admin_save_season_parameters(season_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint := nullif(season_data ->> 'id','')::bigint;
  v_year integer := (season_data ->> 'year')::integer;
  v_season text := season_data ->> 'type';
  v_price integer := (season_data ->> 'price')::integer;
  v_weight_min numeric := (season_data ->> 'weightMin')::numeric;
  v_weight_max numeric := (season_data ->> 'weightMax')::numeric;
  v_start date := (season_data ->> 'orderStart')::date;
  v_end date := (season_data ->> 'orderEnd')::date;
  v_pickup_time_start time := (season_data ->> 'pickupTimeStart')::time;
  v_pickup_time_end time := (season_data ->> 'pickupTimeEnd')::time;
  v_local_pickup_time_start time := (season_data ->> 'localPickupTimeStart')::time;
  v_days jsonb := season_data -> 'pickupDays';
  v_active boolean := coalesce((season_data ->> 'active')::boolean, false);
  v_confirm_live_orders boolean := coalesce((season_data ->> 'confirmLiveOrders')::boolean, false);
  v_day jsonb; v_date date; v_limit integer; v_day_active boolean;
  v_has_small_limit boolean; v_has_large_limit boolean;
  v_small_limit integer; v_large_limit integer;
  v_season_id bigint;
  v_live_dates text;
  v_last_normal_date date;
  v_existing_id bigint;
  v_old_planned_stock integer;
  v_old_available_stock integer;
  v_delta integer;
  v_new_available_stock integer;
  v_live_small integer;
  v_live_large integer;
  v_note text := nullif(btrim(season_data ->> 'note'), '');
  v_has_note boolean := season_data ? 'note';
  v_prices jsonb := season_data -> 'prices';
  v_price_row jsonb;
  v_price_product_id bigint;
  v_price_value integer;
  v_price_product_ids bigint[] := '{}';
  v_dunavecse_active boolean;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if v_year is null or v_season not in ('Tavasz','Ősz') or v_price is null or v_price < 0
    or v_weight_min is null or v_weight_min <= 0 or v_weight_max is null or v_weight_max < v_weight_min
    or v_start is null or v_end is null or v_start > v_end
    or v_pickup_time_start is null or v_pickup_time_end is null or v_pickup_time_start >= v_pickup_time_end
    or v_local_pickup_time_start is null
    or jsonb_typeof(v_days) <> 'array'
    or jsonb_array_length(v_days) not between 1 and 5 then
    raise exception 'Érvénytelen szezonadatok.' using errcode = '22023';
  end if;
  if season_data ? 'dunavecseActive' then
    if jsonb_typeof(season_data -> 'dunavecseActive') <> 'boolean' then
      raise exception 'Érvénytelen DUNAVECSE nap beállítás.' using errcode = '22023';
    end if;
    v_dunavecse_active := (season_data ->> 'dunavecseActive')::boolean;
  end if;
  if char_length(v_note) > 100 then
    raise exception 'A megjegyzés legfeljebb 100 karakter lehet.' using errcode = '22023';
  end if;
  if season_data ? 'prices' then
    if jsonb_typeof(v_prices) <> 'array' or jsonb_array_length(v_prices) < 1 then
      raise exception 'Érvénytelen termékárak.' using errcode = '22023';
    end if;
    for v_price_row in select * from jsonb_array_elements(v_prices) loop
      if jsonb_typeof(v_price_row -> 'productId') <> 'number' or jsonb_typeof(v_price_row -> 'price') <> 'number'
        or (v_price_row ->> 'productId') !~ '^[0-9]+$' or (v_price_row ->> 'price') !~ '^[0-9]+$' then
        raise exception 'Érvénytelen termékárak.' using errcode = '22023';
      end if;
      v_price_product_id := (v_price_row ->> 'productId')::bigint;
      if v_price_product_id = any(v_price_product_ids)
        or not exists (select 1 from public.products where id = v_price_product_id) then
        raise exception 'Érvénytelen termékárak.' using errcode = '22023';
      end if;
      v_price_product_ids := v_price_product_ids || v_price_product_id;
    end loop;
  end if;
  if v_id is not null and not exists (select 1 from public.season_parameters where id = v_id) then
    raise exception 'A szezon nem található.' using errcode = 'P0002';
  end if;
  if v_id is not null and exists (select 1 from public.season_parameters where id = v_id and archived_at is not null) then
    raise exception 'A szezon törölt, mentés előtt állítsa vissza.' using errcode = '22023';
  end if;

  -- A form által már nem tartalmazott (nem archivált) normál napok: ezeket
  -- fizikai törlés helyett archiváljuk. A sorok zárolása az élő rendelések
  -- ellenőrzése előtt történik, hogy közben ne módosulhassanak.
  if v_id is not null then
    perform 1 from public.pickup_days p
      where p.season_parameter_id = v_id and p.kind = 'normal' and p.archived_at is null
      for update;

    select string_agg(to_char(p.pickup_date, 'YYYY.MM.DD'), ', ' order by p.pickup_date)
    into v_live_dates
    from public.pickup_days p
    where p.season_parameter_id = v_id
      and p.kind = 'normal'
      and p.archived_at is null
      and exists (select 1 from public.orders o where o.pickup_day_id = p.id and o.status = 'submitted')
      and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date = p.pickup_date);

    if v_live_dates is not null and not v_confirm_live_orders then
      raise exception 'A következő átvételi nap(ok)hoz élő rendelés tartozik: %. A törléshez megerősítés szükséges.', v_live_dates
        using errcode = '22023', hint = 'LIVE_ORDERS_CONFIRMATION_REQUIRED';
    end if;
  end if;

  if v_active then
    update public.season_parameters set is_active = false where is_active and id is distinct from v_id;
    update public.pickup_days set is_active = false
      where is_active and season_parameter_id is distinct from v_id;
  end if;
  if v_id is null then
    insert into public.season_parameters(
      year, season, weight_min, weight_max, price, is_active,
      time_window_start, time_window_end, pickup_time_start, pickup_time_end, local_pickup_time_start, note
    )
    values(
      v_year, v_season, v_weight_min, v_weight_max, v_price, v_active,
      v_start::timestamptz, v_end::timestamptz, v_pickup_time_start, v_pickup_time_end, v_local_pickup_time_start, v_note
    )
    returning id into v_season_id;
  else
    update public.season_parameters
      set year = v_year, season = v_season, weight_min = v_weight_min, weight_max = v_weight_max,
          price = v_price, is_active = v_active, time_window_start = v_start::timestamptz, time_window_end = v_end::timestamptz,
          pickup_time_start = v_pickup_time_start, pickup_time_end = v_pickup_time_end,
          local_pickup_time_start = v_local_pickup_time_start,
          note = case when v_has_note then v_note else note end
      where id = v_id
      returning id into v_season_id;
  end if;

  -- Termékenkénti árak: a beküldött termékek ára felülíródik (upsert), a
  -- nem beküldötteké változatlan marad.
  if season_data ? 'prices' then
    for v_price_row in select * from jsonb_array_elements(v_prices) loop
      v_price_product_id := (v_price_row ->> 'productId')::bigint;
      v_price_value := (v_price_row ->> 'price')::integer;
      insert into public.season_product_prices (season_parameter_id, product_id, price)
      values (v_season_id, v_price_product_id, v_price_value)
      on conflict (season_parameter_id, product_id) do update set price = excluded.price;
    end loop;
  end if;

  -- Soft delete: a rendelések hivatkozásai érintetlenek maradnak, a nap
  -- csak archiválódik (és inaktív lesz).
  update public.pickup_days p
    set archived_at = now(), is_active = false
    where p.season_parameter_id = v_season_id
      and p.kind = 'normal'
      and p.archived_at is null
      and not exists (select 1 from jsonb_array_elements(v_days) x where (x->>'date')::date = p.pickup_date);

  for v_day in select * from jsonb_array_elements(v_days) loop
    v_date := (v_day->>'date')::date; v_limit := (v_day->>'limit')::integer;
    v_day_active := coalesce((v_day->>'active')::boolean, true);
    v_has_small_limit := v_day ? 'smallSizeLimit';
    v_has_large_limit := v_day ? 'largeSizeLimit';
    v_small_limit := nullif(v_day->>'smallSizeLimit', '')::integer;
    v_large_limit := nullif(v_day->>'largeSizeLimit', '')::integer;

    if v_small_limit < 0 or v_large_limit < 0 then
      raise exception 'Érvénytelen szezonadatok.' using errcode = '22023';
    end if;

    -- Az archivált napot is megtaláljuk: ha az admin ugyanarra a dátumra
    -- újra felveszi, a régi sor áll vissza (nem jön létre új sor).
    select id, planned_stock, available_stock
      into v_existing_id, v_old_planned_stock, v_old_available_stock
      from public.pickup_days
      where season_parameter_id = v_season_id and pickup_date = v_date and kind = 'normal'
      for update;

    if found then
      v_delta := v_limit - v_old_planned_stock;
      v_new_available_stock := v_old_available_stock + v_delta;

      if v_new_available_stock < 0 then
        raise exception 'A(z) % napi limitje (% db) kisebb, mint az erre a napra már lefoglalt mennyiség (% db). Növelje a limitet, vagy mondasson le rendelés(eke)t a csökkentés előtt.',
          to_char(v_date, 'YYYY.MM.DD'), v_limit, v_old_planned_stock - v_old_available_stock
          using errcode = '22023';
      end if;

      select s.live_small_quantity, s.live_large_quantity
        into v_live_small, v_live_large
        from public.pickup_day_order_stats s
        where s.pickup_day_id = v_existing_id;

      if v_has_small_limit and v_small_limit is not null and v_small_limit < coalesce(v_live_small, 0) then
        raise exception 'A(z) % kisebb méretű limitje (% db) kisebb, mint az erre a napra már rendelt kisebb méretű mennyiség (% db).',
          to_char(v_date, 'YYYY.MM.DD'), v_small_limit, v_live_small
          using errcode = '22023';
      end if;
      if v_has_large_limit and v_large_limit is not null and v_large_limit < coalesce(v_live_large, 0) then
        raise exception 'A(z) % nagyobb méretű limitje (% db) kisebb, mint az erre a napra már rendelt nagyobb méretű mennyiség (% db).',
          to_char(v_date, 'YYYY.MM.DD'), v_large_limit, v_live_large
          using errcode = '22023';
      end if;

      update public.pickup_days
        set planned_stock = v_limit, available_stock = v_new_available_stock,
            is_active = v_day_active, year = v_year, season = v_season,
            archived_at = null,
            small_size_limit = case when v_has_small_limit then v_small_limit else small_size_limit end,
            large_size_limit = case when v_has_large_limit then v_large_limit else large_size_limit end
        where id = v_existing_id;
    else
      insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind, small_size_limit, large_size_limit)
      values(v_year, v_season, v_date, v_limit, v_limit, v_day_active, 1, 1, v_season_id, 'normal', v_small_limit, v_large_limit);
    end if;
  end loop;

  select max(pickup_date) into v_last_normal_date
    from public.pickup_days
    where season_parameter_id = v_season_id and kind = 'normal' and archived_at is null;

  update public.pickup_days
    set pickup_date = v_last_normal_date, year = v_year, season = v_season
    where season_parameter_id = v_season_id and kind = 'dunavecse';

  if not found then
    insert into public.pickup_days(year, season, pickup_date, planned_stock, available_stock, is_active, serial_number, _group, season_parameter_id, kind)
    values(v_year, v_season, v_last_normal_date, null, null, true, 1, 1, v_season_id, 'dunavecse');
  end if;

  -- A DUNAVECSE nap aktív állapota a normál napokhoz hasonlóan a szezon
  -- mentésével együtt módosul; ha a kulcs hiányzik, változatlan marad.
  if v_dunavecse_active is not null then
    update public.pickup_days set is_active = v_dunavecse_active
      where season_parameter_id = v_season_id and kind = 'dunavecse';
  end if;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_save_season_parameters(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_save_season_parameters(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_save_season_parameters(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_season_parameters(target_id bigint, confirm_live_orders boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_live_orders integer;
  v_now timestamptz := now();
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.season_parameters where id = target_id) then
    raise exception 'A szezon nem található.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.season_parameters where id = target_id and archived_at is not null) then
    raise exception 'A szezon már törölve van.' using errcode = '22023';
  end if;

  -- A szezon napjainak zárolása az élő rendelések ellenőrzése előtt.
  perform 1 from public.pickup_days where season_parameter_id = target_id for update;

  select count(*) into v_live_orders
  from public.orders o
  join public.pickup_days p on p.id = o.pickup_day_id
  where p.season_parameter_id = target_id and o.status = 'submitted';

  if v_live_orders > 0 and not confirm_live_orders then
    raise exception 'A szezonhoz % élő rendelés tartozik. A törléshez megerősítés szükséges.', v_live_orders
      using errcode = '22023', hint = 'LIVE_ORDERS_CONFIRMATION_REQUIRED';
  end if;

  -- Soft delete: a szezon és az összes napja (a DUNAVECSE is) ugyanazzal az
  -- időbélyeggel archiválódik, így a visszaállítás pontosan ezeket hozza
  -- vissza. A rendelések érintetlenek maradnak.
  update public.pickup_days
    set archived_at = v_now, is_active = false
    where season_parameter_id = target_id and archived_at is null;

  update public.season_parameters
    set archived_at = v_now, is_active = false
    where id = target_id;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_delete_season_parameters(bigint,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_delete_season_parameters(bigint,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_season_parameters(bigint,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_restore_pickup_day(target_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind text;
  v_season_id bigint;
  v_archived_at timestamptz;
  v_season_archived_at timestamptz;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  select kind, season_parameter_id, archived_at
    into v_kind, v_season_id, v_archived_at
    from public.pickup_days
    where id = target_id
    for update;

  if not found then
    raise exception 'Az átvételi nap nem található.' using errcode = 'P0002';
  end if;
  if v_archived_at is null then
    raise exception 'Az átvételi nap nincs törölve.' using errcode = '22023';
  end if;
  if v_kind <> 'normal' then
    raise exception 'A DUNAVECSE nap csak a szezonnal együtt állítható vissza.' using errcode = '22023';
  end if;

  select archived_at into v_season_archived_at from public.season_parameters where id = v_season_id;
  if v_season_archived_at is not null then
    raise exception 'A nap szezonja törölve van, előbb a szezont állítsa vissza.' using errcode = '22023';
  end if;

  if (select count(*) from public.pickup_days
        where season_parameter_id = v_season_id and kind = 'normal' and archived_at is null) >= 5 then
    raise exception 'Egy szezonban legfeljebb 5 átvételi nap lehet; előbb töröljön egy másikat.' using errcode = '22023';
  end if;

  -- Visszaállítás után a nap inaktív, az admin kapcsolja be tudatosan.
  update public.pickup_days set archived_at = null, is_active = false where id = target_id;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_restore_pickup_day(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_restore_pickup_day(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_restore_pickup_day(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_restore_season_parameters(target_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_archived_at timestamptz;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  select archived_at into v_archived_at
    from public.season_parameters
    where id = target_id
    for update;

  if not found then
    raise exception 'A szezon nem található.' using errcode = 'P0002';
  end if;
  if v_archived_at is null then
    raise exception 'A szezon nincs törölve.' using errcode = '22023';
  end if;

  -- Csak a szezonnal EGYÜTT (ugyanazzal az időbélyeggel) törölt napok jönnek
  -- vissza; a korábban külön törölt napok archiváltak maradnak. Minden
  -- inaktívan áll vissza, az admin kapcsolja be tudatosan.
  update public.pickup_days
    set archived_at = null, is_active = false
    where season_parameter_id = target_id and archived_at = v_archived_at;

  update public.season_parameters
    set archived_at = null, is_active = false
    where id = target_id;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_restore_season_parameters(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_restore_season_parameters(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_restore_season_parameters(bigint) TO service_role;

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

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_is_admin boolean;
    v_order_user_id uuid;
    v_season_parameter_id bigint;
    v_pickup_day_id bigint;
    v_current_version_id bigint;
    v_public_order_number text;
    v_order_status text;
    v_time_window_start timestamptz;
    v_time_window_end timestamptz;
    v_pickup_date date;
    v_pickup_kind text;
    v_old_total_quantity integer;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION
            'A rendelés lemondásához bejelentkezés szükséges.';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles AS ur
        WHERE ur.user_id = v_user_id
          AND ur.role = 'admin'
    )
    INTO v_is_admin;

    SELECT
        o.user_id,
        o.season_parameter_id,
        o.pickup_day_id,
        o.current_version_id,
        o.public_order_number,
        o.status
    INTO
        v_order_user_id,
        v_season_parameter_id,
        v_pickup_day_id,
        v_current_version_id,
        v_public_order_number,
        v_order_status
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'A lemondandó rendelés nem létezik.';
    END IF;

    IF v_order_user_id IS DISTINCT FROM v_user_id
       AND NOT v_is_admin THEN
        RAISE EXCEPTION
            'Nincs jogosultsága ennek a rendelésnek a lemondásához.';
    END IF;

    IF v_order_status IS DISTINCT FROM 'submitted' THEN
        RAISE EXCEPTION
            'Ez a rendelés már nem mondható le.';
    END IF;

    SELECT
        sp.time_window_start,
        sp.time_window_end
    INTO
        v_time_window_start,
        v_time_window_end
    FROM public.season_parameters AS sp
    WHERE sp.id = v_season_parameter_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'A rendeléshez tartozó szezon nem található.';
    END IF;

    IF v_time_window_start IS NULL
       OR v_time_window_end IS NULL THEN
        RAISE EXCEPTION
            'A rendelési időszak nincs megfelelően beállítva.';
    END IF;

    -- Az előrendelési időablak csak a normál vásárlóra vonatkozik; az admin
    -- az ablakon kívül is lemondhat (az update_order is így működik).
    IF NOT v_is_admin THEN
        IF now() < v_time_window_start THEN
            RAISE EXCEPTION
                'A rendelési időszak még nem kezdődött el.';
        END IF;

        IF now() > v_time_window_end THEN
            RAISE EXCEPTION
                'A rendelési időszak már lezárult, a rendelés nem mondható le.';
        END IF;
    END IF;

    IF v_current_version_id IS NULL THEN
        RAISE EXCEPTION
            'A rendelés aktuális verziója nem található.';
    END IF;

    SELECT coalesce(sum(oi.quantity), 0)
    INTO v_old_total_quantity
    FROM public.order_items AS oi
    WHERE oi.order_version_id = v_current_version_id;

    IF v_old_total_quantity <= 0 THEN
        RAISE EXCEPTION
            'A rendeléshez nem tartozik érvényes rendelési mennyiség.';
    END IF;

    -- Átvételi nap zárolása és a teljesített rendelések védelme. A kind
    -- mezőt is lekérjük (ÚJ), hogy a DUNAVECSE technikai napra ne
    -- próbáljunk normál készletet visszatölteni.
    SELECT pd.pickup_date, pd.kind
    INTO v_pickup_date, v_pickup_kind
    FROM public.pickup_days AS pd
    WHERE pd.id = v_pickup_day_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'A rendeléshez tartozó átvételi nap nem létezik.';
    END IF;

    IF v_pickup_date IS NULL THEN
        RAISE EXCEPTION
            'A rendeléshez nincs érvényes átvételi dátum megadva.';
    END IF;

    IF v_pickup_date <
       (clock_timestamp() AT TIME ZONE 'Europe/Budapest')::date THEN
        RAISE EXCEPTION
            'Teljesített rendelés nem törölhető.';
    END IF;

    UPDATE public.orders
    SET
        status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_user_id
    WHERE id = p_order_id;

    -- Készlet visszaadása. A DUNAVECSE technikai nap kapacitása korlátlan
    -- (ÚJ), ezért ide sosem kerül készlet-visszatöltés.
    IF v_pickup_kind = 'normal' THEN
        UPDATE public.pickup_days
        SET available_stock =
            available_stock + v_old_total_quantity
        WHERE id = v_pickup_day_id;
    END IF;

    RETURN v_public_order_number;
END;
$function$;

REVOKE ALL ON FUNCTION cancel_order(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_order(bigint) TO PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_order(bigint) TO anon;
GRANT EXECUTE ON FUNCTION cancel_order(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_order(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.update_order(p_order_id bigint, p_items jsonb, p_pickup_day_id bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid;
    v_is_admin boolean := false;

    v_order_user_id uuid;
    v_season_parameter_id bigint;
    v_old_pickup_day_id bigint;
    v_old_pickup_kind text;
    v_new_pickup_day_id bigint;
    v_new_pickup_kind text;
    v_current_version_id bigint;
    v_public_order_number text;
    v_order_status text;

    v_time_window_start timestamptz;
    v_time_window_end timestamptz;

    v_old_pickup_date timestamp without time zone;
    v_old_available_stock integer;

    v_new_pickup_date timestamp without time zone;
    v_new_available_stock integer;

    v_pickup_day_changed boolean;

    v_old_total_quantity integer;
    v_new_total_quantity integer;
    v_quantity_difference integer;

    v_new_version_number integer;
    v_new_order_version_id bigint;

begin
    ------------------------------------------------------------
    -- 1. Bejelentkezett felhasználó ellenőrzése
    ------------------------------------------------------------
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'A rendelés módosításához bejelentkezés szükséges.';
    end if;


    ------------------------------------------------------------
    -- 2. Admin jogosultság meghatározása
    ------------------------------------------------------------
    select exists (
        select 1
        from public.user_roles
        where user_id = v_user_id
          and role = 'admin'
    )
    into v_is_admin;


    ------------------------------------------------------------
    -- 3. Legalább egy rendelési tétel szükséges
    ------------------------------------------------------------
    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then

        raise exception
            'A rendelés nem tartalmaz rendelési tételt.';
    end if;


    ------------------------------------------------------------
    -- 4. Új teljes rendelt mennyiség kiszámítása
    ------------------------------------------------------------
    select sum((item->>'quantity')::integer)
    into v_new_total_quantity
    from jsonb_array_elements(p_items) as item;

    if v_new_total_quantity is null
       or v_new_total_quantity <= 0 then

        raise exception
            'A rendelt mennyiség hibás.';
    end if;


    ------------------------------------------------------------
    -- 5. Rendelés zárolása és adatainak lekérése
    ------------------------------------------------------------
    select
        user_id,
        season_parameter_id,
        pickup_day_id,
        current_version_id,
        public_order_number,
        status
    into
        v_order_user_id,
        v_season_parameter_id,
        v_old_pickup_day_id,
        v_current_version_id,
        v_public_order_number,
        v_order_status
    from public.orders
    where id = p_order_id
    for update;

    if not found then
        raise exception
            'A módosítandó rendelés nem létezik.';
    end if;

    select kind into v_old_pickup_kind
    from public.pickup_days
    where id = v_old_pickup_day_id;

    -- DUNAVECSE rendelésnél az átvételi nap sosem módosítható - a kliens
    -- által esetlegesen küldött p_pickup_day_id-t figyelmen kívül hagyjuk,
    -- ezzel sem a vásárló, sem az admin nem tudja (akár véletlenül sem)
    -- másik napra áthelyezni.
    v_new_pickup_day_id := case
        when v_old_pickup_kind = 'dunavecse' then v_old_pickup_day_id
        else coalesce(p_pickup_day_id, v_old_pickup_day_id)
    end;
    v_pickup_day_changed := v_new_pickup_day_id <> v_old_pickup_day_id;


    ------------------------------------------------------------
    -- 6. Jogosultság ellenőrzése
    --
    -- Normál felhasználó csak a saját rendelését módosíthatja.
    -- Admin bármely felhasználó rendelését módosíthatja.
    ------------------------------------------------------------
    if v_order_user_id <> v_user_id
       and not v_is_admin then

        raise exception
            'Nincs jogosultsága ennek a rendelésnek a módosításához.';
    end if;


    ------------------------------------------------------------
    -- 7. Rendelés státuszának ellenőrzése
    ------------------------------------------------------------
    if v_order_status <> 'submitted' then
        raise exception
            'Ez a rendelés már nem módosítható.';
    end if;


    ------------------------------------------------------------
    -- 8. Aktuális rendelésverzió ellenőrzése
    ------------------------------------------------------------
    if v_current_version_id is null then
        raise exception
            'A rendelés aktuális verziója nem található.';
    end if;


    ------------------------------------------------------------
    -- 9. Átvételi nap(ok) zárolása és készlet lekérése
    --
    -- Napváltás esetén mindkét érintett napot zároljuk, mindig a
    -- kisebb id-jű sorral kezdve, hogy két párhuzamos, egymással
    -- ellentétes irányú napváltás ne okozzon holtpontot (deadlock).
    -- DUNAVECSE rendelésnél v_pickup_day_changed a fenti lépés miatt
    -- mindig false, ezért ez mindig a "nincs napváltás" ágon fut le.
    ------------------------------------------------------------
    if not v_pickup_day_changed then

        select available_stock, pickup_date
        into v_old_available_stock, v_old_pickup_date
        from public.pickup_days
        where id = v_old_pickup_day_id
        for update;

        if not found then
            raise exception
                'A rendeléshez tartozó átvételi nap nem létezik.';
        end if;

    elsif v_old_pickup_day_id < v_new_pickup_day_id then

        select available_stock, pickup_date
        into v_old_available_stock, v_old_pickup_date
        from public.pickup_days
        where id = v_old_pickup_day_id
        for update;

        if not found then
            raise exception
                'A rendeléshez tartozó átvételi nap nem létezik.';
        end if;

        select available_stock, pickup_date, kind
        into v_new_available_stock, v_new_pickup_date, v_new_pickup_kind
        from public.pickup_days
        where id = v_new_pickup_day_id
        for update;

        if not found then
            raise exception
                'A kiválasztott új átvételi nap nem létezik.';
        end if;

        if v_new_pickup_kind = 'dunavecse' then
            raise exception
                'A DUNAVECSE technikai nap nem választható átvételi napként.';
        end if;

    else

        select available_stock, pickup_date, kind
        into v_new_available_stock, v_new_pickup_date, v_new_pickup_kind
        from public.pickup_days
        where id = v_new_pickup_day_id
        for update;

        if not found then
            raise exception
                'A kiválasztott új átvételi nap nem létezik.';
        end if;

        if v_new_pickup_kind = 'dunavecse' then
            raise exception
                'A DUNAVECSE technikai nap nem választható átvételi napként.';
        end if;

        select available_stock, pickup_date
        into v_old_available_stock, v_old_pickup_date
        from public.pickup_days
        where id = v_old_pickup_day_id
        for update;

        if not found then
            raise exception
                'A rendeléshez tartozó átvételi nap nem létezik.';
        end if;

    end if;


    ------------------------------------------------------------
    -- 10. Elmúlt átvételi nap ellenőrzése
    --
    -- A jelenlegi (régi) átvétel napján még módosítható a rendelés,
    -- a következő naptól mindenki számára lezárt. Napváltás esetén
    -- az új nap sem eshet a múltba.
    ------------------------------------------------------------
    if v_old_pickup_date::date < current_date then
        raise exception
            'Az átvételi nap már elmúlt, a rendelés nem módosítható.';
    end if;

    if v_pickup_day_changed
       and v_new_pickup_date::date < current_date then

        raise exception
            'A kiválasztott új átvételi nap már elmúlt.';
    end if;


    ------------------------------------------------------------
    -- 11. Normál felhasználónál rendelési időablak ellenőrzése
    --
    -- Admin esetén ezt teljesen kihagyjuk.
    ------------------------------------------------------------
    if not v_is_admin then

        select
            time_window_start,
            time_window_end
        into
            v_time_window_start,
            v_time_window_end
        from public.season_parameters
        where id = v_season_parameter_id;

        if not found then
            raise exception
                'A rendeléshez tartozó szezon nem található.';
        end if;


        if v_time_window_start is null
           or v_time_window_end is null then

            raise exception
                'A rendelési időszak nincs megfelelően beállítva.';
        end if;


        if now() < v_time_window_start then
            raise exception
                'A rendelési időszak még nem kezdődött el.';
        end if;


        if now() > v_time_window_end then
            raise exception
                'A rendelési időszak már lezárult, a rendelés nem módosítható.';
        end if;

    end if;


    ------------------------------------------------------------
    -- 12. Régi teljes rendelt mennyiség meghatározása
    ------------------------------------------------------------
    select coalesce(sum(quantity), 0)
    into v_old_total_quantity
    from public.order_items
    where order_version_id = v_current_version_id;


    ------------------------------------------------------------
    -- 13. Készlet ellenőrzése
    --
    -- A DUNAVECSE technikai napra nem vonatkozik semmilyen
    -- készletellenőrzés - a kapacitása korlátlan. Azonos (normál) napon
    -- maradva csak a mennyiségi növekményre van szükség (a meglévő
    -- foglalás a helyén marad). Napváltáskor a teljes új mennyiségre van
    -- szükség az új napon, hiszen ott a rendelésnek jelenleg semmilyen
    -- foglalása nincs.
    ------------------------------------------------------------
    if v_old_pickup_kind = 'dunavecse' then

        null;

    elsif not v_pickup_day_changed then

        v_quantity_difference := v_new_total_quantity - v_old_total_quantity;

        if v_quantity_difference > 0
           and (v_old_available_stock is null
                or v_old_available_stock < v_quantity_difference) then

            raise exception
                'A háttérben készlet változás történt! Elérhető: % db, további igény: % db!',
                coalesce(v_old_available_stock, 0),
                v_quantity_difference;
        end if;

    else

        if v_new_available_stock is null
           or v_new_available_stock < v_new_total_quantity then

            raise exception
                'A kiválasztott átvételi napon nincs elegendő készlet a rendeléshez! Elérhető: % db, igény: % db!',
                coalesce(v_new_available_stock, 0),
                v_new_total_quantity;
        end if;

    end if;


    ------------------------------------------------------------
    -- 14. Következő verziószám meghatározása
    ------------------------------------------------------------
    select coalesce(max(version_number), 0) + 1
    into v_new_version_number
    from public.order_versions
    where order_id = p_order_id;


    ------------------------------------------------------------
    -- 15. Új rendelésverzió létrehozása
    ------------------------------------------------------------
    insert into public.order_versions (
        order_id,
        version_number,
        change_type,
        created_by
    )
    values (
        p_order_id,
        v_new_version_number,
        'modified',
        v_user_id
    )
    returning id
    into v_new_order_version_id;


    ------------------------------------------------------------
    -- 16. Új verzió rendelési tételeinek létrehozása
    ------------------------------------------------------------
    insert into public.order_items (
        order_version_id,
        product_id,
        package_id,
        quantity,
        size_preference,
        note
    )
    select
        v_new_order_version_id,
        (item->>'product_id')::bigint,
        (item->>'package_id')::bigint,
        (item->>'quantity')::integer,
        item->>'size_preference',
        nullif(item->>'note', '')
    from jsonb_array_elements(p_items) as item;


    ------------------------------------------------------------
    -- 17. Rendelés aktuális verziójának (és szükség esetén az
    -- átvételi napjának) átállítása
    ------------------------------------------------------------
    update public.orders
    set current_version_id = v_new_order_version_id,
        pickup_day_id = v_new_pickup_day_id
    where id = p_order_id;


    ------------------------------------------------------------
    -- 18. Készlet korrigálása
    --
    -- A DUNAVECSE technikai nap kapacitása korlátlan, ezért ide sosem
    -- kerül készletkorrekció.
    ------------------------------------------------------------
    if v_old_pickup_kind = 'dunavecse' then

        null;

    elsif not v_pickup_day_changed then

        update public.pickup_days
        set available_stock = available_stock - v_quantity_difference
        where id = v_old_pickup_day_id;

    else

        update public.pickup_days
        set available_stock = available_stock + v_old_total_quantity
        where id = v_old_pickup_day_id;

        update public.pickup_days
        set available_stock = available_stock - v_new_total_quantity
        where id = v_new_pickup_day_id;

    end if;


    ------------------------------------------------------------
    -- 19. Publikus rendelésszám visszaadása
    ------------------------------------------------------------
    return v_public_order_number;

end;
$function$;

REVOKE ALL ON FUNCTION update_order(bigint,jsonb,bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_order(bigint,jsonb,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION update_order(bigint,jsonb,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.restore_order(p_order_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_order public.orders%ROWTYPE;
    v_pickup public.pickup_days%ROWTYPE;
    v_time_window_start timestamptz;
    v_time_window_end timestamptz;
    v_quantity bigint;
BEGIN
    IF v_user_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = v_user_id
          AND role = 'admin'
    ) THEN
        RAISE EXCEPTION
            'A rendelés visszaállításához adminisztrátori jogosultság szükséges.';
    END IF;

    SELECT *
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A visszaállítandó rendelés nem létezik.';
    END IF;

    IF v_order.status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Csak lemondott rendelés állítható vissza.';
    END IF;

    SELECT time_window_start, time_window_end
    INTO v_time_window_start, v_time_window_end
    FROM public.season_parameters
    WHERE id = v_order.season_parameter_id;

    IF NOT FOUND
       OR v_time_window_start IS NULL
       OR v_time_window_end IS NULL THEN
        RAISE EXCEPTION
            'A rendelési időszak nincs megfelelően beállítva.';
    END IF;

    IF v_order.current_version_id IS NULL THEN
        RAISE EXCEPTION
            'A rendelés aktuális verziója nem található.';
    END IF;

    SELECT coalesce(sum(quantity), 0)
    INTO v_quantity
    FROM public.order_items
    WHERE order_version_id = v_order.current_version_id;

    IF v_quantity <= 0 THEN
        RAISE EXCEPTION
            'A rendeléshez nem tartozik érvényes rendelési mennyiség.';
    END IF;

    -- Átvételi nap zárolása. A tábla időközben (fentebb, ebben a
    -- migrációban) bővült a kind oszloppal, ezért a v_pickup.kind (ÚJ) a
    -- SELECT *-ból automatikusan elérhető.
    SELECT *
    INTO v_pickup
    FROM public.pickup_days
    WHERE id = v_order.pickup_day_id
    FOR UPDATE;

    IF NOT FOUND OR v_pickup.pickup_date IS NULL THEN
        RAISE EXCEPTION
            'A rendeléshez nincs érvényes átvételi nap megadva.';
    END IF;

    IF v_pickup.pickup_date <
       (clock_timestamp() AT TIME ZONE 'Europe/Budapest')::date THEN
        RAISE EXCEPTION
            'Elmúlt átvételi dátumú rendelés nem állítható vissza.';
    END IF;

    -- A DUNAVECSE technikai nap kapacitása korlátlan (ÚJ), ezért ide sem
    -- kapacitás-ellenőrzés, sem készletfoglalás nem vonatkozik.
    IF v_pickup.kind = 'normal' THEN
        IF v_pickup.available_stock IS NULL
           OR v_pickup.available_stock < v_quantity THEN
            RAISE EXCEPTION
                'Nincs elegendő szabad készlet a rendelés visszaállításához.';
        END IF;

        UPDATE public.pickup_days
        SET available_stock = available_stock - v_quantity
        WHERE id = v_order.pickup_day_id;
    END IF;

    UPDATE public.orders
    SET status = 'submitted',
        cancelled_at = NULL,
        cancelled_by = NULL
    WHERE id = p_order_id;

    RETURN v_order.public_order_number;
END;
$function$;

REVOKE ALL ON FUNCTION restore_order(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION restore_order(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_order(bigint) TO service_role;

ALTER TABLE public.orders DROP COLUMN archived_at;

COMMIT;
