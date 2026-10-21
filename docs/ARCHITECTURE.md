# Architecture

Plus Store X is a single Cloudflare Worker with Supabase behind it. It serves:

| Path | What |
|---|---|
| `POST /webhook/telegram` | Telegram updates (bot) — checked against `TELEGRAM_WEBHOOK_SECRET` |
| `POST /webhook/*` | payment gateway callbacks (NOWPayments IPN, Binance Pay), signature-verified |
| `/api/admin/*` | admin panel REST API (Supabase Auth JWT + `admins` role) |
| `/api/v1/*` | public reseller API (customers' API keys, if enabled) |
| `/admin/*` | admin panel SPA (static files from `public/admin`, deep links fall back to `index.html`) |
| `/`, `/ar`, `/robots.txt`, `/sitemap.xml` | landing page (server-rendered from settings) |
| cron `* * * * *` | `src/cron.ts`: provider sync, order/deposit polling, expiries, giveaways, broadcasts |
| queue (optional) | background jobs on the Workers Paid plan |

## Modules

```
src/
  index.ts        routes + scheduled() + queue() + job runner registration
  cron.ts         minute dispatcher (decides what is due using cron_state)
  bot/            grammY bot: screens, keyboards, conversation state (users.state)
  services/       business logic; no HTTP/Telegram specifics except notify/delivery
    catalog.ts      categories, products + live pricing for a user
    pricing.ts      pure functions: source options, routing order, price, quotes, inputs
    orders.ts       create → pay (wallet) → fulfil (routing/failover) → deliver / refund
    delivery.ts     customer messages for delivery / status, TXT export
    deposits.ts     wallet top-ups, crediting (idempotent), proof review
    sync.ts         provider catalog sync with change detection and locked fields
    notify.ts       admin alerts, customer messages, audit log
    users.ts        Telegram users, language, discounts
  providers/      one adapter per supplier API (types.ts = interface, registry.ts)
  payments/       one gateway per payment method (types.ts = interface)
  http/           admin API, reseller API, payment webhooks, landing page
  lib/            db client + RPC errors, settings + secrets, crypto, money, i18n, emoji, telegram, jobs
admin/            React admin panel
supabase/         migrations, local config, demo seed
```

### Background jobs: free plan vs paid plan

`lib/jobs.ts → enqueue()`:

- **Free plan** (default). The job runs in `ctx.waitUntil()` right after the HTTP response. The cron sweeps re-run anything left unfinished, such as an order still in `paid` or stuck in `processing`. Purchases use idempotency keys, so a retry is safe.
- **Paid plan**. Requires `settings.system.plan = 'paid'` **and** the `JOBS` queue binding in `wrangler.jsonc`. Jobs then go to Cloudflare Queues, which give retries and longer CPU time. Broadcast batch sizes also grow (`system.broadcast_batch_paid`).

Job types: `fulfill_order`, `check_order`, `sync_provider`, `broadcast`, `deposit_credited`.

## Data model (summary)

| Table | Purpose |
|---|---|
| `settings` | one row per section (`brand`, `bot`, `payments`, ...), merged over `DEFAULT_SETTINGS` in `lib/settings.ts` |
| `secrets` | AES-GCM encrypted gateway keys (`ENCRYPTION_KEY`) |
| `admins` | panel users (`owner` / `support`), linked to Supabase Auth users and optionally to a Telegram id |
| `users` | Telegram customers: wallet `balance`, points, referrer, discounts, language, conversation `state` |
| `wallet_ledger` / `points_ledger` | every balance / points change, with type and reference |
| `providers` | supplier connections: adapter `kind`, encrypted credentials, sync status, balance |
| `provider_products` | the raw, normalized supplier catalogs (always mirror the provider) |
| `categories` / `products` | what customers see (EN/AR fields, pricing rules, routing, inputs, locked fields) |
| `product_sources` | links a product to its sources: `provider` (a provider product), `stock`, `manual` |
| `stock_items` | local deliverables (account / link / code), one row per unit |
| `orders` / `order_attempts` | orders and every provider call made for them |
| `deposits` | wallet top-ups for every payment method; optionally linked to an order to auto-pay |
| `promo_codes` / `promo_redemptions` | checkout discounts |
| `redeem_codes` / `redeem_uses` | wallet gift codes |
| `tickets` | replacement / refund / support requests |
| `emojis` / `emoji_inbox` | emoji library (custom emoji id + fallback) and ids captured from admins' messages |
| `giveaways`, `giveaway_entries`, `freebies`, `broadcasts`, `api_keys`, `audit_log`, `cron_state` | engagement, reseller API, audit, scheduling |

All tables have **RLS enabled with no policies**, and `anon`/`authenticated` are revoked. Only the service role,
which only the Worker holds, can read or write. The admin panel never talks to the database directly.

## Catalog sync and locked fields

`services/sync.ts` (per provider, every `sync_interval_minutes`, or on **Sync now**):

1. `adapter.listProducts()` returns `NormalizedProduct[]`, with USD costs, stock, requirements and delivery kind.
2. Each product is upserted into `provider_products`, keyed by `(provider_id, external_id)`.
   - **New** external ids get `is_new = true` and show up in the panel's provider catalog to import.
   - Ids **missing** from the response get `is_removed = true`. The source becomes unusable, but nothing is deleted.
   - Cost, stock and availability are refreshed every time. Content changes are detected with `content_hash`.
3. For store products with `auto_sync_info = true`, the **primary** provider source (lowest priority) copies the
   `SYNCABLE_FIELDS` (`services/sync-fields.ts`) **except** those listed in `products.locked_fields`.
   Editing one of those fields in the panel adds it to `locked_fields`. **Reset to provider** removes the lock.
4. Prices and stock are never copied into `products`. They are computed live (`pricing.ts`) from the current sources.

## Pricing

`pricing.ts → priceProduct()`:

- `pricing_mode = manual`: `manual_price`.
- `pricing_mode = markup`: reference cost × (1 + markup %) + fixed markup, then the rounding rule. The reference cost is the first usable source in routing order. Product values override the settings defaults.
- Then `sale_percent`, and the user's personal or level discount. The "was" price is `max(base, compare_at_price)`.
- Quantity discounts (`qty_discounts`) and promo codes are applied when quoting/creating the order.

## Order lifecycle

```
pending_payment ──(wallet pay: order_pay_wallet)──▶ paid ──▶ processing
     │                                                         │
     │ (cancel / deposit expired) ▶ cancelled                  ├─▶ delivered / partially_delivered (+ partial refund)
                                                               ├─▶ awaiting_provider ──(cron getOrder)──▶ delivered | failed
                                                               ├─▶ manual_pending ──(admin delivers)──▶ delivered
                                                               └─▶ failed ──▶ refunded (auto or by admin)
```

- **Payment.** Every external payment is a **deposit** that credits the wallet. If the customer's balance is short at checkout, a deposit linked to the order is created. When it is credited, the order is paid from the wallet automatically.
- **Fulfilment** (`orders.ts → fulfillOrder`):
  1. Claim the order atomically (`paid → processing`).
  2. Build the route: usable sources in `priority` order, or by lowest cost when `routing = cheapest`, each with enough stock. If `pricing.block_loss` is on, provider sources costing more than the customer paid are skipped.
  3. Try each source in turn:
     - **stock**: `stock_claim()` claims the items, all or nothing.
     - **manual**: the order goes to the admin queue.
     - **provider**: `adapter.purchase()` with idempotency key `<order code>-<source id>`. Retrying the same source never buys twice.
  4. On a failure that is known to be safe (nothing was charged), the next step depends on `on_failure`: `next_source`, `refund` or `manual`. The product value overrides the settings default.
  5. An **unknown** outcome, such as a timeout or a server error, is never re-routed. The order becomes `failed` and the admin is alerted to check the provider.
  6. When every source fails, `pricing.all_failed_action` applies: refund to the wallet, or the manual queue.
- **Delivery.** Delivery sets `warranty_until`, awards cashback points, updates `sold_count`, messages the customer (with a TXT export) and alerts the admins.

## Money safety

- Every balance change goes through the SQL function `wallet_apply()`. It runs a single `UPDATE ... WHERE balance + amount >= 0` plus a ledger insert in the same transaction, so a balance can't go negative and every change is traceable.
- `order_pay_wallet()`, `order_refund()`, `deposit_credit()`, `redeem_code_use()`, `points_redeem()` and `stock_claim()` lock their rows (`FOR UPDATE` / `SKIP LOCKED`) and are **idempotent**. For example, `deposit_credit()` on an already-paid deposit returns `credited: false`.
- Duplicate webhooks, duplicate Telegram updates and cron retries are therefore harmless.
- Refunds can never exceed what was paid (`REFUND_EXCEEDS_TOTAL`).

## Security

- **Secrets.** Bot token, Supabase service key and `ENCRYPTION_KEY` are Worker secrets. Provider credentials (`providers.credentials_enc`) and gateway keys (`secrets`) are AES-256-GCM encrypted in the database and shown masked in the panel.
- **Telegram webhook.** Requests must carry `X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET`.
- **Payment webhooks.**
  - NOWPayments: HMAC-SHA512 (`x-nowpayments-sig`) over the sorted JSON body, using the IPN secret.
  - Binance Pay: RSA-SHA256 signature checked against Binance's certificate.
  - Either way, amounts are re-checked against the deposit before crediting.
- **Admin API.** A Supabase Auth JWT (verified with Supabase), plus a row in `admins` or an email listed in `OWNER_EMAILS`. Roles: `owner` (everything) and `support` (orders, tickets, deposits review, users — no providers, payments, settings or admins). Mutations are written to `audit_log`.
- **Sign-ups.** Public sign-ups are disabled in Supabase Auth. Admins are created by the owner.
- **Landing page.** Admin-supplied URLs and colors are sanitized before rendering.

## Adding a provider adapter

1. Create `src/providers/<kind>.ts` exporting a `ProviderAdapter` (see `src/providers/types.ts`):
   - `getBalance`, `listProducts` (normalize to USD, map the supplier's product types to `delivery_kind` and `requirements`), `purchase` (must be idempotent), `getOrder`.
   - `credentialFields` drives the panel form. `defaultBaseUrl` pre-fills it.
   - On failures where nothing was charged (out of stock, insufficient provider balance, validation), return `{ status: 'failed', retryable: true }` so routing can fail over. Throw a `ProviderError` with the HTTP status otherwise. `429` responses should carry `retryAfterSec`, which pauses the provider.
2. Register it in `src/providers/registry.ts`.
3. Add it to the panel's provider form. The list comes from the adapters registry via the admin API, so normally nothing else is needed.

## Adding a payment gateway

1. Create `src/payments/<method>.ts` implementing `PaymentGateway` (`src/payments/types.ts`): `isEnabled`, `minAmount`, `create` (returns instructions for the bot), and optionally `check` (polling / "I've paid").
2. Add the method to the `deposits.method` check constraint in a **new** migration, and to `DepositMethod` in `src/types.ts`.
3. Add its settings to `AppSettings.payments` (`lib/settings.ts`) and its keys to `SECRET_KEYS`.
4. Register it in the payments registry. If it pushes callbacks, add a verified route in `src/http/webhooks.ts`.
5. Credit only through `services/deposits.ts`, which calls the `deposit_credit()` SQL function. Never update balances directly.
