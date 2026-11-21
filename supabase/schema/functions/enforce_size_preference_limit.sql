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
  v_limit int;
  v_other_customers int;
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

    v_limit := 1;
  else
    v_limit := 2;
  end if;

  -- Konkurens rendelések ellen: a tényleges darabszám-ellenőrzés előtt egy
  -- tranzakció-szintű advisory lockot veszünk fel az (átvételi nap,
  -- preferencia) párra, így két egyidejű tranzakció nem láthatja
  -- egymástól függetlenül "szabadnak" ugyanazt a keretet.
  perform pg_advisory_xact_lock(
    hashtextextended('pickup_day_size_preference:' || new.pickup_day_id || ':' || v_preference, 0)
  );

  select count(distinct o.user_id) into v_other_customers
  from public.orders o
  join public.profiles p on p.id = o.user_id
  where o.pickup_day_id = new.pickup_day_id
    and o.status = 'submitted'
    and o.user_id <> new.user_id
    and p.special_size_preference = v_preference;

  if v_other_customers >= v_limit then
    raise exception 'Erre a napra már foglalt a keret a(z) "%" méretpreferenciájú vásárlók számára.',
      case v_preference when 'smaller' then 'Kisebb méret preferáció' else 'Nagyobb méret preferáció' end
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION enforce_size_preference_limit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enforce_size_preference_limit() TO PUBLIC;
GRANT EXECUTE ON FUNCTION enforce_size_preference_limit() TO anon;
GRANT EXECUTE ON FUNCTION enforce_size_preference_limit() TO authenticated;
GRANT EXECUTE ON FUNCTION enforce_size_preference_limit() TO service_role;
