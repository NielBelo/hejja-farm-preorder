-- Méretpreferencia-korlát átvételi naponként.
--
-- Egy adott átvételi napra legfeljebb 1 különböző "Kisebb méret preferáció"
-- (profiles.special_size_preference = 'smaller') és legfeljebb 1 különböző
-- "Nagyobb méret preferáció" ('larger') vásárló rendelhet. A korlátozás
-- vásárlónkénti (user_id), nem rendelésenkénti: akinek már van ott
-- rendelése, ugyanarra a napra további külön előrendelést is rögzíthet.
--
-- Ugyanazt a mintát követi, mint a pickup_day_activation migráció
-- trg_enforce_pickup_day_active triggere: a finalize_order és update_order
-- RPC-k forráskódját szándékosan nem módosítjuk (előbbié nincs is
-- verziózva ebben a migrációs mappában), helyette egy trigger ellenőrzi a
-- public.orders tábla minden beszúrását, illetve minden olyan
-- módosítását, amely a pickup_day_id-t vagy a current_version_id-t érinti
-- (ez utóbbi kettőt az update_order minden módosításkor átállítja, így ez
-- lefedi mind a napváltást, mind a tételek módosítását).
--
-- Konkurens rendelések ellen: a tényleges ellenőrzés előtt egy
-- tranzakció-szintű advisory lockot veszünk fel az (átvételi nap,
-- preferencia) párra, így két egyidejű tranzakció nem láthatja
-- egymástól függetlenül "szabadnak" ugyanazt a keretet - a második addig
-- vár, amíg az első le nem zárul, utána pedig már a friss állapotot látja.
create or replace function public.enforce_size_preference_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_preference text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
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
$$;

drop trigger if exists trg_enforce_size_preference_limit on public.orders;
create trigger trg_enforce_size_preference_limit
  before insert or update of pickup_day_id, current_version_id on public.orders
  for each row execute function public.enforce_size_preference_limit();

-- Csak azt közli a klienssel, hogy mely átvételi napokon van MÁS vásárló
-- által lefoglalva a hívó saját méretpreferenciájának megfelelő keret -
-- személyes adatot (nevet, user_id-t) nem ad ki, így a preorder oldal
-- ez alapján egyszerűen nem kínálja fel ezeket a napokat választhatóként.
create or replace function public.get_size_preference_locks()
returns table(pickup_day_id bigint, preference text)
language sql security definer stable set search_path = '' as $$
  select distinct o.pickup_day_id, p.special_size_preference as preference
  from public.orders o
  join public.profiles p on p.id = o.user_id
  where o.status = 'submitted'
    and p.special_size_preference is not null
    and o.user_id is distinct from auth.uid()
$$;

revoke all on function public.get_size_preference_locks() from public, anon;
grant execute on function public.get_size_preference_locks() to authenticated;

notify pgrst, 'reload schema';
