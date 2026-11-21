CREATE OR REPLACE FUNCTION public.get_admin_accounts(page_offset integer DEFAULT 0, page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  accounts jsonb;
begin
  accounts := public.get_admin_accounts_without_oroshazi_delivery(page_offset, page_size);
  return coalesce((
    select jsonb_agg(account || jsonb_build_object(
      'oroshazi_delivery', coalesce((
        select p.oroshazi_delivery
        from public.profiles p
        where p.id = nullif(account ->> 'user_id', '')::uuid
      ), false)
    ) order by account ->> 'id')
    from jsonb_array_elements(accounts) account
  ), '[]'::jsonb);
end;
$function$;

REVOKE ALL ON FUNCTION get_admin_accounts(integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_admin_accounts(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_accounts(integer,integer) TO service_role;
