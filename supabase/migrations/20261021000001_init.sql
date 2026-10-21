-- Plus Store X — core schema
-- All tables have RLS enabled with NO policies: only the service role (the Worker) can read/write.
-- The admin panel never talks to tables directly; it goes through the Worker's /api/admin routes.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Settings & secrets
-- ─────────────────────────────────────────────────────────────────────────────
create table public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Encrypted (AES-GCM, ENCRYPTION_KEY) values such as payment API keys.
create table public.secrets (
  key        text primary key,
  value_enc  text not null,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Admin panel users (Supabase Auth users that may use the panel)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.admins (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('owner', 'support')),
  telegram_id  bigint unique,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Telegram customers & wallet
-- ─────────────────────────────────────────────────────────────────────────────
create table public.users (
  id               bigint primary key,              -- Telegram user id
  username         text,
  first_name       text,
  last_name        text,
  lang             text not null default 'en' check (lang in ('en', 'ar')),
  lang_chosen      boolean not null default false,
  balance          numeric(14,4) not null default 0 check (balance >= 0),
  points           integer not null default 0 check (points >= 0),
  referrer_id      bigint references public.users(id) on delete set null,
  referral_earned  numeric(14,4) not null default 0,
  referrals_count  integer not null default 0,
  discount_percent numeric(5,2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  total_spent      numeric(14,4) not null default 0,
  total_deposited  numeric(14,4) not null default 0,
  orders_count     integer not null default 0,
  is_banned        boolean not null default false,
  ban_reason       text,
  blocked_bot      boolean not null default false,  -- user blocked the bot (from failed sends)
  joined_verified  boolean not null default false,  -- passed force-join at least once
  state            jsonb,                           -- conversation state (awaiting input, etc.)
  note             text,                            -- admin note
  joined_at        timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);
create index users_referrer_idx on public.users(referrer_id);
create index users_username_idx on public.users(lower(username));

create table public.wallet_ledger (
  id            bigserial primary key,
  user_id       bigint not null references public.users(id) on delete cascade,
  amount        numeric(14,4) not null,
  balance_after numeric(14,4) not null,
  type          text not null check (type in ('deposit','purchase','refund','referral','admin_adjust','redeem','cashback','giveaway')),
  ref_type      text,
  ref_id        text,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index wallet_ledger_user_idx on public.wallet_ledger(user_id, created_at desc);

create table public.points_ledger (
  id         bigserial primary key,
  user_id    bigint not null references public.users(id) on delete cascade,
  delta      integer not null,
  reason     text not null,
  ref_id     text,
  created_at timestamptz not null default now()
);
create index points_ledger_user_idx on public.points_ledger(user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Providers (external supplier APIs) and their raw catalogs
-- ─────────────────────────────────────────────────────────────────────────────
create table public.providers (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  kind                   text not null,                 -- adapter key, e.g. 'ventebot' | 'canboso'
  base_url               text not null,
  credentials_enc        text,                          -- encrypted JSON, e.g. {"api_key": "..."}
  enabled                boolean not null default true,
  config                 jsonb not null default '{}'::jsonb,  -- adapter options (usd_rate, timeouts...)
  sync_interval_minutes  integer not null default 10 check (sync_interval_minutes >= 1),
  last_sync_at           timestamptz,
  last_sync_status       text,                          -- 'ok' | 'error'
  last_sync_error        text,
  last_sync_stats        jsonb,
  balance                numeric(14,4),
  balance_currency       text,
  balance_checked_at     timestamptz,
  low_balance_threshold  numeric(14,4),
  low_balance_notified   boolean not null default false,
  rate_limited_until     timestamptz,                   -- respect provider 429 penalties
  sort                   integer not null default 0,
  created_at             timestamptz not null default now()
);

create table public.provider_products (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  external_id      text not null,
  name             text not null,
  description      text,
  image_url        text,
  emoji            text,
  -- normalized delivery kind:
  --   'instant'    : credentials returned in the purchase response
  --   'async'      : provider fulfils later (poll / webhook)
  --   'activation' : needs customer input (email / account / identifier), may be async
  delivery_kind    text not null default 'instant',
  raw_type         text,                                -- provider's own type value
  cost             numeric(14,4),                       -- unit cost in USD (after currency conversion)
  cost_original    numeric(18,4),                       -- unit cost in provider currency
  cost_currency    text not null default 'USD',
  stock            integer,                             -- null = unlimited / unknown
  sold             integer,
  warranty_days    integer,
  -- normalized inputs the provider needs, e.g.
  -- {"fields":[{"key":"email","per_unit":false},{"key":"account","per_unit":true},{"key":"months","options":[1,3,6]}],"quantity_fixed":1}
  requirements     jsonb not null default '{}'::jsonb,
  price_tiers      jsonb,                               -- [{min_qty,max_qty,price}] in USD
  promotions       jsonb,
  raw              jsonb,
  content_hash     text,                                -- hash of name/description/etc. for change detection
  is_available     boolean not null default true,       -- seen in last sync and has stock
  is_removed       boolean not null default false,      -- missing from last sync
  is_new           boolean not null default true,       -- not reviewed by an admin yet
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_changed_at  timestamptz not null default now(),
  removed_at       timestamptz,
  unique (provider_id, external_id)
);
create index provider_products_provider_idx on public.provider_products(provider_id, is_removed);

-- ─────────────────────────────────────────────────────────────────────────────
-- Store catalog (what customers see)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.categories (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid references public.categories(id) on delete set null,
  name_en         text not null,
  name_ar         text,
  description_en  text,
  description_ar  text,
  emoji           text,
  custom_emoji_id text,
  image_url       text,
  button_style    text not null default 'primary' check (button_style in ('default','primary','success','danger')),
  sort            integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  category_id      uuid references public.categories(id) on delete set null,
  name_en          text not null,
  name_ar          text,
  description_en   text,
  description_ar   text,
  emoji            text,
  custom_emoji_id  text,
  image_url        text,
  duration_en      text,
  duration_ar      text,
  warranty_days    integer not null default 0,
  -- 'auto'   : fulfil from sources (provider API / stock)
  -- 'manual' : always goes to the admin manual queue
  fulfillment      text not null default 'auto' check (fulfillment in ('auto','manual')),
  pricing_mode     text not null default 'markup' check (pricing_mode in ('markup','manual')),
  markup_percent   numeric(7,2),                 -- null → settings.pricing.default_markup_percent
  markup_fixed     numeric(14,4),                -- null → settings.pricing.default_markup_fixed
  manual_price     numeric(14,4),
  base_cost        numeric(14,4),                -- cost for stock/manual sources (profit + markup base)
  compare_at_price numeric(14,4),                -- optional "was" price shown struck through
  sale_percent     numeric(5,2) not null default 0,
  qty_discounts    jsonb not null default '[]'::jsonb,   -- [{"min_qty":5,"percent":3}]
  routing          text not null default 'priority' check (routing in ('priority','cheapest')),
  on_failure       text check (on_failure in ('next_source','refund','manual')),  -- null → settings default
  -- extra inputs asked from the customer before purchase (merged with provider requirements)
  -- [{"key":"email","label_en":"Your email","label_ar":"بريدك","per_unit":false,"required":true}]
  input_fields     jsonb not null default '[]'::jsonb,
  min_qty          integer not null default 1 check (min_qty >= 1),
  max_qty          integer not null default 50 check (max_qty >= 1),
  qty_presets      integer[],
  button_style     text check (button_style in ('default','primary','success','danger')),
  is_active        boolean not null default true,
  is_featured      boolean not null default false,
  sort             integer not null default 0,
  auto_sync_info   boolean not null default true,        -- copy name/description/... from primary source
  locked_fields    text[] not null default '{}',         -- fields edited by an admin: never overwritten by sync
  sold_count       integer not null default 0,
  delivery_note_en text,                                 -- extra text appended to delivery message
  delivery_note_ar text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index products_category_idx on public.products(category_id, is_active, sort);

create table public.product_sources (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products(id) on delete cascade,
  kind                text not null check (kind in ('provider','stock','manual')),
  provider_product_id uuid references public.provider_products(id) on delete cascade,
  priority            integer not null default 0,        -- lower = tried first
  is_enabled          boolean not null default true,
  created_at          timestamptz not null default now(),
  check ((kind = 'provider') = (provider_product_id is not null))
);
create unique index product_sources_unique_pp on public.product_sources(product_id, provider_product_id) where provider_product_id is not null;
create unique index product_sources_unique_kind on public.product_sources(product_id, kind) where kind in ('stock','manual');
create index product_sources_pp_idx on public.product_sources(provider_product_id);

-- Local stock: one row per deliverable item (account / link / code)
create table public.stock_items (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  content    text not null,
  status     text not null default 'available' check (status in ('available','sold','reserved','invalid')),
  order_id   bigint,
  batch      text,
  created_by uuid,
  created_at timestamptz not null default now(),
  sold_at    timestamptz
);
create index stock_items_product_idx on public.stock_items(product_id, status, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Promo codes (checkout discount) & redeem codes (wallet gift)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.promo_codes (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,               -- stored upper-case
  kind           text not null check (kind in ('percent','fixed')),
  value          numeric(14,4) not null check (value > 0),
  scope          text not null default 'all' check (scope in ('all','category','product')),
  target_ids     uuid[] not null default '{}',
  min_order      numeric(14,4) not null default 0,
  max_uses       integer,                             -- null = unlimited
  per_user_limit integer not null default 1,
  uses           integer not null default 0,
  starts_at      timestamptz,
  expires_at     timestamptz,
  is_active      boolean not null default true,
  note           text,
  created_at     timestamptz not null default now()
);

create table public.promo_redemptions (
  id         bigserial primary key,
  promo_id   uuid not null references public.promo_codes(id) on delete cascade,
  user_id    bigint not null references public.users(id) on delete cascade,
  order_id   bigint,
  amount     numeric(14,4) not null,
  created_at timestamptz not null default now()
);
create index promo_redemptions_idx on public.promo_redemptions(promo_id, user_id);

create table public.redeem_codes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  amount     numeric(14,4) not null check (amount > 0),
  max_uses   integer not null default 1,
  uses       integer not null default 0,
  expires_at timestamptz,
  is_active  boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);

create table public.redeem_uses (
  id         bigserial primary key,
  code_id    uuid not null references public.redeem_codes(id) on delete cascade,
  user_id    bigint not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (code_id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Orders
-- ─────────────────────────────────────────────────────────────────────────────
create table public.orders (
  id                    bigserial primary key,
  code                  text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  user_id               bigint not null references public.users(id),
  product_id            uuid references public.products(id) on delete set null,
  product_name          text not null,
  quantity              integer not null check (quantity > 0),
  unit_price            numeric(14,4) not null,          -- after sale/user/qty discounts, before promo
  original_unit_price   numeric(14,4) not null,          -- before any discount
  subtotal              numeric(14,4) not null,
  discount_amount       numeric(14,4) not null default 0, -- promo discount
  total                 numeric(14,4) not null check (total >= 0),
  promo_code_id         uuid references public.promo_codes(id) on delete set null,
  promo_code            text,
  user_discount_percent numeric(5,2) not null default 0,
  -- pending_payment → paid → processing → delivered
  --                                  ↘ awaiting_provider (async) → delivered
  --                                  ↘ manual_pending (admin) → delivered
  --                                  ↘ failed → refunded
  status                text not null default 'pending_payment' check (status in (
                           'pending_payment','paid','processing','awaiting_provider','manual_pending',
                           'delivered','partially_delivered','failed','refunded','partially_refunded','cancelled')),
  payment_method        text,                              -- always 'wallet' once paid (deposits credit the wallet first)
  inputs                jsonb not null default '{}'::jsonb, -- customer supplied inputs (email, accounts...)
  source_id             uuid references public.product_sources(id) on delete set null,
  provider_id           uuid references public.providers(id) on delete set null,
  provider_product_id   uuid references public.provider_products(id) on delete set null,
  provider_order_ref    text,
  provider_status       text,
  cost_total            numeric(14,4),
  delivery              jsonb not null default '[]'::jsonb, -- array of delivered items (strings)
  delivered_qty         integer not null default 0,
  refunded_amount       numeric(14,4) not null default 0,
  points_awarded        integer not null default 0,
  warranty_days         integer not null default 0,
  warranty_until        timestamptz,
  idempotency_key       text unique,
  channel               text not null default 'bot' check (channel in ('bot','api')),
  attempts              integer not null default 0,
  next_check_at         timestamptz,                        -- for awaiting_provider polling
  error                 text,
  admin_note            text,
  created_at            timestamptz not null default now(),
  paid_at               timestamptz,
  delivered_at          timestamptz,
  updated_at            timestamptz not null default now()
);
create index orders_user_idx on public.orders(user_id, created_at desc);
create index orders_status_idx on public.orders(status, created_at desc);
create index orders_check_idx on public.orders(next_check_at) where status = 'awaiting_provider';

create table public.order_attempts (
  id                  bigserial primary key,
  order_id            bigint not null references public.orders(id) on delete cascade,
  source_id           uuid,
  provider_id         uuid,
  provider_product_id uuid,
  idempotency_key     text,
  status              text not null,                 -- 'success' | 'pending' | 'failed'
  request             jsonb,
  response            jsonb,
  error               text,
  created_at          timestamptz not null default now()
);
create index order_attempts_order_idx on public.order_attempts(order_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Deposits (wallet top-ups). Every external payment is a deposit; checkout with
-- insufficient balance creates a deposit linked to the order, which is auto-paid
-- from the wallet once the deposit is credited.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.deposits (
  id              uuid primary key default gen_random_uuid(),
  user_id         bigint not null references public.users(id),
  method          text not null check (method in ('binance_pay','binance_id','nowpayments','shamcash','admin')),
  amount_usd      numeric(14,4) not null check (amount_usd > 0),   -- wallet credit requested
  fee_usd         numeric(14,4) not null default 0,
  pay_amount      numeric(18,8),                                   -- exact amount the customer must send
  pay_currency    text,
  credited_amount numeric(14,4),
  status          text not null default 'pending' check (status in ('pending','confirming','paid','expired','rejected','cancelled','failed')),
  external_id     text,                                            -- gateway payment / transaction id
  reference       text unique,                                     -- our short reference / note code
  pay_address     text,
  pay_url         text,
  qr_url          text,
  proof_file_id   text,                                            -- telegram file id (screenshot)
  proof_text      text,                                            -- tx id typed by customer
  order_id        bigint references public.orders(id) on delete set null,
  meta            jsonb not null default '{}'::jsonb,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz,
  reviewed_by     uuid,
  review_note     text
);
create unique index deposits_external_idx on public.deposits(method, external_id) where external_id is not null;
create index deposits_user_idx on public.deposits(user_id, created_at desc);
create index deposits_status_idx on public.deposits(status, method);

-- ─────────────────────────────────────────────────────────────────────────────
-- Support / warranty tickets
-- ─────────────────────────────────────────────────────────────────────────────
create table public.tickets (
  id              bigserial primary key,
  user_id         bigint not null references public.users(id) on delete cascade,
  order_id        bigint references public.orders(id) on delete set null,
  kind            text not null check (kind in ('replacement','refund','support')),
  message         text,
  attachment_id   text,
  status          text not null default 'open' check (status in ('open','approved','rejected','resolved')),
  resolution      text check (resolution in ('replaced','refunded','rejected','answered')),
  resolution_note text,
  refund_amount   numeric(14,4),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid
);
create index tickets_status_idx on public.tickets(status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Custom emoji library (Telegram Premium custom emoji with plain fallback)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.emojis (
  key             text primary key,           -- e.g. 'shop', 'deposit', 'back'
  custom_emoji_id text,
  fallback        text not null,              -- plain emoji used without premium
  label           text,
  updated_at      timestamptz not null default now()
);

-- Custom emoji ids captured from messages sent to the bot by admins
create table public.emoji_inbox (
  custom_emoji_id text primary key,
  fallback        text,
  captured_by     bigint,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Engagement: giveaways, freebies, broadcasts
-- ─────────────────────────────────────────────────────────────────────────────
create table public.giveaways (
  id             uuid primary key default gen_random_uuid(),
  title_en       text not null,
  title_ar       text,
  description_en text,
  description_ar text,
  prize_type     text not null default 'balance' check (prize_type in ('balance','text')),
  prize_amount   numeric(14,4),
  prize_text     text,
  winners_count  integer not null default 1 check (winners_count >= 1),
  min_spent      numeric(14,4) not null default 0,    -- entry requirement
  ends_at        timestamptz not null,
  status         text not null default 'active' check (status in ('active','ended','cancelled')),
  created_at     timestamptz not null default now()
);

create table public.giveaway_entries (
  giveaway_id uuid not null references public.giveaways(id) on delete cascade,
  user_id     bigint not null references public.users(id) on delete cascade,
  is_winner   boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (giveaway_id, user_id)
);

create table public.freebies (
  id          uuid primary key default gen_random_uuid(),
  title_en    text not null,
  title_ar    text,
  content_en  text not null,
  content_ar  text,
  is_active   boolean not null default true,
  sort        integer not null default 0,
  claims      integer not null default 0,
  created_at  timestamptz not null default now()
);

create table public.broadcasts (
  id          uuid primary key default gen_random_uuid(),
  text_en     text not null,
  text_ar     text,
  image_url   text,
  buttons     jsonb not null default '[]'::jsonb,       -- [{"text":"Shop","url":"..."}]
  target      text not null default 'all' check (target in ('all','lang_en','lang_ar','buyers','non_buyers')),
  status      text not null default 'draft' check (status in ('draft','queued','sending','done','cancelled')),
  cursor_id   bigint not null default 0,                -- last user id processed
  sent        integer not null default 0,
  failed      integer not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Reseller API keys (customers buying through our API)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      bigint not null references public.users(id) on delete cascade,
  key_hash     text not null unique,         -- sha256 hex of the key
  prefix       text not null,                -- first chars, shown to the user
  name         text,
  is_active    boolean not null default true,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log & job bookkeeping
-- ─────────────────────────────────────────────────────────────────────────────
create table public.audit_log (
  id         bigserial primary key,
  admin_id   uuid,
  admin_email text,
  action     text not null,
  entity     text,
  entity_id  text,
  data       jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log(created_at desc);

-- simple key/timestamp store used by the cron dispatcher ("last time X ran")
create table public.cron_state (
  key        text primary key,
  last_run   timestamptz not null default now(),
  info       jsonb
);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger orders_touch   before update on public.orders   for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: lock everything down (service role bypasses RLS)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'settings','secrets','admins','users','wallet_ledger','points_ledger','providers','provider_products',
    'categories','products','product_sources','stock_items','promo_codes','promo_redemptions',
    'redeem_codes','redeem_uses','orders','order_attempts','deposits','tickets','emojis','emoji_inbox',
    'giveaways','giveaway_entries','freebies','broadcasts','api_keys','audit_log','cron_state']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
