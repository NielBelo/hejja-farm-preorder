-- Csomagolásokhoz (packages) tartozó kép: az előrendelőn a leírás mellett
-- jelenik meg, felnagyítható. A képek URL-jét a
-- supabase/manual/20261128_package_images.sql állítja be.
-- Rollback: supabase/rollback/20261128_before_packages_image_url.sql
BEGIN;

ALTER TABLE public.packages ADD COLUMN image_url text;

COMMIT;
