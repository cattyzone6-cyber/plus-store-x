-- Plus Store X — admin panel helpers (dashboard statistics).

-- Sales / deposits / users aggregated since p_from.
create or replace function public.admin_stats(p_from timestamptz)
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'revenue', coalesce((
      select sum(total - refunded_amount) from public.orders
       where paid_at >= p_from and status in ('delivered','partially_delivered','partially_refunded','awaiting_provider','manual_pending','processing','paid')
    ), 0),
    'cost', coalesce((
      select sum(cost_total) from public.orders
       where paid_at >= p_from and status in ('delivered','partially_delivered','partially_refunded')
    ), 0),
    'orders', (select count(*) from public.orders where paid_at >= p_from),
    'delivered', (select count(*) from public.orders where delivered_at >= p_from),
    'refunded', coalesce((select sum(refunded_amount) from public.orders where paid_at >= p_from), 0),
    'deposits', coalesce((select sum(credited_amount) from public.deposits where status = 'paid' and paid_at >= p_from), 0),
    'deposits_count', (select count(*) from public.deposits where status = 'paid' and paid_at >= p_from),
    'new_users', (select count(*) from public.users where joined_at >= p_from),
    'by_status', coalesce((
      select jsonb_object_agg(status, n) from (
        select status, count(*) n from public.orders where created_at >= p_from group by status
      ) s
    ), '{}'::jsonb),
    'by_method', coalesce((
      select jsonb_object_agg(method, amt) from (
        select method, sum(credited_amount) amt from public.deposits
         where status = 'paid' and paid_at >= p_from group by method
      ) m
    ), '{}'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(t) from (
        select product_id, product_name, sum(delivered_qty) qty, sum(total - refunded_amount) revenue
          from public.orders
         where paid_at >= p_from and status in ('delivered','partially_delivered','partially_refunded')
         group by product_id, product_name
         order by revenue desc
         limit 8
      ) t
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(d order by d.day) from (
        select date_trunc('day', paid_at)::date as day, sum(total - refunded_amount) revenue, count(*) orders
          from public.orders
         where paid_at >= p_from and paid_at is not null and status not in ('refunded','cancelled')
         group by 1
      ) d
    ), '[]'::jsonb)
  )
$$;

-- Things waiting for a human + totals that do not depend on a period.
create or replace function public.admin_overview()
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'manual_orders', (select count(*) from public.orders where status = 'manual_pending'),
    'failed_orders', (select count(*) from public.orders where status = 'failed'),
    'awaiting_provider', (select count(*) from public.orders where status = 'awaiting_provider'),
    'deposits_review', (select count(*) from public.deposits where status in ('pending','confirming') and method = 'shamcash' and (proof_file_id is not null or proof_text is not null)),
    'open_tickets', (select count(*) from public.tickets where status = 'open'),
    'users_total', (select count(*) from public.users),
    'wallet_liability', coalesce((select sum(balance) from public.users), 0),
    'new_provider_products', (select count(*) from public.provider_products where is_new and not is_removed),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'enabled', enabled, 'balance', balance, 'balance_currency', balance_currency,
        'low_balance_threshold', low_balance_threshold, 'last_sync_at', last_sync_at, 'last_sync_status', last_sync_status
      ) order by sort, name) from public.providers
    ), '[]'::jsonb)
  )
$$;

-- Store products linked to a set of provider products (for the provider catalog browser).
create or replace function public.admin_pp_links(p_ids uuid[])
returns table(provider_product_id uuid, product_id uuid, product_name text)
language sql stable as $$
  select s.provider_product_id, p.id, p.name_en
    from public.product_sources s
    join public.products p on p.id = s.product_id
   where s.provider_product_id = any(p_ids)
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_stats(timestamptz)', 'admin_overview()', 'admin_pp_links(uuid[])']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
