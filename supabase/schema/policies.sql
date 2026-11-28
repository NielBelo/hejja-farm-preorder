ALTER TABLE public.deleted_users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.keepalive ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.order_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.page_contents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pickup_days ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.registration_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reminder_sends ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.season_launch_sends ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.season_parameters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.season_product_prices ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view deleted users" ON public.deleted_users AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::text)))));

CREATE POLICY "Admins can view all order items" ON public.order_items AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::text)))));

CREATE POLICY "Admins can view all order versions" ON public.order_versions AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::text)))));

CREATE POLICY "Admins can view all orders" ON public.orders AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::text)))));

CREATE POLICY "Admins can view all profiles" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::text)))));

CREATE POLICY "Users can create own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));

CREATE POLICY "Users can delete own profile" ON public.profiles AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = id));

CREATE POLICY "Users can read own consents" ON public.user_consents AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can read own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = id));

CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));

CREATE POLICY "Users can view items of own orders" ON public.order_items AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (order_versions ov
     JOIN orders o ON ((o.id = ov.order_id)))
  WHERE ((ov.id = order_items.order_version_id) AND (o.user_id = auth.uid())))));

CREATE POLICY "Users can view own orders" ON public.orders AS PERMISSIVE FOR SELECT TO authenticated USING (((auth.uid() = user_id) AND (archived_at IS NULL)));

CREATE POLICY "Users can view own role" ON public.user_roles AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

CREATE POLICY "Users can view versions of own orders" ON public.order_versions AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM orders
  WHERE ((orders.id = order_versions.order_id) AND (orders.user_id = auth.uid())))));

CREATE POLICY view_right ON public.packages AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY view_right ON public.page_contents AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY view_right ON public.pickup_days AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY view_right ON public.products AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY view_right ON public.season_parameters AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY view_right ON public.season_product_prices AS PERMISSIVE FOR SELECT TO public USING (true);
