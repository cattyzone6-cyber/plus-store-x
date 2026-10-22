-- Customer alerts: "new product" and "back in stock" announcements, plus per-product "notify me".

-- customers can turn store news off from their profile
alter table public.users add column if not exists alerts_opt_in boolean not null default true;

-- announcement bookkeeping on store products
alter table public.products add column if not exists announced_at timestamptz;          -- null = never announced as new
alter table public.products add column if not exists restocked_at timestamptz;          -- set when it came back in stock
alter table public.products add column if not exists last_restock_alert_at timestamptz; -- last "back in stock" announcement

-- products that exist before this migration are not "new"
update public.products set announced_at = now() where announced_at is null;

-- "notify me when available" requests
create table if not exists public.stock_alerts (
  user_id    bigint not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists stock_alerts_product_idx on public.stock_alerts(product_id);
alter table public.stock_alerts enable row level security;
revoke all on public.stock_alerts from anon, authenticated;

-- automatic announcements are broadcasts sent only to opted-in customers
alter table public.broadcasts drop constraint if exists broadcasts_target_check;
alter table public.broadcasts add constraint broadcasts_target_check
  check (target in ('all','lang_en','lang_ar','buyers','non_buyers','alerts'));
alter table public.broadcasts add column if not exists auto boolean not null default false;

create index if not exists products_announce_idx on public.products(announced_at) where announced_at is null;
