import type { NormalizedProduct, ProviderAdapter, ProviderContext, PurchaseResult } from './types';
import { ProviderError } from './types';
import { absUrl, providerFetch, realEmoji } from './http';
import type { DeliveryKind, RequirementField, Requirements } from '../types';
import { round4 } from '../lib/money';

// Canboso "Buyer API" v2.2 — used by several stores (NovasGlobal, HitMeow, ...), one buyer key each.
// Rate limits are strict with escalating penalties (1m → 6h): never call it per customer tap;
// the catalog is mirrored by the sync job and 429s set providers.rate_limited_until.
//
// Limitation: GET /orders (history) never returns delivered credentials. Credentials only come
// in the purchase response; orders that complete later are slot / upgrade products that need
// no credentials (the seller invites / upgrades the customer's account).

interface CbProduct {
  productId: string;
  name: string;
  description?: string | null;
  image?: string | null;
  emoji?: string | null;
  productType: 'account' | 'slot' | 'upgrade_account' | string;
  price: { amount: number; currency: string; text?: string };
  availability?: { available?: number | null; sold?: number | null };
  promotions?: unknown[];
  purchaseRequirements?: {
    customerEmail?: boolean;
    customerAccounts?: boolean;
    slotMonths?: boolean;
    quantityFixed?: number;
    allowedMonths?: number[];
  };
}

interface CbPurchaseResponse {
  success: boolean;
  order: {
    orderCode: string;
    status: string;
    productType?: string;
    quantity?: number;
    finalQuantity?: number;
    fulfillmentStatus?: string;
    autoCompleted?: boolean;
  };
  payment?: { amount?: number; currency?: string };
  delivery?: { accounts?: { user?: string; password?: string; verifyEmail?: string | null; expiryText?: string | null; otherInfo?: string | null }[] };
}

interface CbHistoryItem {
  orderCode: string | null;
  status: string | null;
  payment?: { amountVnd?: number | null; amountUsd?: number | null };
}

const BUSINESS_SLOT = 'slot_chatgpt_business';

/** VND (or other) per 1 USD; config.usd_rate wins, else the rate cached from /balance. */
async function usdRate(ctx: ProviderContext): Promise<number> {
  const fromConfig = Number(ctx.config.usd_rate);
  if (isFinite(fromConfig) && fromConfig > 0) return fromConfig;
  const cached = Number(ctx.config._usd_rate_cached);
  if (isFinite(cached) && cached > 0) return cached;
  const bal = await providerFetch<{ usdRate?: number }>(ctx.row.base_url, '/api/v2/telegram-buyer/balance', {
    headers: headers(ctx),
    query: { key: ctx.credentials.api_key },
  });
  const r = Number(bal.usdRate);
  if (!isFinite(r) || r <= 0) {
    throw new ProviderError('Provider prices are not in USD and no exchange rate is known: set "usd_rate" (local currency per 1 USD) in the provider config');
  }
  ctx.config._usd_rate_cached = r; // per-call cache (not persisted)
  return r;
}

function toUsd(amount: number, currency: string | undefined, rate: number | null): number {
  if (!currency || currency.toUpperCase() === 'USD') return round4(amount);
  if (!rate) throw new ProviderError(`Cannot convert ${currency} to USD`);
  return round4(amount / rate);
}

function headers(ctx: ProviderContext): Record<string, string> {
  return { 'x-buyer-key': ctx.credentials.api_key };
}

export function canbosoRequirements(p: CbProduct): { kind: DeliveryKind; req: Requirements } {
  const pr = p.purchaseRequirements ?? {};
  const fields: RequirementField[] = [];
  let kind: DeliveryKind = 'instant';
  if (p.productType === 'slot' || p.productId === BUSINESS_SLOT) {
    kind = 'activation';
    fields.push({ key: 'email', required: true, label_en: 'Email to invite', label_ar: 'الإيميل المراد دعوته' });
    if (p.productId === BUSINESS_SLOT || pr.slotMonths) {
      fields.push({ key: 'months', required: true, options: pr.allowedMonths ?? [], label_en: 'Months', label_ar: 'عدد الأشهر' });
    }
  } else if (p.productType === 'upgrade_account' || pr.customerAccounts) {
    kind = 'activation';
    fields.push({ key: 'account', per_unit: true, required: true, label_en: 'Account to upgrade', label_ar: 'الحساب المراد ترقيته' });
  } else if (pr.customerEmail) {
    fields.push({ key: 'email', required: true, label_en: 'Email', label_ar: 'الإيميل' });
  }
  const quantity_fixed = pr.quantityFixed ?? (kind === 'activation' && p.productType === 'slot' ? 1 : undefined);
  return { kind, req: { ...(fields.length ? { fields } : {}), ...(quantity_fixed ? { quantity_fixed } : {}) } };
}

