-- Plus Store X — profit dashboard (owner only).
-- Counts orders delivered in [p_from, p_to): revenue = total − refunded, cost = cost_total as stored
-- (a refunded order keeps the cost the provider charged), profit = revenue − cost.

create or replace function public.admin_profit(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable as $$
  with base as (
    select o.id, o.product_id, o.provider_id, o.product_name,
           coalesce(o.delivered_qty, 0) as units,
           (o.total - o.refunded_amount) as revenue,
           coalesce(o.cost_total, 0) as cost,
           o.refunded_amount as refunds,
           o.delivered_at
      from public.orders o
     where o.delivered_at >= p_from and o.delivered_at < p_to
       and o.status in ('delivered','partially_delivered','refunded','partially_refunded')
  ),
  prev as (
    select (o.total - o.refunded_amount) as revenue, coalesce(o.cost_total, 0) as cost,
           o.refunded_amount as refunds, coalesce(o.delivered_qty, 0) as units
      from public.orders o
     where o.delivered_at >= p_from - (p_to - p_from) and o.delivered_at < p_from
       and o.status in ('delivered','partially_delivered','refunded','partially_refunded')
  ),
  named as (
    select b.*, p.group_id, coalesce(p.name_en, b.product_name) as pack_name, g.name_en as group_name
      from base b
      left join public.products p on p.id = b.product_id
      left join public.product_groups g on g.id = p.group_id
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'totals', (
      select jsonb_build_object(
        'revenue', coalesce(sum(revenue), 0),
        'cost', coalesce(sum(cost), 0),
        'profit', coalesce(sum(revenue - cost), 0),
        'margin_percent', case when coalesce(sum(revenue), 0) > 0 then round(sum(revenue - cost) / sum(revenue) * 100, 2) end,
        'orders', count(*),
        'units', coalesce(sum(units), 0),
        'refunds', coalesce(sum(refunds), 0),
        'avg_order', case when count(*) > 0 then round(sum(revenue) / count(*), 4) end
      ) from base
    ),
    'previous', (
      select jsonb_build_object(
        'revenue', coalesce(sum(revenue), 0),
        'cost', coalesce(sum(cost), 0),
        'profit', coalesce(sum(revenue - cost), 0),
        'margin_percent', case when coalesce(sum(revenue), 0) > 0 then round(sum(revenue - cost) / sum(revenue) * 100, 2) end,
        'orders', count(*),
        'units', coalesce(sum(units), 0),
        'refunds', coalesce(sum(refunds), 0),
        'avg_order', case when count(*) > 0 then round(sum(revenue) / count(*), 4) end
      ) from prev
    ),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day::date, 'revenue', coalesce(x.revenue, 0), 'cost', coalesce(x.cost, 0),
        'profit', coalesce(x.revenue - x.cost, 0), 'orders', coalesce(x.orders, 0)
      ) order by d.day)
        from generate_series(
               (p_from at time zone 'UTC')::date,
               ((p_to - interval '1 microsecond') at time zone 'UTC')::date,
               interval '1 day') as d(day)
        left join (
          select (delivered_at at time zone 'UTC')::date as day, sum(revenue) revenue, sum(cost) cost, count(*) orders
            from base group by 1
        ) x on x.day = d.day::date
    ), '[]'::jsonb),
    'by_product', coalesce((
      select jsonb_agg(t order by t.profit desc) from (
        select coalesce(group_id::text, coalesce(product_id::text, 'name:' || pack_name)) as key,
               max(coalesce(group_name, pack_name)) as name,
               case when group_id is not null then 'product' else 'pack' end as kind,
               sum(units) units, sum(revenue) revenue, sum(cost) cost, sum(revenue - cost) profit,
               case when sum(revenue) > 0 then round(sum(revenue - cost) / sum(revenue) * 100, 2) end as margin_percent
          from named
         group by coalesce(group_id::text, coalesce(product_id::text, 'name:' || pack_name)),
                  case when group_id is not null then 'product' else 'pack' end
         order by profit desc
         limit 50
      ) t
    ), '[]'::jsonb),
    'by_pack', coalesce((
      select jsonb_agg(t order by t.profit desc) from (
        select product_id, max(pack_name) as name, sum(units) units, sum(revenue) revenue, sum(revenue - cost) profit
          from named
         group by product_id, case when product_id is null then pack_name end
         order by profit desc
         limit 50
      ) t
    ), '[]'::jsonb),
    'by_provider', coalesce((
      select jsonb_agg(t order by t.profit desc) from (
        select b.provider_id, coalesce(max(pr.name), 'Own stock / manual') as name,
               count(*) orders, sum(b.revenue) revenue, sum(b.cost) cost, sum(b.revenue - b.cost) profit
          from base b
          left join public.providers pr on pr.id = b.provider_id
         group by b.provider_id
      ) t
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.admin_profit(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_profit(timestamptz, timestamptz) to service_role;
