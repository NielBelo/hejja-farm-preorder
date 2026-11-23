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

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION admin_save_season_parameters(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_save_season_parameters(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_save_season_parameters(jsonb) TO service_role;
