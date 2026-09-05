-- A rendelési időablak záródátuma minden esetben a kiválasztott nap
-- utolsó percét jelenti, Budapest időzónában.
BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_season_time_window_end()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.time_window_end IS NOT NULL THEN
        NEW.time_window_end := (
            (NEW.time_window_end AT TIME ZONE 'Europe/Budapest')::date
            + time '23:59:59.999999'
        ) AT TIME ZONE 'Europe/Budapest';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_season_time_window_end
ON public.season_parameters;

CREATE TRIGGER normalize_season_time_window_end
BEFORE INSERT OR UPDATE OF time_window_end
ON public.season_parameters
FOR EACH ROW
EXECUTE FUNCTION public.normalize_season_time_window_end();

-- A már létező szezonok értékeit is átvezeti a fenti szabályon.
UPDATE public.season_parameters
SET time_window_end = time_window_end
WHERE time_window_end IS NOT NULL;

COMMIT;
