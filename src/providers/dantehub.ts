import type { NormalizedProduct, ProviderAdapter, ProviderContext, PurchaseResult } from './types';
import { ProviderError } from './types';
import { providerFetch } from './http';
import type { DeliveryKind, Requirements } from '../types';

// DanteHub Partner API v1. Docs: https://dantehub.shop/api-docs
// Auth: Authorization: Bearer <key>. Base: <base>/api/public/v1.
// Purchases are idempotent on our `ref`; most orders are fulfilled manually by DanteHub,
// so a new order is usually 'processing' and is polled via GET /orders/{ref}.
// The API exposes no stock numbers, warranty field or customer-input fields.

const API = '/api/public/v1';

interface DhProduct {
  id: string;
  title: string;
  category?: string | null;
  description?: string | null;
  price: number;
  currency: string;
  in_stock: boolean;
}

interface DhOrder {
  order_id: string;
  ref: string | null;
  status: 'processing' | 'delivered' | 'cancelled' | string;
  product_id?: string | null;
  product?: string;
  qty: number;
  unit_price?: number;
  total?: number;
  currency?: string;
  delivery: string | null;
  created_at?: string;
  delivered_at?: string | null;
}

/** paid test products listed in the live catalogue (0.01 USDT each) */
const TEST_TITLES = /^(test api for developers|chatgpt test)$/i;
/** description says DanteHub needs something from the customer, which the API cannot carry */
const NEEDS_INPUT = /requirements?\s*:|send (us )?your (username|email|profile|link|account)|need(s)? (your|the) (email|username|link|account)/i;
const PE_MARKER = /\{pe:\d+\}/g;
const EMOJI = /\p{Extended_Pictographic}️?(‍\p{Extended_Pictographic}️?)*/u;

function root(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/api\/public\/v1$/, '');
}

function headers(ctx: ProviderContext): Record<string, string> {
  return { Authorization: `Bearer ${ctx.credentials.api_key}` };
}

/** USDT / USDC / USD are 1:1; anything else needs config.usd_rate (units per 1 USD). */
export function toUsd(amount: number, currency: string, config: Record<string, unknown>): number {
  const c = (currency || 'USD').toUpperCase();
  if (['USD', 'USDT', 'USDC'].includes(c)) return amount;
  const rate = Number(config.usd_rate);
  if (!isFinite(rate) || rate <= 0) throw new Error(`DanteHub price in ${c}: set config.usd_rate (${c} per 1 USD) on this provider`);
  return Math.round((amount / rate) * 10000) / 10000;
}

/** Strip Telegram custom-emoji placeholders ({pe:123}) and pull the leading emoji out of the title. */
export function cleanTitle(title: string): { name: string; emoji: string | null } {
  const t = title.replace(PE_MARKER, '').trim();
  const lead = t.match(new RegExp(`^(${EMOJI.source})`, 'u'));
  const name = lead ? t.slice(lead[0].length).trim() : t;
  const any = t.match(EMOJI);
  return { name: name || t, emoji: any ? any[0] : null };
}

/** "Warranty: 30 Days" / "warranty 3 months" → days; null when not stated explicitly. */
export function parseWarranty(text: string): number | null {
  const m = text.match(/warranty\s*[:\-–]?\s*(\d{1,3})\s*(days?|d\b|months?|m\b|years?|y\b)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('y')) return n * 365;
  if (unit.startsWith('m')) return n * 30;
  return n;
}

export function normalizeDanteProduct(p: DhProduct, config: Record<string, unknown> = {}): NormalizedProduct {
  const { name, emoji } = cleanTitle(p.title);
  const description = p.description ? p.description.replace(PE_MARKER, '').trim() : null;
  const needsInput = NEEDS_INPUT.test(description ?? '');
  const kind: DeliveryKind = needsInput ? 'activation' : 'async';
  const requirements: Requirements = {};
  if (needsInput) {
    requirements.fields = [{ key: 'identifier', required: true, label_en: 'Your username / email / profile link', label_ar: 'اسم المستخدم / الإيميل / رابط الحساب' }];
  }
  // one delivery text per order: keep 1 unit per order unless the admin allows more (see splitDelivery)
  if (!config.allow_multi_qty) requirements.quantity_fixed = 1;

  const price = Number(p.price);
  return {
    external_id: p.id,
    name,
    description,
    image_url: null,
    emoji,
    delivery_kind: kind,
    raw_type: p.category ?? null,
    cost: isFinite(price) ? toUsd(price, p.currency, config) : null,
    cost_original: isFinite(price) ? price : null,
    cost_currency: (p.currency || 'USD').toUpperCase(),
    stock: p.in_stock ? null : 0, // no quantities disclosed
    sold: null,
    warranty_days: parseWarranty(`${p.title}\n${description ?? ''}`),
    requirements,
    price_tiers: null,
    promotions: null,
    raw: p,
  };
}

/**
 * DanteHub returns ONE delivery text for the whole order. Split it into `qty` items when
 * it clearly contains one block per unit (blank-line or one-line-per-unit); otherwise the
 * full text goes in the first item so nothing is lost and no partial refund is triggered.
 */
export function splitDelivery(text: string, qty: number): string[] {
  const t = text.trim();
  if (!t) return [];
  if (qty <= 1) return [t];
  const blocks = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (blocks.length === qty) return blocks;
  const lines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length === qty) return lines;
  return [t, ...Array.from({ length: qty - 1 }, () => '(included in the first item)')];
}