export function normalizeCanbosoProduct(p: CbProduct, baseUrl: string, rate: number | null): NormalizedProduct {
  const { kind, req } = canbosoRequirements(p);
  const amount = Number(p.price?.amount);
  const currency = p.price?.currency || 'USD';
  const available = p.availability?.available;
  return {
    external_id: p.productId,
    name: p.name,
    description: p.description ?? null,
    image_url: absUrl(baseUrl, p.image),
    emoji: realEmoji(p.emoji),
    delivery_kind: kind,
    raw_type: p.productType,
    cost: isFinite(amount) ? toUsd(amount, currency, rate) : null,
    cost_original: isFinite(amount) ? amount : null,
    cost_currency: currency.toUpperCase(),
    stock: available == null ? null : Number(available),
    sold: p.availability?.sold ?? null,
    warranty_days: null,
    requirements: req,
    price_tiers: null,
    promotions: p.promotions?.length ? p.promotions : null,
    raw: p,
  };
}

function formatAccount(a: NonNullable<NonNullable<CbPurchaseResponse['delivery']>['accounts']>[number]): string {
  let s = [a.user, a.password].filter((x) => x != null && x !== '').join(' | ');
  if (a.verifyEmail) s += ` | verify: ${a.verifyEmail}`;
  if (a.expiryText) s += ` | expires: ${a.expiryText}`;
  if (a.otherInfo) s += ` | ${a.otherInfo}`;
  return s;
}

const FAILED_STATUSES = ['cancelled', 'canceled', 'failed', 'rejected', 'refunded', 'expired'];

export function mapCanbosoStatus(status: string | null | undefined, fulfillment?: string | null, autoCompleted?: boolean): 'completed' | 'pending' | 'failed' {
  const s = (status ?? '').toLowerCase();
  if (FAILED_STATUSES.includes(s)) return 'failed';
  if (s === 'completed' || s === 'delivered' || s === 'success') {
    return autoCompleted === false && fulfillment && /wait|pending|process/i.test(fulfillment) ? 'pending' : 'completed';
  }
  return 'pending'; // paid / processing / waiting_seller ...
}

export function mapCanbosoPurchase(res: CbPurchaseResponse, rate: number | null): PurchaseResult {
  const o = res.order;
  const status = mapCanbosoStatus(o.status, o.fulfillmentStatus, o.autoCompleted);
  const amount = Number(res.payment?.amount);
  const cost = isFinite(amount) ? (() => { try { return toUsd(amount, res.payment?.currency, rate); } catch { return null; } })() : null;
  return {
    status,
    provider_order_ref: o.orderCode,
    provider_status: o.fulfillmentStatus ? `${o.status}/${o.fulfillmentStatus}` : o.status,
    items: status === 'completed' ? (res.delivery?.accounts ?? []).map(formatAccount).filter(Boolean) : [],
    cost_usd: cost,
    error: status === 'failed' ? `Provider order ${o.status}` : undefined,
    retryable: status === 'failed' ? (o.status ?? '').toLowerCase() === 'refunded' : undefined,
    raw: res,
  };
}

function failed(e: ProviderError, retryable: boolean): PurchaseResult {
  return { status: 'failed', provider_order_ref: null, provider_status: `HTTP ${e.status}`, items: [], cost_usd: null, error: e.message, retryable, raw: e.body };
}

