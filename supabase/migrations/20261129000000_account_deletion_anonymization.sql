-- Fióktörlés személyes adatok eltávolításával, a rendelések anonimizált
-- megőrzésével (statisztika), és a törölt felhasználók nevének/idejének
-- naplózásával.
--
-- Módosított éles objektumok:
--   - public.orders.user_id: NOT NULL megszűnik, FK ON DELETE CASCADE -> SET NULL
--   - public.delete_admin_account(uuid): lecserélve (eddig mindent törölt)
--   - public.update_order(bigint, jsonb, bigint): a tulajdonos-ellenőrzés NULL-biztos
--     (IS DISTINCT FROM), mert a user_id mostantól NULL lehet
-- Új objektumok: public.deleted_users, anonymize_and_delete_user(uuid, text),
--   delete_own_account(), purge_expired_deleted_users()
-- Visszavonás: supabase/rollback/20261129_before_account_deletion_anonymization.sql
BEGIN;

-- 1) A rendelések a felhasználó törlése után user_id nélkül maradnak meg.
alter table public.orders alter column user_id drop not null;
alter table public.orders drop constraint orders_user_id_fkey;
alter table public.orders
  add constraint orders_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- 2) Törölt felhasználók naplója: csak név + időpont + forrás. Nincs e-mail,
-- telefon vagy eredeti user-id. 3 év után a purge függvény törli.
create table public.deleted_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  deleted_at timestamptz not null default now(),
  deletion_source text not null check (deletion_source in ('admin', 'self'))
);

alter table public.deleted_users enable row level security;

create policy "Admins can view deleted users" on public.deleted_users
  as permissive for select to authenticated
  using (exists (
    select 1 from public.user_roles
    where user_roles.user_id = auth.uid() and user_roles.role = 'admin'
  ));

revoke all on table public.deleted_users from public, anon, authenticated, service_role;
grant select on table public.deleted_users to authenticated;
grant select, delete on table public.deleted_users to service_role;

-- 3) Közös belső függvény. Nem hívható közvetlenül klienstől.
create or replace function public.anonymize_and_delete_user(target_user_id uuid, source text)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  target_email text;
  target_name text;
begin
  if source not in ('admin', 'self') then
    raise exception 'Érvénytelen törlési forrás.' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_roles where user_id = target_user_id and is_superadmin) then
    raise exception 'A superadmin fiókja nem törölhető.' using errcode = '42501';
  end if;

  select email into target_email from auth.users where id = target_user_id for update;
  if not found then raise exception 'A felhasználó nem található.' using errcode = 'P0002'; end if;

  -- Aktív, még le nem zajlott (mai vagy jövőbeli) átvételi napú rendelés
  -- mellett nem törlünk: előbb le kell mondani. Ugyanaz a határ, mint a
  -- cancel_order-ben.
  if exists (
    select 1
    from public.orders o
    join public.pickup_days pd on pd.id = o.pickup_day_id
    where o.user_id = target_user_id
      and o.status = 'submitted'
      and o.archived_at is null
      and pd.pickup_date >= (clock_timestamp() at time zone 'Europe/Budapest')::date
  ) then
    raise exception 'A fiók nem törölhető, amíg aktív, még le nem zajlott átvételi napra szóló rendelés tartozik hozzá. Előbb mondja le a rendeléseket.' using errcode = 'P0001';
  end if;

  select nullif(trim(concat_ws(' ', last_name, first_name)), '') into target_name
  from public.profiles where id = target_user_id;

  insert into public.deleted_users (full_name, deletion_source)
  values (coalesce(target_name, 'Ismeretlen név'), source);

  -- Rendelések anonimizálása: a jegyzet szabad szöveg, személyes adatot
  -- tartalmazhat, ezért kiürítjük. A user_id az FK SET NULL-ja miatt a
  -- felhasználó törlésekor nullázódik.
  update public.order_items oi set note = null
  from public.order_versions ov, public.orders o
  where oi.order_version_id = ov.id and ov.order_id = o.id and o.user_id = target_user_id;

  delete from public.user_consents where user_id = target_user_id;
  delete from public.registration_invites where used_by_user_id = target_user_id or lower(email) = lower(target_email);
  delete from public.season_launch_sends where user_id = target_user_id;
  delete from public.user_roles where user_id = target_user_id;
  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
  return true;
end;
$function$;

revoke all on function public.anonymize_and_delete_user(uuid, text) from public, anon, authenticated, service_role;

