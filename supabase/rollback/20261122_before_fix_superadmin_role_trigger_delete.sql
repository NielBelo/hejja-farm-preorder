-- ROLLBACK - a 20261122020000_fix_superadmin_role_trigger_delete.sql előtti
-- (hibás) függvénydefiníció visszaállítása. FIGYELEM: ez visszahozza a hibát:
-- a user_roles sorok (a szuperadmin kivételével) újra nem lesznek törölhetők.
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

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION prevent_superadmin_role_changes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prevent_superadmin_role_changes() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
