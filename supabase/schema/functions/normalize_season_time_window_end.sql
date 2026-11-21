CREATE OR REPLACE FUNCTION public.normalize_season_time_window_end()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    IF NEW.time_window_end IS NOT NULL THEN
        NEW.time_window_end := (
            (NEW.time_window_end AT TIME ZONE 'Europe/Budapest')::date
            + time '23:59:59.999999'
        ) AT TIME ZONE 'Europe/Budapest';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION normalize_season_time_window_end() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION normalize_season_time_window_end() TO PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_season_time_window_end() TO anon;
GRANT EXECUTE ON FUNCTION normalize_season_time_window_end() TO authenticated;
GRANT EXECUTE ON FUNCTION normalize_season_time_window_end() TO service_role;
