-- "Nagyobb méret preferáció" korlátozásának módosítása.
--
-- Korábban (20260920000000_size_preference_pickup_limit.sql,
-- 20260921010000_bacskiskun_dunavecse.sql): mindkét méretpreferenciánál
-- ('smaller' és 'larger') ugyanaz a szabály volt érvényben - egy adott
-- átvételi napra legfeljebb 1 különböző vásárló rendelhetett az adott
-- preferenciával.
--
-- Új szabály KIZÁRÓLAG 'larger' preferenciára: a napi darabszám-korlát
-- helyett a szezon NORMÁL átvételi napjai közül az első és az utolsó napra
-- nem rendelhet, a köztes napokra viszont korlátozás nélkül rendelhet (a
-- DUNAVECSE technikai napot ez a számítás sosem veszi figyelembe, hiszen
-- csak kind = 'normal' napokat néz). A 'smaller' preferencia napi
-- 1 fős korlátja változatlan.
create or replace function public.enforce_size_preference_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
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
$$;

drop trigger if exists trg_enforce_size_preference_limit on public.orders;
create trigger trg_enforce_size_preference_limit
  before insert or update of pickup_day_id, current_version_id on public.orders
  for each row execute function public.enforce_size_preference_limit();

-- A preorder oldal napválasztója ebből tudja meg, mely napokat NE kínálja
-- fel a hívó saját méretpreferenciájának. 'smaller'-nél változatlanul azok
-- a napok, ahol MÁS 'smaller' vásárlónak már van rendelése; 'larger'-nél
-- immár nem a foglaltságtól függ, hanem mindig az adott szezon első és
-- utolsó NORMÁL napja (a rajtuk lévő rendelésektől függetlenül).
create or replace function public.get_size_preference_locks()
returns table(pickup_day_id bigint, preference text)
language sql security definer stable set search_path = '' as $$
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
$$;

revoke all on function public.get_size_preference_locks() from public, anon;
grant execute on function public.get_size_preference_locks() to authenticated;

notify pgrst, 'reload schema';
