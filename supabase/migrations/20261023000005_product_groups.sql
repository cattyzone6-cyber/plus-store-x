-- Catalog v2: Category → Product (a "group", e.g. ChatGPT Plus) → Packs (the sellable rows in
-- `products`, e.g. "ChatGPT Plus 1M"). Packs keep their own full name, price, stock, sources,
-- warranty. A pack without a group is listed directly in its category (as before).
-- Also: per-provider import defaults and price guards (minimum margin, cost-jump review).

create table if not exists public.product_groups (
  id              uuid primary key default gen_random_uuid(),
  category_id     uuid references public.categories(id) on delete set null,
  name_en         text not null,
  name_ar         text,
  description_en  text,
  description_ar  text,
  emoji           text,
  custom_emoji_id text,
  image_url       text,
  button_style    text check (button_style in ('default','primary','success','danger')),
  sort            integer not null default 0,
  is_active       boolean not null default true,
  is_featured     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists product_groups_category_idx on public.product_groups(category_id, is_active, sort);
alter table public.product_groups enable row level security;
revoke all on public.product_groups from anon, authenticated;
create trigger product_groups_touch before update on public.product_groups for each row execute function public.touch_updated_at();

-- packs belong to a product group
alter table public.products add column if not exists group_id uuid references public.product_groups(id) on delete set null;
create index if not exists products_group_idx on public.products(group_id, is_active, sort);

-- price guards on packs
alter table public.products add column if not exists min_margin_percent numeric(7,2);   -- null → provider / global default
alter table public.products add column if not exists cost_basis numeric(14,4);          -- cost the price is based on (drops not followed unless enabled)
alter table public.products add column if not exists paused_reason text
  check (paused_reason in ('cost_jump','below_margin'));
alter table public.products add column if not exists pending_cost numeric(14,4);        -- new cost waiting for the owner's OK
alter table public.products add column if not exists pinned boolean not null default false;

-- per-provider import defaults + guard settings
alter table public.providers add column if not exists import_markup_percent numeric(7,2);
alter table public.providers add column if not exists import_markup_fixed numeric(14,4);
alter table public.providers add column if not exists import_min_margin_percent numeric(7,2);
alter table public.providers add column if not exists import_category_id uuid references public.categories(id) on delete set null;
alter table public.providers add column if not exists import_description_en text;  -- template, {name} = product name
alter table public.providers add column if not exists import_description_ar text;
alter table public.providers add column if not exists max_jump_percent numeric(7,2);      -- null → settings default
