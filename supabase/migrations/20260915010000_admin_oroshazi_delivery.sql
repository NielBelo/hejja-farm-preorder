-- Admin-only privilege: Orosházi kiszállítás.
-- The account-list RPC is wrapped to preserve its existing data while adding
-- the new profile flag without exposing it on non-admin application pages.

alter table public.profiles
  add column if not exists oroshazi_delivery boolean not null default false;

alter function public.get_admin_accounts(integer, integer)
  rename to get_admin_accounts_without_oroshazi_delivery;

create function public.get_admin_accounts(page_offset integer default 0, page_size integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  accounts jsonb;
begin
  accounts := public.get_admin_accounts_without_oroshazi_delivery(page_offset, page_size);
  return coalesce((
    select jsonb_agg(account || jsonb_build_object(
      'oroshazi_delivery', coalesce((
        select p.oroshazi_delivery
        from public.profiles p
        where p.id = nullif(account ->> 'user_id', '')::uuid
      ), false)
    ) order by account ->> 'id')
    from jsonb_array_elements(accounts) account
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_admin_accounts(integer, integer) from public, anon;
grant execute on function public.get_admin_accounts(integer, integer) to authenticated;

create or replace function public.update_admin_oroshazi_delivery(target_user_id uuid, enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  update public.profiles
  set oroshazi_delivery = enabled
  where id = target_user_id;

  if not found then
    raise exception 'A felhasználó személyes adatlapja nem található.' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on function public.update_admin_oroshazi_delivery(uuid, boolean) from public, anon;
grant execute on function public.update_admin_oroshazi_delivery(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
