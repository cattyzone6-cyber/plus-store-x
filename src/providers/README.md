# Provider adapters

Each supplier API is one file implementing `ProviderAdapter` (`types.ts`):

| method | used by | notes |
|---|---|---|
| `getBalance` | admin "test connection", cron balance check | return USD in `balance_usd` |
| `listProducts` | catalog sync (cron / "sync now") | normalize everything to USD; `stock: null` = unlimited |
| `purchase` | order fulfilment | must be idempotent on `idempotency_key` |
| `getOrder` | polling orders left `pending` | |

Purchase results:
- `completed` + `items` (one string per unit) → delivered to the customer.
- `pending` + `provider_order_ref` → order waits in `awaiting_provider`, polled by cron.
- `failed` + `retryable: true` → nothing was charged; the order may fail over to the next source.
- `failed` + `retryable: false`, or a thrown error (timeout / 5xx) → outcome unknown; the order stops and an admin is alerted.
- Throw `ProviderError` with status 429 and `retryAfterSec` on rate limits; the provider is paused until then.

## Adding a provider
1. Create `src/providers/<kind>.ts` exporting `const <kind>: ProviderAdapter` (use `providerFetch` from `http.ts`).
2. Register it in `src/providers/registry.ts` (`ADAPTERS`).
3. In the admin panel: Providers → Add, choose the new type, paste the key, Test, Sync.

Existing adapters:
- `ventebot` — VenteBot Reseller API (Storebat).
- `canboso` — Canboso Buyer API, shared by several stores (NovasGlobal, HitMeow…). Add one provider row per buyer key.
  Order history never returns credentials, so only the purchase response can deliver accounts; orders completing later are slot/upgrade products that need none. If prices come in a non-USD currency, set `usd_rate` (local currency per 1 USD) in the provider config.
