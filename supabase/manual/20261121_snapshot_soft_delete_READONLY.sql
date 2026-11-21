-- KIZÁRÓLAG OLVASÁS: az átvételi nap / szezon soft delete előtti éles snapshot.
-- Egyetlen SELECT, semmit nem módosít. Supabase SQL Editorban futtatható.
--
-- Tartalom:
--  * functions:   minden public függvény, amelynek törzse a pickup_days vagy a
--                 season_parameters táblára hivatkozik (teljes definíció,
--                 SECURITY DEFINER, search_path, jogosultságok) - ezekből épül
--                 a rollback fájl és ezekbe kerül az archived_at szűrés.
--  * constraints: a pickup_days / season_parameters / orders / reminder_sends
--                 összes constraintje (FK ON DELETE akciókkal, UNIQUE, CHECK).
--  * indexes:     ugyanezen táblák indexei (partial unique index kell-e).
--  * triggers:    ugyanezen táblák nem belső triggerei.
--  * policies:    ugyanezen táblák RLS policy-jai.
--  * columns:     a pickup_days / season_parameters oszlopai.
--
-- Másold ki a "snapshot" oszlop cellájának teljes tartalmát és mentsd:
-- supabase/manual/snapshot_soft_delete.json (vagy illeszd be a chatbe).

select jsonb_pretty(jsonb_build_object(
  'functions', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'name',             p.proname,
        'identity_args',    pg_get_function_identity_arguments(p.oid),
        'returns',          pg_get_function_result(p.oid),
        'security_definer', p.prosecdef,
        'proconfig',        p.proconfig,
        'owner',            pg_get_userbyid(p.proowner),
        'grants', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'grantee',   case when a.grantee = 0 then 'PUBLIC'
                                     else pg_get_userbyid(a.grantee) end,
                   'privilege', a.privilege_type)), '[]'::jsonb)
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        ),
        'definition',       pg_get_functiondef(p.oid)
      )
      order by p.proname, pg_get_function_identity_arguments(p.oid)
    ), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (p.prosrc ilike '%pickup_days%' or p.prosrc ilike '%season_parameters%')
  ),
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', c.conrelid::regclass::text,
      'name',  c.conname,
      'def',   pg_get_constraintdef(c.oid)
    ) order by c.conrelid::regclass::text, c.conname), '[]'::jsonb)
    from pg_constraint c
    where c.conrelid in (
            'public.pickup_days'::regclass, 'public.season_parameters'::regclass,
            'public.orders'::regclass, 'public.reminder_sends'::regclass)
       or c.confrelid in ('public.pickup_days'::regclass, 'public.season_parameters'::regclass)
  ),
  'indexes', (
    select coalesce(jsonb_agg(i.indexdef order by i.tablename, i.indexname), '[]'::jsonb)
    from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename in ('pickup_days', 'season_parameters')
  ),
  'triggers', (
    select coalesce(jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname), '[]'::jsonb)
    from pg_trigger t
    where t.tgrelid in ('public.pickup_days'::regclass, 'public.season_parameters'::regclass)
      and not t.tgisinternal
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', pol.tablename, 'name', pol.policyname, 'cmd', pol.cmd,
      'roles', pol.roles, 'using', pol.qual, 'check', pol.with_check
    ) order by pol.tablename, pol.policyname), '[]'::jsonb)
    from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename in ('pickup_days', 'season_parameters')
  ),
  'columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', col.table_name, 'column', col.column_name,
      'type', col.data_type, 'nullable', col.is_nullable, 'default', col.column_default
    ) order by col.table_name, col.ordinal_position), '[]'::jsonb)
    from information_schema.columns col
    where col.table_schema = 'public'
      and col.table_name in ('pickup_days', 'season_parameters')
  )
)) as snapshot;
