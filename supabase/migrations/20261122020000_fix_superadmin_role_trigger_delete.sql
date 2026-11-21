-- Hibajavítás: a prevent_superadmin_role_changes() trigger-függvény (BEFORE
-- DELETE OR UPDATE a user_roles táblán) a végén `return new;`-t adott. DELETE-nél
-- a NEW üres, a BEFORE trigger NULL visszatérése pedig csendben kihagyja a
-- műveletet, ezért a szuperadmin kivételével egyetlen user_roles sor sem volt
-- törölhető (a delete 0 sort érintett hiba nélkül). Ez okozta, hogy a
-- delete_admin_account és az auth.users kaszkád törlése árva user_roles
-- sorokat hagyott maga után.
-- Javítás: DELETE-nél OLD-ot adunk vissza. A szuperadmin-védelem változatlan.
BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_superadmin_role_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.is_superadmin then
    if tg_op = 'DELETE' then
      raise exception 'A superadmin jogosultsági rekordja nem törölhető.' using errcode = '42501';
    end if;

    if new.is_superadmin is not true or new.role <> 'admin' then
      raise exception 'A superadmin adminisztrátori jogosultsága nem vonható vissza.' using errcode = '42501';
    end if;
  end if;

  -- BEFORE DELETE triggernél a NEW üres: a `return new` NULL-t adna vissza,
  -- ami csendben kihagyná a törlést. Törlésnél OLD-ot kell visszaadni.
  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION prevent_superadmin_role_changes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prevent_superadmin_role_changes() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
