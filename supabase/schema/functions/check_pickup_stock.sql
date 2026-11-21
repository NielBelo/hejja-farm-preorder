CREATE OR REPLACE FUNCTION public.check_pickup_stock(p_pickup_day_id bigint, p_requested_quantity integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
    v_available_stock integer;
begin
    -- Az adott átvételi nap sorának zárolása
    select available_stock
    into v_available_stock
    from public.pickup_days
    where id = p_pickup_day_id
    for update;

    -- Nem létező átvételi nap
    if not found then
        raise exception 'A kiválasztott átvételi nap nem létezik.';
    end if;

    -- Hibás mennyiség
    if p_requested_quantity <= 0 then
        raise exception 'A rendelt mennyiségnek legalább 1 db-nak kell lennie.';
    end if;

    -- Nincs elegendő készlet
    if v_available_stock is null
       or v_available_stock < p_requested_quantity then
        raise exception
            'Nincs elegendő készlet. Elérhető: % db, igényelt: % db.',
            coalesce(v_available_stock, 0),
            p_requested_quantity;
    end if;

    -- Egyelőre csak visszaadjuk az aktuális készletet.
    return v_available_stock;
end;
$function$;

REVOKE ALL ON FUNCTION check_pickup_stock(bigint,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_pickup_stock(bigint,integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION check_pickup_stock(bigint,integer) TO anon;
GRANT EXECUTE ON FUNCTION check_pickup_stock(bigint,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION check_pickup_stock(bigint,integer) TO service_role;
