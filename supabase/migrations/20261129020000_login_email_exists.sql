-- Bejelentkezéskor figyelmeztetés, ha az e-mail-cím nem létező fiókhoz tartozik.
-- A login server action sikertelen belépés után hívja (app/(public)/login/actions.ts).
--
-- Ez a migráció KIZÁRÓLAG új függvényt hoz létre, meglévő éles objektumot nem
-- módosít. Visszavonás: supabase/rollback/20261129_before_login_email_exists.sql
--
-- Biztonsági megjegyzés: a függvény lehetővé teszi, hogy bárki megtudja, egy
-- e-mail-cím regisztrált-e (felhasználó-felderítés). Ezt a megrendelő kérésére
-- vállaljuk; csak a címre ad igen/nem választ, más adatot nem.
BEGIN;

create or replace function public.login_email_exists(p_email text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(p_email))
  );
$function$;

revoke all on function public.login_email_exists(text) from public, anon, authenticated, service_role;
grant execute on function public.login_email_exists(text) to anon;
grant execute on function public.login_email_exists(text) to authenticated;
grant execute on function public.login_email_exists(text) to service_role;

-- A PostgREST sémagyorsítótárának azonnali frissítése, hogy az új függvény
-- rögtön hívható legyen.
NOTIFY pgrst, 'reload schema';

COMMIT;
