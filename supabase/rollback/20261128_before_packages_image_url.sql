-- Rollback a 20261128000000_packages_image_url.sql migrációhoz.
BEGIN;

ALTER TABLE public.packages DROP COLUMN image_url;

COMMIT;
