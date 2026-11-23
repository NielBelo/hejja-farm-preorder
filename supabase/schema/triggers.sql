CREATE TRIGGER normalize_season_time_window_end BEFORE INSERT OR UPDATE OF time_window_end ON public.season_parameters FOR EACH ROW EXECUTE FUNCTION normalize_season_time_window_end();

CREATE TRIGGER normalize_season_time_window_start BEFORE INSERT OR UPDATE OF time_window_start ON public.season_parameters FOR EACH ROW EXECUTE FUNCTION normalize_season_time_window_start();

CREATE TRIGGER on_invited_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_invited_user_registration();

CREATE TRIGGER protect_superadmin_profile BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_superadmin_profile_deletion();

CREATE TRIGGER protect_superadmin_role BEFORE DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION prevent_superadmin_role_changes();

CREATE TRIGGER trg_enforce_daily_size_limit BEFORE INSERT OR UPDATE OF pickup_day_id, current_version_id ON public.orders FOR EACH ROW EXECUTE FUNCTION enforce_daily_size_limit();

CREATE TRIGGER trg_enforce_pickup_day_active BEFORE INSERT OR UPDATE OF pickup_day_id, current_version_id ON public.orders FOR EACH ROW EXECUTE FUNCTION enforce_pickup_day_active();

