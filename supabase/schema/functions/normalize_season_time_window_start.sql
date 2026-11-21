CREATE OR REPLACE FUNCTION public.normalize_season_time_window_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    IF NEW.time_window_start IS NOT NULL THEN
        NEW.time_window_start := (
            (NEW.time_window_start AT TIME ZONE 'Europe/Budapest')::date
            + time '00:00:00'
        ) AT TIME ZONE 'Europe/Budapest';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION normalize_season_time_window_start() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION normalize_season_time_window_start() TO PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_season_time_window_start() TO anon;
GRANT EXECUTE ON FUNCTION normalize_season_time_window_start() TO authenticated;
GRANT EXECUTE ON FUNCTION normalize_season_time_window_start() TO service_role;
