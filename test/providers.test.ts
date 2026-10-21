import { afterEach, describe, expect, it, vi } from 'vitest';
import { ventebot } from '../src/providers/ventebot';
import { canboso } from '../src/providers/canboso';
import { ProviderError, type ProviderContext } from '../src/providers/types';
import { priceProduct, buildOption, orderRoute } from '../src/services/pricing';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import type { ProductRow, ProductSourceRow, ProviderProductRow, ProviderRow } from '../src/types';
import vbFixture from './fixtures/ventebot-products.json';
import cbFixture from './fixtures/canboso-products.json';

function ctx(kind: string, base: string, config: Record<string, unknown> = {}): ProviderContext {
  const row = { id: 'p1', name: kind, kind, base_url: base, enabled: true, config } as unknown as ProviderRow;
  return { row, credentials: { api_key: 'test-key' }, config };
}

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
function mockFetch(...replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift() ?? { status: 500, body: { message: 'no more replies' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('ventebot adapter', () => {
  const c = ctx('ventebot', 'https://vb.example.com');

  it('normalizes the catalog and hides api_test products', async () => {
    const activation = { id: 77, name: 'Grok 1 month', price_usd: 5, delivery_type: 'activation', stock: null, warranty_days: 30, api_test: false, emoji: 'bolt' };
    const calls = mockFetch({ body: { ...vbFixture, products: [...vbFixture.products, activation] } });
    const list = await ventebot.listProducts(c);
    expect(calls[0].url).toBe('https://vb.example.com/api/reseller/products');
    expect((calls[0].init.headers as Record<string, string>)['X-Reseller-Key']).toBe('test-key');
    expect(list.find((p) => p.name === 'API test product')).toBeUndefined();
    const stock = list.find((p) => p.raw_type === 'stock')!;
    expect(stock.delivery_kind).toBe('instant');
    expect(typeof stock.cost).toBe('number');
    const act = list.find((p) => p.external_id === '77')!;
    expect(act.delivery_kind).toBe('activation');
    expect(act.requirements.fields?.[0].key).toBe('identifier');
    expect(act.stock).toBeNull();
    expect(act.emoji).toBeNull(); // "bolt" is not an emoji
    const tiered = list.find((p) => p.price_tiers?.length);
    if (tiered) expect(tiered.price_tiers![0]).toHaveProperty('price');
  });

  it('maps a completed purchase to items', async () => {
    const calls = mockFetch({ body: { success: true, order: { id: 5, status: 'COMPLETED', amount_usd: 1.9, items: [{ id: 1, account_data: 'a@b.c:pw' }] } } });
    const r = await ventebot.purchase(c, { external_id: '12', quantity: 1, idempotency_key: 'K1', reference: 'PSX-1', inputs: {} });
    expect(r).toMatchObject({ status: 'completed', items: ['a@b.c:pw'], provider_order_ref: '5', cost_usd: 1.9 });
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toMatchObject({ product_id: 12, quantity: 1, idempotency_key: 'K1', customer_reference: 'PSX-1' });
  });

  it('treats pending statuses as pending and sends the activation identifier', async () => {
    const calls = mockFetch({ body: { success: true, order: { id: 6, status: 'AWAITING_ACTIVATION' } } });
    const r = await ventebot.purchase(c, { external_id: '77', quantity: 1, idempotency_key: 'K2', reference: 'PSX-2', inputs: { identifier: '@client' } });
    expect(r.status).toBe('pending');
    expect(JSON.parse(String(calls[0].init.body)).activation_identifier).toBe('@client');
  });

  it('402 is a safe (retryable) failure, 5xx throws', async () => {
    mockFetch({ status: 402, body: { success: false, code: 'INSUFFICIENT_FUNDS', message: 'Insufficient balance' } });
    const r = await ventebot.purchase(c, { external_id: '12', quantity: 1, idempotency_key: 'K3', reference: 'X', inputs: {} });
    expect(r).toMatchObject({ status: 'failed', retryable: true });

    mockFetch({ status: 502, body: { message: 'bad gateway' } });
    await expect(ventebot.purchase(c, { external_id: '12', quantity: 1, idempotency_key: 'K4', reference: 'X', inputs: {} })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('canboso adapter', () => {
  const c = ctx('canboso', 'https://cb.example.com');

  it('normalizes product types and requirements', async () => {
    const calls = mockFetch({ body: cbFixture });
    const list = await canboso.listProducts(c);
    expect(calls[0].url).toContain('/api/v2/telegram-buyer/products?key=test-key');
    const account = list.find((p) => p.raw_type === 'account')!;
    expect(account).toMatchObject({ delivery_kind: 'instant', cost_currency: 'USD' });
    const slot = list.find((p) => p.raw_type === 'slot')!;
    expect(slot.delivery_kind).toBe('activation');
    expect(slot.requirements.fields?.map((f) => f.key)).toEqual(['email']);
    expect(slot.requirements.quantity_fixed).toBe(1);
    const upgrade = list.find((p) => p.raw_type === 'upgrade_account')!;
    expect(upgrade.requirements.fields?.[0]).toMatchObject({ key: 'account', per_unit: true });
    expect(list.some((p) => p.stock === null)).toBe(true);
  });

  it('converts VND prices with config.usd_rate and handles the business slot', async () => {
    const vc = ctx('canboso', 'https://cb.example.com', { usd_rate: 25000 });
    mockFetch({
      body: {
        success: true, walletCurrency: 'VND',
        products: [{
          productId: 'slot_chatgpt_business', name: 'ChatGPT Business Slot', productType: 'slot', image: '/uploads/x.png',
          price: { amount: 50000, currency: 'VND', text: '50.000 ₫' }, availability: { available: null, sold: 1 }, promotions: [],
          purchaseRequirements: { customerEmail: true, slotMonths: true, quantityFixed: 1, allowedMonths: [1, 3, 6] },
        }],
      },
    });
    const [p] = await canboso.listProducts(vc);
    expect(p.cost).toBe(2);
    expect(p.cost_original).toBe(50000);
    expect(p.image_url).toBe('https://cb.example.com/uploads/x.png');
    expect(p.requirements.fields?.find((f) => f.key === 'months')?.options).toEqual([1, 3, 6]);
  });

  it('formats delivered accounts and maps waiting_seller to pending', async () => {
    const calls = mockFetch(
      { body: { success: true, order: { orderCode: 'ORD1', status: 'completed', productType: 'account' }, payment: { amount: 4.2, currency: 'USD' }, delivery: { accounts: [{ user: 'u1', password: 'p1', expiryText: '30d' }] } } },
      { body: { success: true, order: { orderCode: 'ORD2', status: 'paid', productType: 'slot', fulfillmentStatus: 'waiting_seller', autoCompleted: false }, payment: { amount: 10, currency: 'USD' } } },
    );
    const done = await canboso.purchase(c, { external_id: 'abc', quantity: 2, idempotency_key: 'IK', reference: 'PSX-1', inputs: {} });
    expect(done).toMatchObject({ status: 'completed', items: ['u1 | p1 | expires: 30d'], cost_usd: 4.2, provider_order_ref: 'ORD1' });
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('IK');

    const pending = await canboso.purchase(c, { external_id: 's1', quantity: 1, idempotency_key: 'IK2', reference: 'PSX-2', inputs: { email: 'a@b.co' } });
    expect(pending).toMatchObject({ status: 'pending', provider_order_ref: 'ORD2' });
    expect(JSON.parse(String(calls[1].init.body)).customer_email).toBe('a@b.co');
  });

  it('409 inventory is retryable, idempotency conflict is not, 429 throws with Retry-After', async () => {
    mockFetch({ status: 409, body: { success: false, message: 'Inventory not enough' } });
    expect((await canboso.purchase(c, { external_id: 'a', quantity: 1, idempotency_key: 'x', reference: 'r', inputs: {} })).retryable).toBe(true);
    mockFetch({ status: 409, body: { success: false, message: 'Idempotency conflict' } });
    expect((await canboso.purchase(c, { external_id: 'a', quantity: 1, idempotency_key: 'x', reference: 'r', inputs: {} })).retryable).toBe(false);
    mockFetch({ status: 429, body: { success: false, message: 'Too many requests' }, headers: { 'retry-after': '300' } });
    await expect(canboso.listProducts(c)).rejects.toMatchObject({ status: 429, retryAfterSec: 300 });
  });

  it('getOrder returns completed without credentials', async () => {
    mockFetch({ body: { success: true, orders: [{ orderCode: 'ORD2', status: 'completed', quantity: 1, payment: { amountVnd: null, amountUsd: 10 } }] } });
    const r = await canboso.getOrder(c, 'ORD2');
    expect(r).toMatchObject({ status: 'completed', items: [], cost_usd: 10 });
  });
});

describe('pricing & routing', () => {
  const product = {
    id: 'prod', pricing_mode: 'markup', markup_percent: null, markup_fixed: null, manual_price: null, base_cost: null,
    compare_at_price: null, sale_percent: 0, routing: 'priority', fulfillment: 'auto', qty_discounts: [], is_active: true,
  } as unknown as ProductRow;
  const prov = { id: 'pv', enabled: true, rate_limited_until: null } as unknown as ProviderRow;
  const pp = (id: string, cost: number, stock: number | null, extra: Partial<ProviderProductRow> = {}) =>
    ({ id, provider_id: 'pv', cost, stock, is_available: stock !== 0, is_removed: false, requirements: {}, ...extra }) as unknown as ProviderProductRow;
  const src = (id: string, priority: number, kind: ProductSourceRow['kind'] = 'provider') =>
    ({ id, product_id: 'prod', kind, provider_product_id: kind === 'provider' ? id : null, priority, is_enabled: true }) as ProductSourceRow;

  it('applies default 20% markup on the first routed source', () => {
    const opts = [buildOption(src('a', 0), pp('a', 10, 5), prov, 0, product), buildOption(src('b', 1), pp('b', 15, null), prov, 0, product)];
    const pr = priceProduct(product, opts, DEFAULT_SETTINGS, null);
    expect(pr.unitPrice).toBe(12);
    expect(pr.available).toBeNull(); // b is unlimited
    expect(pr.route.map((o) => o.source.id)).toEqual(['a', 'b']);
  });

  it('cheapest routing and removed / sold-out sources', () => {
    const opts = [
      buildOption(src('a', 0), pp('a', 15, 5), prov, 0, product),
      buildOption(src('b', 1), pp('b', 10, 3), prov, 0, product),
      buildOption(src('c', 2), pp('c', 5, 9, { is_removed: true }), prov, 0, product),
    ];
    expect(orderRoute(opts, 'cheapest').map((o) => o.source.id)).toEqual(['b', 'a']);
    const soldOut = priceProduct(product, [buildOption(src('d', 0), pp('d', 8, 0), prov, 0, product)], DEFAULT_SETTINGS, null);
    expect(soldOut.soldOut).toBe(true);
    expect(soldOut.unitPrice).toBe(9.6); // price still shown for sold-out items
  });
});