export function mapDanteOrder(o: DhOrder, raw: unknown, config: Record<string, unknown> = {}): PurchaseResult {
  const total = o.total != null ? Number(o.total) : null;
  const base = {
    provider_order_ref: o.ref || o.order_id,
    provider_status: o.status,
    cost_usd: total != null && isFinite(total) ? toUsd(total, o.currency ?? 'USD', config) : null,
    raw,
  };
  switch (o.status) {
    case 'delivered':
      return { ...base, status: 'completed', items: splitDelivery(o.delivery ?? '', Number(o.qty) || 1) };
    case 'cancelled':
      // also used for expired / refunded orders; refund is not guaranteed → human check
      return { ...base, status: 'failed', items: [], error: 'Order cancelled by DanteHub', retryable: false };
    default:
      return { ...base, status: 'pending', items: [] };
  }
}

function errCode(e: ProviderError): string | null {
  const b = e.body as { error?: { code?: string; message?: string } } | null;
  return typeof b?.error?.code === 'string' ? b.error.code : null;
}

function errMessage(e: ProviderError): string {
  const b = e.body as { error?: { code?: string; message?: string } } | null;
  return b?.error?.message || e.message;
}

/** DanteHub refs: 1–64 chars of [A-Za-z0-9._:-]; ours are already in that alphabet. */
export function danteRef(key: string): string {
  return key.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 64);
}

/** 429 carries no Retry-After: back off a minute. */
function rethrowRateLimit(e: unknown): void {
  if (e instanceof ProviderError && e.status === 429) {
    throw new ProviderError('DanteHub rate limited', 429, e.retryAfterSec ?? 60, e.body);
  }
}

export const dantehub: ProviderAdapter = {
  kind: 'dantehub',
  label: 'DanteHub API',
  defaultBaseUrl: 'https://dantehub.shop',
  credentialFields: [{ key: 'api_key', label: 'API token', secret: true }],

  async getBalance(ctx) {
    try {
      const r = await providerFetch<{ balance: number; currency: string }>(root(ctx.row.base_url), `${API}/balance`, { headers: headers(ctx) });
      const bal = Number(r.balance ?? 0);
      const currency = (r.currency || 'USD').toUpperCase();
      return { balance: bal, currency, balance_usd: toUsd(bal, currency, ctx.config) };
    } catch (e) {
      rethrowRateLimit(e);
      throw e;
    }
  },

  async listProducts(ctx) {
    try {
      const r = await providerFetch<{ products: DhProduct[] }>(root(ctx.row.base_url), `${API}/products`, { headers: headers(ctx) });
      return (r.products ?? [])
        .filter((p) => ctx.config.include_test_products || !TEST_TITLES.test(p.title.replace(PE_MARKER, '').trim()))
        .map((p) => normalizeDanteProduct(p, ctx.config));
    } catch (e) {
      rethrowRateLimit(e);
      throw e;
    }
  },

  async purchase(ctx, req) {
    const ref = danteRef(req.idempotency_key);
    const fail = (error: string, retryable: boolean, status: string | null = null, raw: unknown = null): PurchaseResult =>
      ({ status: 'failed', provider_order_ref: null, provider_status: status, items: [], cost_usd: null, error, retryable, raw });

    // the API has no field for customer details: never place an order that DanteHub cannot fulfil
    const needsInput = ['identifier', 'email', 'account'].some((k) => {
      const v = req.inputs[k];
      return Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '';
    });
    if (needsInput) return fail('DanteHub API cannot receive customer details for this product', true, 'unsupported_inputs');

    try {
      const r = await providerFetch<{ ok: boolean; duplicate?: boolean; order: DhOrder }>(root(ctx.row.base_url), `${API}/orders`, {
        method: 'POST',
        headers: headers(ctx),
        body: { product_id: req.external_id, qty: req.quantity, ref },
        timeoutMs: 45_000,
      });
      const res = mapDanteOrder(r.order, r, ctx.config);
      res.provider_order_ref = r.order.ref || ref;
      return res;
    } catch (e) {
      rethrowRateLimit(e);
      if (!(e instanceof ProviderError)) throw e;
      const code = errCode(e);
      if (e.status == null || e.status >= 500 || code === 'payment_pending') {
        // outcome unknown (timeout / 503 payment_pending): poll the same ref instead of re-buying
        return { status: 'pending', provider_order_ref: ref, provider_status: code ?? (e.status ? `HTTP ${e.status}` : 'timeout'), items: [], cost_usd: null, raw: e.body ?? null };
      }
      if (code === 'ref_conflict') return fail(errMessage(e), false, code, e.body);
      // nothing charged: invalid request, insufficient balance, product gone, out of stock, currency mismatch
      if ([400, 402, 404, 409].includes(e.status)) return fail(errMessage(e), true, code ?? `HTTP ${e.status}`, e.body);
      return fail(errMessage(e), false, code ?? `HTTP ${e.status}`, e.body);
    }
  },

  async getOrder(ctx, providerOrderRef) {
    try {
      const r = await providerFetch<{ ok: boolean; order: DhOrder }>(root(ctx.row.base_url), `${API}/orders/${encodeURIComponent(providerOrderRef)}`, { headers: headers(ctx) });
      return mapDanteOrder(r.order, r, ctx.config);
    } catch (e) {
      rethrowRateLimit(e);
      // 404 usually means the ref was never created, but it may also be a lagging read right after
      // a timed-out purchase. Never auto-refund on it: keep polling; checkAwaitingOrder alerts an admin
      // after many checks, who confirms at DanteHub before refunding.
      if (e instanceof ProviderError && e.status === 404) {
        return { status: 'pending', provider_order_ref: providerOrderRef, provider_status: 'not_found', items: [], cost_usd: null, raw: e.body ?? null };
      }
      throw e;
    }
  },
};
