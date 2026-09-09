-- Fiók / Szerkesztés adatforrása. A registration_invites.sql után futtatandó.
-- Csak a szükséges mezőket adja vissza: jelszó, token és auth-metaadat nincs a válaszban.
create or replace function public.get_admin_accounts(page_offset integer default 0, page_size integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  return (
    with accounts as (
      select u.id::text as id, u.id as user_id, u.email,
        p.first_name, p.last_name, p.phone, p.county, p.city,
        coalesce((select r.role::text from public.user_roles r where r.user_id = u.id limit 1), 'user') as role,
        case when u.email_confirmed_at is null then 'unconfirmed' else 'registered' end as status,
        u.created_at as registered_at, u.updated_at, u.email_confirmed_at,
        u.last_sign_in_at, u.invited_at, u.confirmation_sent_at,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id, 'email', i.email, 'created_at', i.created_at,
          'sent_at', i.sent_at, 'used_at', i.used_at
        ) order by i.created_at), '[]'::jsonb)
        from public.registration_invites i where i.used_by_user_id = u.id
          or (i.used_by_user_id is null and i.email = lower(u.email))) as invites,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'document_type', c.document_type,
          'document_version', c.document_version, 'accepted_at', c.accepted_at
        ) order by c.accepted_at), '[]'::jsonb)
        from public.user_consents c where c.user_id = u.id) as consents
      from auth.users u
      left join public.profiles p on p.id = u.id
      union all
      select 'invite:' || i.email, null::uuid, i.email,
        null, null, null, null, null, 'user', 'invited',
        null::timestamptz, null::timestamptz, null::timestamptz,
        null::timestamptz, null::timestamptz, null::timestamptz,
        jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email,
          'created_at', i.created_at, 'sent_at', i.sent_at, 'used_at', i.used_at)
          order by i.created_at), '[]'::jsonb
      from public.registration_invites i
      where i.used_by_user_id is null
        and not exists (select 1 from auth.users u where lower(u.email) = i.email)
      group by i.email
    )
    select coalesce(jsonb_agg(to_jsonb(page) order by page.id), '[]'::jsonb)
    from (select * from accounts order by id
      limit greatest(1, least(page_size, 200)) offset greatest(0, page_offset)) page
  );
end;
$$;

revoke all on function public.get_admin_accounts(integer, integer) from public, anon;
grant execute on function public.get_admin_accounts(integer, integer) to authenticated;

-- Az új függvény és paraméterei azonnal kerüljenek be a REST API sémagyorsítótárába.
notify pgrst, 'reload schema';
