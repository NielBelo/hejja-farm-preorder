-- Supabase ingyenes csomag auto-pause elleni "ébren tartó" írás.
--
-- A Supabase a 7 napig elégtelen adatbázis-aktivitású ingyenes projektet
-- szüneteltetni kezdi, a pontos küszöböt nem dokumentálja, és közösségi
-- beszámolók szerint a puszta olvasás nem mindig elég. A Worker napi cronja
-- (worker/keepAlive.ts) ezért ebben az egysoros táblában frissíti a
-- last_ping oszlopot - ez valódi DB-írás.
--
-- Ez a migráció KIZÁRÓLAG új objektumot hoz létre (1 tábla), meglévő éles
-- objektumot nem módosít. Visszavonás:
-- supabase/rollback/20261128_before_keepalive.sql
BEGIN;

create table if not exists public.keepalive (
  -- Egyetlen sor: a check miatt más id nem szúrható be.
  id smallint primary key check (id = 1),
  last_ping timestamptz not null default now()
);

insert into public.keepalive (id) values (1) on conflict (id) do nothing;

alter table public.keepalive enable row level security;

-- Csak service_role éri el (a Worker ezzel ír); policy nincs, így anon és
-- authenticated semmit nem láthat és nem írhat.
revoke all on public.keepalive from public, anon, authenticated;
grant all on public.keepalive to service_role;

COMMIT;
