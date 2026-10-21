import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/dantehub-products.json';
import { cleanTitle, dantehub, danteRef, mapDanteOrder, normalizeDanteProduct, parseWarranty, splitDelivery, toUsd } from '../src/providers/dantehub';
import { ProviderError, type ProviderContext } from '../src/providers/types';
import type { ProviderRow } from '../src/types';

function ctx(config: Record<string, unknown> = {}): ProviderContext {
  return {
    row: { id: 'p1', name: 'DanteHub', kind: 'dantehub', base_url: 'https://dantehub.shop', config } as unknown as ProviderRow,
    credentials: { api_key: 'dh_test_key' },
    config,
  };
}

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const req = { external_id: 'prod-uuid', quantity: 1, idempotency_key: 'PSX-ABCD1234-1a2b3c4d', reference: 'PSX-ABCD1234', inputs: {} };

describe('dantehub normalization', () => {
  const products = fixture.products;

  it('strips custom-emoji placeholders and pulls the leading emoji', () => {
    const autodesk = products.find((p) => p.title.includes('{pe:'))!;
    const n = normalizeDanteProduct(autodesk);
    expect(n.name).not.toMatch(/\{pe:/);
    expect(n.name.startsWith('Autodesk')).toBe(true);
    expect(n.emoji).toBe('🥺');
    expect(cleanTitle('🔥ChatGPT GO 30D').name).toBe('ChatGPT GO 30D');
  });

  it('maps price/currency, stock and quantity', () => {
    for (const p of products) {
      const n = normalizeDanteProduct(p);
      expect(n.cost).toBe(p.price); // USDT and USD are 1:1
      expect(n.stock).toBe(p.in_stock ? null : 0);
      expect(n.requirements.quantity_fixed).toBe(1);
      expect(n.external_id).toBe(p.id);
    }
    expect(normalizeDanteProduct(products[0], { allow_multi_qty: true }).requirements.quantity_fixed).toBeUndefined();
  });

  it('flags products that need customer details as activation', () => {
    const x = normalizeDanteProduct(products.find((p) => p.title.includes('X Premium'))!);
    expect(x.delivery_kind).toBe('activation');
    expect(x.requirements.fields?.[0].key).toBe('identifier');
    const gpt = normalizeDanteProduct(products.find((p) => p.title.includes('ChatGPT GO'))!);
    expect(gpt.delivery_kind).toBe('async');
  });

  it('parses explicit warranty only', () => {
    expect(parseWarranty('👉 Warranty: 30 Days')).toBe(30);
    expect(parseWarranty('warranty 3 months')).toBe(90);
    expect(parseWarranty('full warranty')).toBeNull();
  });

  it('converts other currencies with usd_rate or refuses', () => {
    expect(toUsd(10, 'USDT', {})).toBe(10);
    expect(toUsd(25000, 'VND', { usd_rate: 25000 })).toBe(1);
    expect(() => toUsd(1, 'EUR', {})).toThrow(/usd_rate/);
  });

  it('hides paid test products unless enabled', async () => {
    mockFetch(200, fixture);
    const list = await dantehub.listProducts(ctx());
    expect(list.some((p) => /Test API/i.test(p.name))).toBe(false);
    mockFetch(200, fixture);
    const all = await dantehub.listProducts(ctx({ include_test_products: true }));
    expect(all.length).toBe(fixture.products.length);
  });

  it('sends bearer auth to the versioned base path', async () => {
    const fn = mockFetch(200, { ok: true, balance: 12.5, currency: 'USDT' });
    const b = await dantehub.getBalance(ctx());
    expect(b).toEqual({ balance: 12.5, currency: 'USDT', balance_usd: 12.5 });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dantehub.shop/api/public/v1/balance');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dh_test_key');
  });
});