-- 4) Admin törlés (a régi, mindent törlő függvény helyett).
create or replace function public.delete_admin_account(target_user_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not exists (select 1 from public.user_roles where user_id = caller and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;
  if target_user_id is null or target_user_id = caller then
    raise exception 'A saját fiók nem törölhető.' using errcode = '22023';
  end if;
  return public.anonymize_and_delete_user(target_user_id, 'admin');
end;
$function$;

revoke all on function public.delete_admin_account(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_admin_account(uuid) to authenticated;
grant execute on function public.delete_admin_account(uuid) to service_role;

-- 5) Saját fiók törlése.
create or replace function public.delete_own_account()
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'A fiók törléséhez jelentkezzen be.' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_roles where user_id = caller and role = 'admin') then
    raise exception 'Adminisztrátori fiók nem törölhető saját kezűleg.' using errcode = '42501';
  end if;
  return public.anonymize_and_delete_user(caller, 'self');
end;
$function$;

revoke all on function public.delete_own_account() from public, anon, authenticated, service_role;
grant execute on function public.delete_own_account() to authenticated;
grant execute on function public.delete_own_account() to service_role;

-- 6) A 3 évnél régebbi napló sorok törlése (a Worker napi cronja hívja).
create or replace function public.purge_expired_deleted_users()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  removed integer;
begin
  delete from public.deleted_users where deleted_at < now() - interval '3 years';
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

revoke all on function public.purge_expired_deleted_users() from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_deleted_users() to service_role;


-- 7) update_order: a tulajdonos-ellenőrzés NULL-biztos (IS DISTINCT FROM).
-- A korábbi "<>" NULL user_id-nál NULL-t adott, és átengedte a nem admin
-- hívót. Egyetlen sor változik, a függvény többi része azonos a tükörrel.

