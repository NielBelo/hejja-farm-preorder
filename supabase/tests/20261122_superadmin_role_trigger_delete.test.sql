-- Ellenőrző script a 20261122020000_fix_superadmin_role_trigger_delete.sql
-- migrációhoz. BEGIN ... ROLLBACK: semmi nem marad bent. Supabase SQL
-- Editorban futtatható; hiba nélküli lefutás = siker (a NOTICE nem látszik).
-- Kell hozzá egy meglévő profil, amelynek nincs user_roles sora.
BEGIN;

DO $test$
declare
  v_user uuid;
  v_super uuid;
  v_deleted integer;
  v_failed boolean := false;
begin
  select p.id into v_user from public.profiles p
    where not exists (select 1 from public.user_roles r where r.user_id = p.id) limit 1;
  select user_id into v_super from public.user_roles where is_superadmin limit 1;
  if v_user is null or v_super is null then
    raise exception 'TEST SETUP: kell egy szerepkör nélküli profil és egy szuperadmin.';
  end if;

  -- 1) Sima felhasználó sora törölhető
  insert into public.user_roles (user_id, role) values (v_user, 'user');
  with d as (delete from public.user_roles where user_id = v_user returning 1)
    select count(*) into v_deleted from d;
  if v_deleted <> 1 then
    raise exception 'FAIL 1: a sima user_roles sor nem törölhető (törölt sorok: %).', v_deleted;
  end if;

  -- 2) A szuperadmin sora továbbra sem törölhető (hibát ad)
  begin
    delete from public.user_roles where user_id = v_super;
  exception when sqlstate '42501' then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 2: a szuperadmin sora törölhető volt.';
  end if;

  -- 3) A szuperadmin jogosultsága továbbra sem vonható vissza (UPDATE védelem)
  v_failed := false;
  begin
    update public.user_roles set role = 'user' where user_id = v_super;
  exception when sqlstate '42501' then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 3: a szuperadmin jogosultsága visszavonható volt.';
  end if;

  raise notice 'ALL SUPERADMIN TRIGGER TESTS PASSED';
end
$test$;

ROLLBACK;