export const canboso: ProviderAdapter = {
  kind: 'canboso',
  label: 'Canboso Buyer API (NovasGlobal / HitMeow…)',
  defaultBaseUrl: 'https://canboso.com',
  credentialFields: [{ key: 'api_key', label: 'Buyer key (tgb_…)', secret: true }],

  async getBalance(ctx) {
    const b = await providerFetch<{ walletCurrency?: string; balance?: number; balanceUsd?: number; usdRate?: number }>(
      ctx.row.base_url, '/api/v2/telegram-buyer/balance', { headers: headers(ctx), query: { key: ctx.credentials.api_key } },
    );
    const currency = (b.walletCurrency || 'USD').toUpperCase();
    const balance = Number(b.balance ?? 0);
    const rate = Number(ctx.config.usd_rate) > 0 ? Number(ctx.config.usd_rate) : Number(b.usdRate) || null;
    const balance_usd = b.balanceUsd != null ? Number(b.balanceUsd) : currency === 'USD' ? balance : rate ? round4(balance / rate) : 0;
    return { balance, currency, balance_usd };
  },

  async listProducts(ctx) {
    const res = await providerFetch<{ walletCurrency?: string; products: CbProduct[] }>(ctx.row.base_url, '/api/v2/telegram-buyer/products', {
      headers: headers(ctx),
      query: { key: ctx.credentials.api_key },
    });
    const products = res.products ?? [];
    const needsRate = products.some((p) => p.price?.currency && p.price.currency.toUpperCase() !== 'USD');
    const rate = needsRate ? await usdRate(ctx) : null;
    return products.map((p) => normalizeCanbosoProduct(p, ctx.row.base_url, rate));
  },

  async purchase(ctx, req) {
    const body: Record<string, unknown> = { key: ctx.credentials.api_key, product_id: req.external_id, quantity: req.quantity };
    if (req.inputs.email) body.customer_email = String(req.inputs.email);
    if (req.inputs.account != null) {
      const accounts = Array.isArray(req.inputs.account) ? req.inputs.account.map(String) : [String(req.inputs.account)];
      body.customer_accounts = accounts;
    }
    if (req.external_id === BUSINESS_SLOT && req.inputs.months != null) body.slot_months = parseInt(String(req.inputs.months), 10);

    let rate: number | null = Number(ctx.config.usd_rate) > 0 ? Number(ctx.config.usd_rate) : null;
    try {
      const res = await providerFetch<CbPurchaseResponse>(ctx.row.base_url, '/api/v2/telegram-buyer/purchase', {
        method: 'POST',
        headers: { ...headers(ctx), 'Idempotency-Key': req.idempotency_key },
        body,
        timeoutMs: 45_000,
      });
      if (res.payment?.currency && res.payment.currency.toUpperCase() !== 'USD' && !rate) {
        rate = await usdRate(ctx).catch(() => null);
      }
      return mapCanbosoPurchase(res, rate);
    } catch (e) {
      if (e instanceof ProviderError && e.status != null) {
        // 400: invalid request / insufficient balance / missing input; 404: product gone → nothing charged
        if ([400, 401, 403, 404, 422].includes(e.status)) return failed(e, true);
        if (e.status === 409) {
          // "Inventory not enough" is safe to re-route; "in progress" / idempotency conflict is not
          const safe = /inventory|stock|not enough|sold out/i.test(e.message) && !/idempot|progress/i.test(e.message);
          return failed(e, safe);
        }
      }
      throw e; // 5xx / timeout → unknown; 429 → caller sets rate_limited_until
    }
  },

  async getOrder(ctx, ref) {
    const res = await providerFetch<{ orders: CbHistoryItem[] }>(ctx.row.base_url, '/api/v2/telegram-buyer/orders', {
      headers: headers(ctx),
      query: { orderCode: ref },
    });
    const o = res.orders?.[0];
    if (!o) throw new ProviderError('Order not found at provider', 404);
    const status = mapCanbosoStatus(o.status);
    return {
      status,
      provider_order_ref: o.orderCode ?? ref,
      provider_status: o.status,
      items: [], // history never includes credentials (see header comment)
      cost_usd: o.payment?.amountUsd != null ? Number(o.payment.amountUsd) : null,
      error: status === 'failed' ? `Provider order ${o.status}` : undefined,
      retryable: status === 'failed' ? (o.status ?? '').toLowerCase() === 'refunded' : undefined,
      raw: res,
    };
  },
};
