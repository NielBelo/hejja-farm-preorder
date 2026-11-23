-- Ellenőrző script a 20261123000000_drop_size_preference_and_oroshazi.sql
-- migrációhoz. Csak katalógust olvas (semmit nem módosít), Supabase SQL
-- Editorban futtatható; hiba nélküli lefutás = siker.
BEGIN;

DO $test$
begin
  -- 1) A két oszlop megszűnt
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('special_size_preference', 'oroshazi_delivery')
  ) then
    raise exception 'FAIL 1: a profiles még tartalmaz egy eldobandó oszlopot.';
  end if;

  -- 2) A régi trigger és a megszűnő függvények nincsenek meg
  if exists (select 1 from pg_trigger where tgname = 'trg_enforce_size_preference_limit') then
    raise exception 'FAIL 2a: a trg_enforce_size_preference_limit még létezik.';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'enforce_size_preference_limit', 'get_size_preference_locks',
      'update_admin_oroshazi_delivery', 'get_admin_accounts_without_oroshazi_delivery')
  ) then
    raise exception 'FAIL 2b: egy megszűnő függvény még létezik.';
  end if;

  -- 3) A megmaradó függvények léteznek, és már nem említik a két oszlopot
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('get_admin_accounts', 'update_admin_account_profile')) <> 2 then
    raise exception 'FAIL 3a: get_admin_accounts vagy update_admin_account_profile hiányzik.';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('get_admin_accounts', 'update_admin_account_profile')
      and (pg_get_functiondef(p.oid) ilike '%special_size_preference%'
        or pg_get_functiondef(p.oid) ilike '%oroshazi%')
  ) then
    raise exception 'FAIL 3b: egy megmaradó függvény még hivatkozik az eldobott oszlopokra.';
  end if;

  -- 4) A napi méretlimit trigger továbbra is él
  if not exists (select 1 from pg_trigger where tgname = 'trg_enforce_daily_size_limit') then
    raise exception 'FAIL 4: a napi méretlimit trigger hiányzik.';
  end if;

  raise notice 'ALL DROP SIZE PREFERENCE / OROSHAZI TESTS PASSED';
end
$test$;

ROLLBACK;
