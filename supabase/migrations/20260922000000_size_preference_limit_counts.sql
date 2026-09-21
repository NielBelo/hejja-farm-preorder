-- "Nagyobb méret preferáció" (larger) és "Kisebb méret preferáció" (smaller)
-- napi korlátjának módosítása.
--
-- Eddig (20260921020000_larger_preference_edge_days.sql):
--   - 'larger': nincs napi darabszám-korlát, csak a szezon első és utolsó
--     NORMÁL átvételi napjára nem rendelhet.
--   - 'smaller': napi legfeljebb 1 különböző vásárló.
--
-- Mostantól:
--   - 'larger': az első/utolsó napi tiltás VÁLTOZATLAN marad, ÉS emellett a
--     köztes normál napokon is bevezetjük a napi legfeljebb 1 különböző
--     vásárlós korlátot (tehát egy adott közbenső napra is csak 1 'larger'
--     vásárló rendelhet).
--   - 'smaller': a napi korlát 1-ről 2 különböző vásárlóra emelkedik.
--
-- A korlátozás továbbra is vásárlónkénti (profiles.special_size_preference
-- szerinti distinct user_id), nem rendelésenkénti vagy darabszám alapú:
-- akinek már van ott rendelése, ugyanarra a napra további előrendelést is
-- rögzíthet, ez nem számít bele újra a keretbe. A DUNAVECSE (kind =
-- 'dunavecse') technikai nap továbbra is teljesen kivétel mindkét
-- preferenciánál - ezt a korai `if v_pickup_kind = 'dunavecse' then return
-- new` ág biztosítja a triggerben, illetve a `pd.kind = 'normal'` szűrés a
-- get_size_preference_locks()-ban.
create or replace function public.enforce_size_preference_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
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
$$;

drop trigger if exists trg_enforce_size_preference_limit on public.orders;
create trigger trg_enforce_size_preference_limit
  before insert or update of pickup_day_id, current_version_id on public.orders
  for each row execute function public.enforce_size_preference_limit();

-- A preorder oldal napválasztója ebből tudja meg, mely napokat NE kínálja
-- fel a hívó saját méretpreferenciájának: 'smaller'-nél azok a normál
-- napok, ahol már 2 MÁS 'smaller' vásárlónak van rendelése; 'larger'-nél a
-- szezon első/utolsó normál napja (foglaltságtól függetlenül, változatlan),
-- valamint azok a köztes normál napok, ahol már 1 MÁS 'larger' vásárlónak
-- van rendelése.
create or replace function public.get_size_preference_locks()
returns table(pickup_day_id bigint, preference text)
language sql security definer stable set search_path = '' as $$
  select o.pickup_day_id, 'smaller'::text as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  join public.pickup_days pd on pd.id = o.pickup_day_id
  where o.status = 'submitted'
    and p.special_size_preference = 'smaller'
    and o.user_id is distinct from auth.uid()
    and pd.kind = 'normal'
  group by o.pickup_day_id
  having count(distinct o.user_id) >= 2
  union
  select o.pickup_day_id, 'larger'::text as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  join public.pickup_days pd on pd.id = o.pickup_day_id
  where o.status = 'submitted'
    and p.special_size_preference = 'larger'
    and o.user_id is distinct from auth.uid()
    and pd.kind = 'normal'
  group by o.pickup_day_id
  having count(distinct o.user_id) >= 1
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
$$;

revoke all on function public.get_size_preference_locks() from public, anon;
grant execute on function public.get_size_preference_locks() to authenticated;

notify pgrst, 'reload schema';
