-- Rollback a 20261129010000_county_wording.sql migrációhoz (előző szövegek).
BEGIN;

CREATE OR REPLACE FUNCTION public.finalize_order(p_season_parameter_id bigint, p_pickup_day_id bigint, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid;
    v_user_county text;
    v_is_bacskiskun boolean;

    v_season_year integer;
    v_season_name text;
    v_season_is_active boolean;
    v_time_window_start timestamptz;
    v_time_window_end timestamptz;

    v_effective_pickup_day_id bigint;
    v_pickup_year integer;
    v_pickup_season text;
    v_pickup_is_active boolean;
    v_pickup_kind text;
    v_available_stock integer;

    v_total_quantity integer;

    v_order_id bigint;
    v_order_version_id bigint;
    v_public_order_number text;

begin
    ------------------------------------------------------------
    -- 1. Bejelentkezett felhasználó ellenőrzése
    ------------------------------------------------------------
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'A rendelés leadásához bejelentkezés szükséges.';
    end if;


    ------------------------------------------------------------
    -- 2. Legalább egy rendelési tétel szükséges
    ------------------------------------------------------------
    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then

        raise exception
            'A rendelés nem tartalmaz rendelési tételt.';
    end if;


    ------------------------------------------------------------
    -- 3. Teljes rendelt mennyiség kiszámítása
    ------------------------------------------------------------
    select sum((item->>'quantity')::integer)
    into v_total_quantity
    from jsonb_array_elements(p_items) as item;

    if v_total_quantity is null
       or v_total_quantity <= 0 then

        raise exception
            'A rendelt mennyiség hibás.';
    end if;


    ------------------------------------------------------------
    -- 4. Szezon adatainak lekérése
    ------------------------------------------------------------
    select
        year,
        season,
        is_active,
        time_window_start,
        time_window_end
    into
        v_season_year,
        v_season_name,
        v_season_is_active,
        v_time_window_start,
        v_time_window_end
    from public.season_parameters
    where id = p_season_parameter_id;

    if not found then
        raise exception
            'A kiválasztott szezon nem létezik.';
    end if;


    ------------------------------------------------------------
    -- 5. Szezon aktivitásának ellenőrzése
    ------------------------------------------------------------
    if v_season_is_active is not true then
        raise exception
            'A kiválasztott szezon nem aktív.';
    end if;


    ------------------------------------------------------------
    -- 6. Rendelési időablak beállításának ellenőrzése
    ------------------------------------------------------------
    if v_time_window_start is null
       or v_time_window_end is null then

        raise exception
            'A rendelési időszak nincs megfelelően beállítva.';
    end if;


    ------------------------------------------------------------
    -- 7. Rendelési időablak ellenőrzése
    ------------------------------------------------------------
    if now() < v_time_window_start then
        raise exception
            'A rendelési időszak még nem kezdődött el.';
    end if;

    if now() > v_time_window_end then
        raise exception
            'A rendelési időszak már lezárult.';
    end if;


    ------------------------------------------------------------
    -- 7/A. Bács-Kiskun vármegyei vásárló felismerése (ÚJ)
    --
    -- Strukturált profiladatból, nem a kliens által beküldött
    -- pickup_day_id-ből: ez akadályozza meg, hogy egy tetszőleges
    -- pickup_day_id beküldésével bárki megkerülje a DUNAVECSE technikai
    -- nap jogosultsági ellenőrzését.
    ------------------------------------------------------------
    select trim(county) into v_user_county
    from public.profiles
    where id = v_user_id;

    v_is_bacskiskun := v_user_county = 'Bács-Kiskun';


    ------------------------------------------------------------
    -- 7/B. A ténylegesen használt átvételi nap meghatározása (ÚJ)
    --
    -- Bács-Kiskun vármegyei vásárlónál a kliens által küldött
    -- p_pickup_day_id-t figyelmen kívül hagyjuk, és mindig a szezon saját
    -- DUNAVECSE napjához rendeljük a rendelést.
    ------------------------------------------------------------
    if v_is_bacskiskun then
        select id into v_effective_pickup_day_id
        from public.pickup_days
        where season_parameter_id = p_season_parameter_id
          and kind = 'dunavecse';

        if not found then
            raise exception
                'A kiválasztott szezonhoz jelenleg nem tartozik Bács-Kiskun (DUNAVECSE) átvételi nap. Kérjük, forduljon az adminisztrátorhoz.';
        end if;
    else
        v_effective_pickup_day_id := p_pickup_day_id;
    end if;


    ------------------------------------------------------------
    -- 8. Átvételi nap zárolása és adatainak lekérése
    ------------------------------------------------------------
    select
        year,
        season,
        is_active,
        kind,
        available_stock
    into
        v_pickup_year,
        v_pickup_season,
        v_pickup_is_active,
        v_pickup_kind,
        v_available_stock
    from public.pickup_days
    where id = v_effective_pickup_day_id
    for update;

    if not found then
        raise exception
            'A kiválasztott átvételi nap nem létezik.';
    end if;


    ------------------------------------------------------------
    -- 8/A. DUNAVECSE jogosultság ellenőrzése (ÚJ)
    --
    -- Nem Bács-Kiskun vármegyei vásárló nem rendelhet a DUNAVECSE
    -- technikai napra, és fordítva - a második eset a 7/B lépés miatt a
    -- gyakorlatban nem fordulhat elő, de védelmi rétegként itt is
    -- ellenőrizzük.
    ------------------------------------------------------------
    if v_pickup_kind = 'dunavecse' and not v_is_bacskiskun then
        raise exception
            'A kiválasztott átvételi nap csak Bács-Kiskun vármegyei vásárlók számára elérhető.';
    end if;

    if v_pickup_kind = 'normal' and v_is_bacskiskun then
        raise exception
            'Bács-Kiskun vármegyei vásárlóként nem választható egyedi átvételi nap; a rendelés automatikusan a szezon vágási napjához kerül.';
    end if;


    ------------------------------------------------------------
    -- 9. Átvételi nap aktivitásának ellenőrzése
    ------------------------------------------------------------
    if v_pickup_is_active is not true then
        if v_is_bacskiskun then
            raise exception
                'A jelenlegi szezonban átmenetileg nem lehetséges rendelést leadni Bács-Kiskun vármegyei vásárlóként. Kérjük, próbálja meg később, vagy keresse az adminisztrátort.';
        end if;

        raise exception
            'A kiválasztott átvételi nap már nem aktív.';
    end if;


    ------------------------------------------------------------
    -- 10. Átvételi nap és szezon összetartozásának ellenőrzése
    ------------------------------------------------------------
    if v_pickup_year <> v_season_year
       or v_pickup_season is distinct from v_season_name then

        raise exception
            'A kiválasztott átvételi nap nem tartozik az aktuális szezonhoz.';
    end if;


    ------------------------------------------------------------
    -- 11. Aktuális készlet ellenőrzése
    --
    -- A DUNAVECSE technikai napra nem vonatkozik semmilyen
    -- készletellenőrzés - a kapacitása korlátlan.
    ------------------------------------------------------------
    if v_pickup_kind = 'normal' then
        if v_available_stock is null
           or v_available_stock < v_total_quantity then

            raise exception
                'A háttérben készlet változás történt! Elérhető: % db, igényelt: % db!',
                coalesce(v_available_stock, 0),
                v_total_quantity;
        end if;
    end if;


    ------------------------------------------------------------
    -- 12. Rendelés fejléc létrehozása
    ------------------------------------------------------------
    insert into public.orders (
        user_id,
        season_parameter_id,
        pickup_day_id,
        public_order_number
    )
    values (
        v_user_id,
        p_season_parameter_id,
        v_effective_pickup_day_id,
        public.generate_order_number()
    )
    returning
        id,
        public_order_number
    into
        v_order_id,
        v_public_order_number;


    ------------------------------------------------------------
    -- 13. Első rendelésverzió létrehozása
    ------------------------------------------------------------
    insert into public.order_versions (
        order_id,
        version_number,
        change_type,
        created_by
    )
    values (
        v_order_id,
        1,
        'created',
        v_user_id
    )
    returning id
    into v_order_version_id;


    ------------------------------------------------------------
    -- 14. Rendelési tételek létrehozása
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
        v_order_version_id,
        (item->>'product_id')::bigint,
        (item->>'package_id')::bigint,
        (item->>'quantity')::integer,
        item->>'size_preference',
        nullif(item->>'note', '')
    from jsonb_array_elements(p_items) as item;


    ------------------------------------------------------------
    -- 15. Aktuális rendelésverzió beállítása
    ------------------------------------------------------------
    update public.orders
    set current_version_id = v_order_version_id
    where id = v_order_id;


    ------------------------------------------------------------
    -- 16. Készlet csökkentése
    --
    -- A DUNAVECSE technikai nap kapacitása korlátlan, ezért ide sosem
    -- kerül készletcsökkentés.
    ------------------------------------------------------------
    if v_pickup_kind = 'normal' then
        update public.pickup_days
        set available_stock =
            available_stock - v_total_quantity
        where id = v_effective_pickup_day_id;
    end if;


    ------------------------------------------------------------
    -- 17. Publikus rendelésszám visszaadása
    ------------------------------------------------------------
    return v_public_order_number;

end;
$function$;

REVOKE ALL ON FUNCTION finalize_order(bigint,bigint,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION finalize_order(bigint,bigint,jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_order(bigint,bigint,jsonb) TO anon;
GRANT EXECUTE ON FUNCTION finalize_order(bigint,bigint,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION finalize_order(bigint,bigint,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.update_admin_account_profile(target_user_id uuid, profile_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  field_name text;
  requested_role text;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Adminisztrátori jogosultság szükséges.' using errcode = '42501';
  end if;

  foreach field_name in array array['first_name', 'last_name', 'phone', 'county', 'city'] loop
    if jsonb_typeof(profile_data -> field_name) is distinct from 'string'
      or length(trim(profile_data ->> field_name)) > 100 then
      raise exception 'Érvénytelen személyes adatok.' using errcode = '22023';
    end if;
  end loop;

  if trim(profile_data ->> 'first_name') = '' or trim(profile_data ->> 'last_name') = ''
    or trim(profile_data ->> 'county') = '' or trim(profile_data ->> 'city') = ''
    or (profile_data ->> 'phone') !~ '^\+36[0-9]{9}$' then
    raise exception 'Hiányzó név, vármegye, település vagy érvénytelen telefonszám.' using errcode = '22023';
  end if;

  requested_role := profile_data ->> 'role';
  if requested_role not in ('user', 'admin') then
    raise exception 'Érvénytelen jogosultsági beállítás.' using errcode = '22023';
  end if;

  update public.profiles set
    first_name = trim(profile_data ->> 'first_name'),
    last_name = trim(profile_data ->> 'last_name'),
    phone = profile_data ->> 'phone',
    county = trim(profile_data ->> 'county'),
    city = trim(profile_data ->> 'city')
  where id = target_user_id;
  if not found then
    raise exception 'A felhasználó személyes adatlapja nem található.' using errcode = 'P0002';
  end if;

  insert into public.user_roles (user_id, role)
  values (target_user_id, case when requested_role = 'admin' then 'admin' else 'user' end)
  on conflict (user_id) do update set role = excluded.role;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION update_admin_account_profile(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_admin_account_profile(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION update_admin_account_profile(uuid,jsonb) TO service_role;

COMMIT;
