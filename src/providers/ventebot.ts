import type { NormalizedProduct, ProviderAdapter, ProviderContext, PurchaseResult } from './types';
import { ProviderError } from './types';
import { absUrl, providerFetch, realEmoji } from './http';
import type { DeliveryKind, Requirements } from '../types';

// VenteBot Reseller API v1.2 (Storebat). Docs: <base>/api/swagger/
// Purchases debit the reseller wallet; idempotency_key makes retries safe.

interface VbProduct {
  id: number;
  name: string;
  description?: string | null;
  emoji?: string | null;
  image_url?: string | null;
  price_usd: number;
  standard_price_usd?: number | null;
  pricing_type?: string;
  warranty_days?: number | null;
  delivery_type?: 'stock' | 'activation' | 'supplier_api' | 'api_test' | string;
  stock?: number | null;
  price_tiers?: { min_qty: number; max_qty?: number | null; price_usd: number }[] | null;
  api_test?: boolean;
}

interface VbOrder {
  id: number;
  order_number?: number;
  status: 'COMPLETED' | 'PAID_PENDING_DELIVERY' | 'AWAITING_ACTIVATION_INFO' | 'AWAITING_ACTIVATION' | 'CANCELLED' | string;
  amount_usd?: number | null;
  items?: { id: number; account_data: string }[];
}

const ACTIVATION_REQ: Requirements = {
  fields: [{ key: 'identifier', required: true, label_en: 'Account / email / ID to activate', label_ar: 'الحساب / الإيميل / المعرف للتفعيل' }],
};

function headers(ctx: ProviderContext): Record<string, string> {
  return { 'X-Reseller-Key': ctx.credentials.api_key };
}

export function normalizeVenteProduct(p: VbProduct, baseUrl: string): NormalizedProduct {
  const kind: DeliveryKind = p.delivery_type === 'activation' ? 'activation' : 'instant';
  return {
    external_id: String(p.id),
    name: p.name,
    description: p.description ?? null,
    image_url: absUrl(baseUrl, p.image_url),
    emoji: realEmoji(p.emoji),
    delivery_kind: kind,
    raw_type: p.delivery_type ?? null,
    cost: p.price_usd != null ? Number(p.price_usd) : null,
    cost_original: p.price_usd != null ? Number(p.price_usd) : null,
    cost_currency: 'USD',
    stock: p.stock == null ? null : Number(p.stock),
    sold: null,
    warranty_days: p.warranty_days ?? null,
    requirements: kind === 'activation' ? ACTIVATION_REQ : {},
    price_tiers: p.price_tiers?.length ? p.price_tiers.map((t) => ({ min_qty: t.min_qty, max_qty: t.max_qty ?? null, price: Number(t.price_usd) })) : null,
    promotions: null,
    raw: p,
  };
}

export function mapVenteOrder(o: VbOrder, raw: unknown): PurchaseResult {
  const base = { provider_order_ref: String(o.id), provider_status: o.status, cost_usd: o.amount_usd ?? null, raw };
  switch (o.status) {
    case 'COMPLETED':
      return { ...base, status: 'completed', items: (o.items ?? []).map((i) => i.account_data).filter(Boolean) };
    case 'CANCELLED':
      // we cannot tell whether the wallet was refunded → unknown outcome, no automatic re-route
      return { ...base, status: 'failed', items: [], error: 'Order cancelled by provider', retryable: false };
    default:
      // PAID_PENDING_DELIVERY, AWAITING_ACTIVATION, AWAITING_ACTIVATION_INFO (identifier is always sent up front)
      return { ...base, status: 'pending', items: [] };
  }
}

export const ventebot: ProviderAdapter = {
  kind: 'ventebot',
  label: 'VenteBot Reseller API',
  defaultBaseUrl: 'https://web-production-1c7b1.up.railway.app',
  credentialFields: [{ key: 'api_key', label: 'Reseller API key (X-Reseller-Key)', secret: true }],

  async getBalance(ctx) {
    const me = await providerFetch<{ wallet_balance: number }>(ctx.row.base_url, '/api/reseller/me', { headers: headers(ctx) });
    const bal = Number(me.wallet_balance ?? 0);
    return { balance: bal, currency: 'USD', balance_usd: bal };
  },

  async listProducts(ctx) {
    const res = await providerFetch<{ products: VbProduct[] }>(ctx.row.base_url, '/api/reseller/products', {
      headers: headers(ctx),
      query: { lang: typeof ctx.config.lang === 'string' ? ctx.config.lang : undefined },
    });
    return (res.products ?? [])
      .filter((p) => !p.api_test && p.delivery_type !== 'api_test')
      .map((p) => normalizeVenteProduct(p, ctx.row.base_url));
  },

  async purchase(ctx, req) {
    const identifier = req.inputs.identifier ?? req.inputs.email ?? (Array.isArray(req.inputs.account) ? req.inputs.account[0] : req.inputs.account);
    const productId = Number(req.external_id);
    if (!Number.isInteger(productId)) {
      return { status: 'failed', provider_order_ref: null, provider_status: null, items: [], cost_usd: null, error: 'Invalid product id', retryable: true, raw: null };
    }
    try {
      const res = await providerFetch<{ order: VbOrder; total?: number | null }>(ctx.row.base_url, '/api/reseller/orders', {
        method: 'POST',
        headers: headers(ctx),
        body: {
          product_id: productId,
          quantity: req.quantity,
          activation_identifier: identifier != null ? String(identifier).slice(0, 500) : undefined,
          customer_reference: req.reference.slice(0, 120),
          idempotency_key: req.idempotency_key.slice(0, 120),
        },
        timeoutMs: 45_000,
      });
      const r = mapVenteOrder(res.order, res);
      if (r.cost_usd == null && res.total != null) r.cost_usd = Number(res.total);
      return r;
    } catch (e) {
      if (e instanceof ProviderError && e.status != null) {
        // nothing charged: insufficient reseller balance, invalid / inactive / out of stock product
        if ([400, 402, 404, 422].includes(e.status)) {
          return { status: 'failed', provider_order_ref: null, provider_status: `HTTP ${e.status}`, items: [], cost_usd: null, error: e.message, retryable: true, raw: e.body };
        }
        // idempotency conflict: same key, different payload → needs a human
        if (e.status === 409) {
          return { status: 'failed', provider_order_ref: null, provider_status: 'HTTP 409', items: [], cost_usd: null, error: e.message, retryable: false, raw: e.body };
        }
      }
      throw e; // 5xx / timeout → unknown outcome; 429 handled by the caller
    }
  },

  async getOrder(ctx, ref) {
    const res = await providerFetch<{ order: VbOrder }>(ctx.row.base_url, `/api/reseller/orders/${encodeURIComponent(ref)}`, { headers: headers(ctx) });
    return mapVenteOrder(res.order, res);
  },
};
