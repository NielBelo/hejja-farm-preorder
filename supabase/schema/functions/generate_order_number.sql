CREATE OR REPLACE FUNCTION public.generate_order_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
    v_code text;
begin
    loop
        v_code :=
            'HF-' ||
            upper(
                substr(
                    md5(random()::text || clock_timestamp()::text),
                    1,
                    6
                )
            );

        exit when not exists (
            select 1
            from public.orders
            where public_order_number = v_code
        );
    end loop;

    return v_code;
end;
$function$;

REVOKE ALL ON FUNCTION generate_order_number() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION generate_order_number() TO PUBLIC;
GRANT EXECUTE ON FUNCTION generate_order_number() TO anon;
GRANT EXECUTE ON FUNCTION generate_order_number() TO authenticated;
GRANT EXECUTE ON FUNCTION generate_order_number() TO service_role;