describe('dantehub orders', () => {
  const order = { order_id: 'DH-1', ref: 'PSX-ABCD1234-1a2b3c4d', status: 'processing', qty: 1, total: 1.7, currency: 'USDT', delivery: null };

  it('maps statuses', () => {
    expect(mapDanteOrder(order as never, null).status).toBe('pending');
    const done = mapDanteOrder({ ...order, status: 'delivered', delivery: 'login: a\npass: b' } as never, null);
    expect(done.status).toBe('completed');
    expect(done.items).toEqual(['login: a\npass: b']);
    expect(done.cost_usd).toBe(1.7);
    const c = mapDanteOrder({ ...order, status: 'cancelled' } as never, null);
    expect(c.status).toBe('failed');
    expect(c.retryable).toBe(false);
  });

  it('splits multi-unit deliveries only when unambiguous', () => {
    expect(splitDelivery('a|1\n\nb|2', 2)).toEqual(['a|1', 'b|2']);
    expect(splitDelivery('a|1\nb|2', 2)).toEqual(['a|1', 'b|2']);
    const blob = splitDelivery('one\ntwo\nthree', 2);
    expect(blob.length).toBe(2);
    expect(blob[0]).toBe('one\ntwo\nthree');
  });

  it('purchase posts the idempotent ref and returns pending', async () => {
    const fn = mockFetch(201, { ok: true, duplicate: false, order });
    const r = await dantehub.purchase(ctx(), req);
    expect(r.status).toBe('pending');
    expect(r.provider_order_ref).toBe('PSX-ABCD1234-1a2b3c4d');
    const body = JSON.parse((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ product_id: 'prod-uuid', qty: 1, ref: 'PSX-ABCD1234-1a2b3c4d' });
  });

  it('nothing-charged errors are retryable, ref_conflict is not', async () => {
    mockFetch(402, { ok: false, error: { code: 'insufficient_balance', message: 'Not charged.' } });
    expect(await dantehub.purchase(ctx(), req)).toMatchObject({ status: 'failed', retryable: true, provider_status: 'insufficient_balance' });
    mockFetch(409, { ok: false, error: { code: 'out_of_stock', message: 'gone' } });
    expect(await dantehub.purchase(ctx(), req)).toMatchObject({ status: 'failed', retryable: true });
    mockFetch(409, { ok: false, error: { code: 'ref_conflict', message: 'ref used' } });
    expect(await dantehub.purchase(ctx(), req)).toMatchObject({ status: 'failed', retryable: false });
  });

  it('unknown outcomes are polled by ref instead of re-bought', async () => {
    mockFetch(503, { ok: false, error: { code: 'payment_pending', message: 'wait' } });
    expect(await dantehub.purchase(ctx(), req)).toMatchObject({ status: 'pending', provider_order_ref: 'PSX-ABCD1234-1a2b3c4d' });
  });

  it('429 throws with a back-off', async () => {
    mockFetch(429, { ok: false, error: { code: 'rate_limited', message: 'slow down' } });
    await expect(dantehub.purchase(ctx(), req)).rejects.toMatchObject({ status: 429, retryAfterSec: 60 });
    expect(new ProviderError('x', 429, 60)).toBeInstanceOf(ProviderError);
  });

  it('never orders products that need customer details', async () => {
    const fn = mockFetch(201, { ok: true, order });
    const r = await dantehub.purchase(ctx(), { ...req, inputs: { identifier: '@someone' } });
    expect(r).toMatchObject({ status: 'failed', retryable: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it('getOrder: 404 means the ref was never created', async () => {
    mockFetch(404, { ok: false, error: { code: 'not_found', message: 'none' } });
    expect(await dantehub.getOrder(ctx(), 'PSX-X')).toMatchObject({ status: 'failed', retryable: true });
  });

  it('refs stay inside the allowed alphabet', () => {
    expect(danteRef('PSX-AB 12/x')).toBe('PSX-AB-12-x');
    expect(danteRef('x'.repeat(80)).length).toBe(64);
  });
});