CREATE OR REPLACE FUNCTION public.update_order(p_order_id bigint, p_items jsonb, p_pickup_day_id bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid;
    v_is_admin boolean := false;

    v_order_user_id uuid;
    v_season_parameter_id bigint;
    v_old_pickup_day_id bigint;
    v_old_pickup_kind text;
    v_new_pickup_day_id bigint;
    v_new_pickup_kind text;
    v_current_version_id bigint;
    v_public_order_number text;
    v_order_status text;

    v_time_window_start timestamptz;
    v_time_window_end timestamptz;

    v_old_pickup_date timestamp without time zone;
    v_old_available_stock integer;

    v_new_pickup_date timestamp without time zone;
    v_new_available_stock integer;

    v_pickup_day_changed boolean;

    v_old_total_quantity integer;
    v_new_total_quantity integer;
    v_quantity_difference integer;

    v_new_version_number integer;
    v_new_order_version_id bigint;

begin
    ------------------------------------------------------------
    -- 1. Bejelentkezett felhasználó ellenőrzése
    ------------------------------------------------------------
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'A rendelés módosításához bejelentkezés szükséges.';
    end if;


    ------------------------------------------------------------
    -- 2. Admin jogosultság meghatározása
    ------------------------------------------------------------
    select exists (
        select 1
        from public.user_roles
        where user_id = v_user_id
          and role = 'admin'
    )
    into v_is_admin;


    ------------------------------------------------------------
    -- 3. Legalább egy rendelési tétel szükséges
    ------------------------------------------------------------
    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then

        raise exception
            'A rendelés nem tartalmaz rendelési tételt.';
    end if;


    ------------------------------------------------------------
    -- 4. Új teljes rendelt mennyiség kiszámítása
    ------------------------------------------------------------
    select sum((item->>'quantity')::integer)
    into v_new_total_quantity
    from jsonb_array_elements(p_items) as item;

    if v_new_total_quantity is null
       or v_new_total_quantity <= 0 then

        raise exception
            'A rendelt mennyiség hibás.';
    end if;


    ------------------------------------------------------------
    -- 5. Rendelés zárolása és adatainak lekérése
    ------------------------------------------------------------
    select
        user_id,
        season_parameter_id,
        pickup_day_id,
        current_version_id,
        public_order_number,
        status
    into
        v_order_user_id,
        v_season_parameter_id,
        v_old_pickup_day_id,
        v_current_version_id,
        v_public_order_number,
        v_order_status
    from public.orders
    where id = p_order_id
      and archived_at is null
    for update;

    if not found then
        raise exception
            'A módosítandó rendelés nem létezik.';
    end if;

    select kind into v_old_pickup_kind
    from public.pickup_days
    where id = v_old_pickup_day_id;

    -- DUNAVECSE rendelésnél az átvételi nap sosem módosítható - a kliens
    -- által esetlegesen küldött p_pickup_day_id-t figyelmen kívül hagyjuk,
    -- ezzel sem a vásárló, sem az admin nem tudja (akár véletlenül sem)
    -- másik napra áthelyezni.
    v_new_pickup_day_id := case
        when v_old_pickup_kind = 'dunavecse' then v_old_pickup_day_id
        else coalesce(p_pickup_day_id, v_old_pickup_day_id)
    end;
    v_pickup_day_changed := v_new_pickup_day_id <> v_old_pickup_day_id;


    ------------------------------------------------------------
    -- 6. Jogosultság ellenőrzése
    --
    -- Normál felhasználó csak a saját rendelését módosíthatja.
    -- Admin bármely felhasználó rendelését módosíthatja.
    ------------------------------------------------------------
    if v_order_user_id is distinct from v_user_id
       and not v_is_admin then

        raise exception
            'Nincs jogosultsága ennek a rendelésnek a módosításához.';
    end if;


    ------------------------------------------------------------
    -- 7. Rendelés státuszának ellenőrzése
    ------------------------------------------------------------
    if v_order_status <> 'submitted' then
        raise exception
            'Ez a rendelés már nem módosítható.';
    end if;


    ------------------------------------------------------------
    -- 8. Aktuális rendelésverzió ellenőrzése
    ------------------------------------------------------------
    if v_current_version_id is null then
        raise exception
            'A rendelés aktuális verziója nem található.';
    end if;


    ------------------------------------------------------------
    -- 9. Átvételi nap(ok) zárolása és készlet lekérése
    --
    -- Napváltás esetén mindkét érintett napot zároljuk, mindig a
    -- kisebb id-jű sorral kezdve, hogy két párhuzamos, egymással
    -- ellentétes irányú napváltás ne okozzon holtpontot (deadlock).
    -- DUNAVECSE rendelésnél v_pickup_day_changed a fenti lépés miatt
    -- mindig false, ezért ez mindig a "nincs napváltás" ágon fut le.
    ------------------------------------------------------------
    if not v_pickup_day_changed then

        select available_stock, pickup_date
        into v_old_available_stock, v_old_pickup_date
        from public.pickup_days
        where id = v_old_pickup_day_id
        for update;

        if not found then
            raise exception
                'A rendeléshez tartozó átvételi nap nem létezik.';
        end if;

    elsif v_old_pickup_day_id < v_new_pickup_day_id then

        select available_stock, pickup_date
        into v_old_available_stock, v_old_pickup_date
        from public.pickup_days
        where id = v_old_pickup_day_id
        for update;

        if not found then
            raise exception
                'A rendeléshez tartozó átvételi nap nem létezik.';
        end if;

        select available_stock, pickup_date, kind
        into v_new_available_stock, v_new_pickup_date, v_new_pickup_kind
        from public.pickup_days
        where id = v_new_pickup_day_id
        for update;

        if not found then
            raise exception
                'A kiválasztott új átvételi nap nem létezik.';
        end if;

        if v_new_pickup_kind = 'dunavecse' then
            raise exception
                'A DUNAVECSE technikai nap nem választható átvételi napként.';
        end if;

    else

        select available_stock, pickup_date, kind
        into v_new_available_stock, v_new_pickup_date, v_new_pickup_kind
        from public.pickup_days
        where id = v_new_pickup_day_id
        for update;

        if not found then
            raise exception
                'A kiválasztott új átvételi nap nem létezik.';
        end if;

        if v_new_pickup_kind = 'dunavecse' then
            raise exception
                'A DUNAVECSE technikai nap nem választható átvételi napként.';
        end if;

        select available_stock, pickup_date
        into v_old_available_stock, v_old_pickup_date
        from public.pickup_days
        where id = v_old_pickup_day_id
        for update;

        if not found then
            raise exception
                'A rendeléshez tartozó átvételi nap nem létezik.';
        end if;

    end if;


    ------------------------------------------------------------
    -- 10. Elmúlt átvételi nap ellenőrzése
    --
    -- A jelenlegi (régi) átvétel napján még módosítható a rendelés,
    -- a következő naptól mindenki számára lezárt. Napváltás esetén
    -- az új nap sem eshet a múltba.
    ------------------------------------------------------------
    if v_old_pickup_date::date < current_date then
        raise exception
            'Az átvételi nap már elmúlt, a rendelés nem módosítható.';
    end if;

    if v_pickup_day_changed
       and v_new_pickup_date::date < current_date then

        raise exception
            'A kiválasztott új átvételi nap már elmúlt.';
    end if;


    ------------------------------------------------------------
    -- 11. Normál felhasználónál rendelési időablak ellenőrzése
    --
    -- Admin esetén ezt teljesen kihagyjuk.
    ------------------------------------------------------------
    if not v_is_admin then

        select
            time_window_start,
            time_window_end
        into
            v_time_window_start,
            v_time_window_end
        from public.season_parameters
        where id = v_season_parameter_id;

        if not found then
            raise exception
                'A rendeléshez tartozó szezon nem található.';
        end if;


        if v_time_window_start is null
           or v_time_window_end is null then

            raise exception
                'A rendelési időszak nincs megfelelően beállítva.';
        end if;


        if now() < v_time_window_start then
            raise exception
                'A rendelési időszak még nem kezdődött el.';
        end if;


        if now() > v_time_window_end then
            raise exception
                'A rendelési időszak már lezárult, a rendelés nem módosítható.';
        end if;

    end if;


    ------------------------------------------------------------
    -- 12. Régi teljes rendelt mennyiség meghatározása
    ------------------------------------------------------------
    select coalesce(sum(quantity), 0)
    into v_old_total_quantity
    from public.order_items
    where order_version_id = v_current_version_id;


    ------------------------------------------------------------
    -- 13. Készlet ellenőrzése
    --
    -- A DUNAVECSE technikai napra nem vonatkozik semmilyen
    -- készletellenőrzés - a kapacitása korlátlan. Azonos (normál) napon
    -- maradva csak a mennyiségi növekményre van szükség (a meglévő
    -- foglalás a helyén marad). Napváltáskor a teljes új mennyiségre van
    -- szükség az új napon, hiszen ott a rendelésnek jelenleg semmilyen
    -- foglalása nincs.
    ------------------------------------------------------------
    if v_old_pickup_kind = 'dunavecse' then

        null;

    elsif not v_pickup_day_changed then

        v_quantity_difference := v_new_total_quantity - v_old_total_quantity;

        if v_quantity_difference > 0
           and (v_old_available_stock is null
                or v_old_available_stock < v_quantity_difference) then

            raise exception
                'A háttérben készlet változás történt! Elérhető: % db, további igény: % db!',
                coalesce(v_old_available_stock, 0),
                v_quantity_difference;
        end if;

    else

        if v_new_available_stock is null
           or v_new_available_stock < v_new_total_quantity then

            raise exception
                'A kiválasztott átvételi napon nincs elegendő készlet a rendeléshez! Elérhető: % db, igény: % db!',
                coalesce(v_new_available_stock, 0),
                v_new_total_quantity;
        end if;

    end if;


    ------------------------------------------------------------
    -- 14. Következő verziószám meghatározása
    ------------------------------------------------------------
    select coalesce(max(version_number), 0) + 1
    into v_new_version_number
    from public.order_versions
    where order_id = p_order_id;


    ------------------------------------------------------------
    -- 15. Új rendelésverzió létrehozása
    ------------------------------------------------------------
    insert into public.order_versions (
        order_id,
        version_number,
        change_type,
        created_by
    )
    values (
        p_order_id,
        v_new_version_number,
        'modified',
        v_user_id
    )
    returning id
    into v_new_order_version_id;


    ------------------------------------------------------------
    -- 16. Új verzió rendelési tételeinek létrehozása
    ------------------------------------------------------------
    insert into public.order_items (
        order_version_id,
        product_id,
        package_id,
        quantity,
        size_preference,
        note
    )
    select
        v_new_order_version_id,
        (item->>'product_id')::bigint,
        (item->>'package_id')::bigint,
        (item->>'quantity')::integer,
        item->>'size_preference',
        nullif(item->>'note', '')
    from jsonb_array_elements(p_items) as item;


    ------------------------------------------------------------
    -- 17. Rendelés aktuális verziójának (és szükség esetén az
    -- átvételi napjának) átállítása
    ------------------------------------------------------------
    update public.orders
    set current_version_id = v_new_order_version_id,
        pickup_day_id = v_new_pickup_day_id
    where id = p_order_id;


    ------------------------------------------------------------
    -- 18. Készlet korrigálása
    --
    -- A DUNAVECSE technikai nap kapacitása korlátlan, ezért ide sosem
    -- kerül készletkorrekció.
    ------------------------------------------------------------
    if v_old_pickup_kind = 'dunavecse' then

        null;

    elsif not v_pickup_day_changed then

        update public.pickup_days
        set available_stock = available_stock - v_quantity_difference
        where id = v_old_pickup_day_id;

    else

        update public.pickup_days
        set available_stock = available_stock + v_old_total_quantity
        where id = v_old_pickup_day_id;

        update public.pickup_days
        set available_stock = available_stock - v_new_total_quantity
        where id = v_new_pickup_day_id;

    end if;


    ------------------------------------------------------------
    -- 19. Publikus rendelésszám visszaadása
    ------------------------------------------------------------
    return v_public_order_number;

end;
$function$;

REVOKE ALL ON FUNCTION update_order(bigint,jsonb,bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_order(bigint,jsonb,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION update_order(bigint,jsonb,bigint) TO service_role;


COMMIT;
