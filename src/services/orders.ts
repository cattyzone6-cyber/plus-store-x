import type { AppCtx, Env } from '../env';
import type { OrderRow, ProductRow, PromoCodeRow, UserRow } from '../types';
import { getSettings, type AppSettings } from '../lib/settings';
import { db, dbErrorCode, must, rpc } from '../lib/db';
import { round2, round4 } from '../lib/money';
import { enqueue } from '../lib/jobs';
import { getProductView, loadOptions } from './catalog';
import { fixedQuantity, priceProduct, quote, requiredInputs, type SourceOption } from './pricing';
import { getAdapter, providerContext } from '../providers/registry';
import { ProviderError, type PurchaseResult } from '../providers/types';
import { notifyAdmins } from './notify';
import { sendDeliveryMessage, sendOrderStatusMessage } from './delivery';
import { getUser } from './users';

export class OrderError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Promo codes
// ─────────────────────────────────────────────────────────────────────────────

export async function validatePromo(
  env: Env,
  code: string,
  user: UserRow,
  product: ProductRow,
  subtotal: number,
): Promise<{ promo: PromoCodeRow; discount: number }> {
  const promo = must(
    await db(env).from('promo_codes').select('*').eq('code', code.trim().toUpperCase()).maybeSingle(),
    'promo',
  ) as PromoCodeRow | null;
  if (!promo || !promo.is_active) throw new OrderError('PROMO_INVALID');
  const now = Date.now();
  if (promo.starts_at && new Date(promo.starts_at).getTime() > now) throw new OrderError('PROMO_INVALID');
  if (promo.expires_at && new Date(promo.expires_at).getTime() < now) throw new OrderError('PROMO_EXPIRED');
  if (promo.max_uses != null && promo.uses >= promo.max_uses) throw new OrderError('PROMO_EXHAUSTED');
  if (promo.scope === 'product' && !promo.target_ids.includes(product.id)) throw new OrderError('PROMO_NOT_APPLICABLE');
  if (promo.scope === 'category' && (!product.category_id || !promo.target_ids.includes(product.category_id))) throw new OrderError('PROMO_NOT_APPLICABLE');
  if (subtotal < Number(promo.min_order)) throw new OrderError('PROMO_MIN_ORDER');
  if (promo.per_user_limit > 0) {
    const { count } = await db(env).from('promo_redemptions').select('id', { count: 'exact', head: true }).eq('promo_id', promo.id).eq('user_id', user.id);
    if ((count ?? 0) >= promo.per_user_limit) throw new OrderError('PROMO_USER_LIMIT');
  }
  const discount = promo.kind === 'percent' ? round2((subtotal * Number(promo.value)) / 100) : Number(promo.value);
  return { promo, discount: Math.min(discount, subtotal) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create & pay
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  user: UserRow;
  productId: string;
  quantity: number;
  inputs?: Record<string, unknown>;
  promoCode?: string | null;
  channel?: 'bot' | 'api';
  idempotencyKey?: string | null;
}

/** Validate inputs + price the order and insert it as pending_payment. */
export async function createOrder(app: AppCtx, input: CreateOrderInput): Promise<OrderRow> {
  const { env } = app;
  const s = await getSettings(env);

  if (input.idempotencyKey) {
    const existing = must(await db(env).from('orders').select('*').eq('idempotency_key', input.idempotencyKey).maybeSingle(), 'order idem') as OrderRow | null;
    if (existing) {
      if (existing.user_id !== input.user.id) throw new OrderError('IDEMPOTENCY_CONFLICT');
      return existing;
    }
  }

  const view = await getProductView(env, s, input.productId, input.user);
  if (!view || !view.product.is_active) throw new OrderError('PRODUCT_NOT_FOUND');
  const { product, pricing } = view;
  if (pricing.unitPrice == null) throw new OrderError('PRICE_UNAVAILABLE');
  if (pricing.soldOut) throw new OrderError('SOLD_OUT');

  const qty = Math.floor(input.quantity);
  const forced = fixedQuantity(pricing.route);
  if (forced && qty !== forced) throw new OrderError('QTY_INVALID', `Quantity must be ${forced}`);
  if (!forced && (qty < product.min_qty || qty > product.max_qty)) throw new OrderError('QTY_INVALID');
  if (pricing.available != null && qty > pricing.available) throw new OrderError('NOT_ENOUGH_STOCK');

  // inputs
  const { ask, fixed } = requiredInputs(product, pricing.route);
  const inputs: Record<string, unknown> = { ...fixed };
  for (const f of ask) {
    const v = input.inputs?.[f.key];
    if (f.per_unit) {
      const arr = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
      if (arr.length !== qty) throw new OrderError('INPUT_MISSING', f.key);
      if (new Set(arr).size !== arr.length) throw new OrderError('INPUT_DUPLICATE', f.key);
      inputs[f.key] = arr;
    } else {
      const str = v == null ? '' : String(v).trim();
      if (!str) throw new OrderError('INPUT_MISSING', f.key);
      if (f.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) throw new OrderError('INPUT_INVALID', f.key);
      if (f.options?.length && !f.options.map(String).includes(str)) throw new OrderError('INPUT_INVALID', f.key);
      inputs[f.key] = str;
    }
  }

  // price
  let q = quote(pricing, product, qty)!;
  let promo: PromoCodeRow | null = null;
  if (input.promoCode && s.features.promo_codes) {
    const res = await validatePromo(env, input.promoCode, input.user, product, q.subtotal);
    promo = res.promo;
    q = quote(pricing, product, qty, res.discount)!;
  }

  const row = {
    user_id: input.user.id,
    product_id: product.id,
    product_name: product.name_en,
    quantity: qty,
    unit_price: q.unitPrice,
    original_unit_price: q.originalUnitPrice,
    subtotal: q.subtotal,
    discount_amount: q.promoDiscount,
    total: q.total,
    promo_code_id: promo?.id ?? null,
    promo_code: promo?.code ?? null,
    user_discount_percent: pricing.userDiscountPercent,
    status: 'pending_payment',
    inputs,
    warranty_days: product.warranty_days,
    idempotency_key: input.idempotencyKey ?? null,
    channel: input.channel ?? 'bot',
    code: `${s.brand.order_prefix || 'PSX'}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
  };
  return must(await db(env).from('orders').insert(row).select('*').single(), 'order insert') as OrderRow;
}

export type PayResult =
  | { ok: true; order: OrderRow }
  | { ok: false; code: string; order: OrderRow | null; missing?: number };

/** Pay a pending order from the wallet, then start fulfilment in the background. */
export async function payOrderWithWallet(app: AppCtx, orderId: number): Promise<PayResult> {
  try {
    const order = await rpc<OrderRow>(app.env, 'order_pay_wallet', { p_order_id: orderId });
    await enqueue(app, { type: 'fulfill_order', orderId: order.id });
    return { ok: true, order };
  } catch (e) {
    const code = dbErrorCode(e) ?? 'PAYMENT_FAILED';
    const order = await getOrder(app.env, orderId);
    if (code === 'INSUFFICIENT_BALANCE' && order) {
      const user = await getUser(app.env, order.user_id);
      return { ok: false, code, order, missing: round2(Number(order.total) - Number(user?.balance ?? 0)) };
    }
    if (code !== 'INSUFFICIENT_BALANCE') console.error('payOrderWithWallet', orderId, e);
    return { ok: false, code, order };
  }
}

export async function cancelPendingOrder(env: Env, orderId: number, userId?: number): Promise<boolean> {
  let q = db(env).from('orders').update({ status: 'cancelled' }).eq('id', orderId).eq('status', 'pending_payment');
  if (userId) q = q.eq('user_id', userId);
  const res = must(await q.select('id'), 'order cancel') as { id: number }[];
  return res.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fulfilment (routing + failover)
// ─────────────────────────────────────────────────────────────────────────────

async function claimForProcessing(env: Env, orderId: number): Promise<OrderRow | null> {
  const rows = must(
    await db(env)
      .from('orders')
      .update({ status: 'processing' })
      .eq('id', orderId)
      .eq('status', 'paid')
      .select('*'),
    'order claim',
  ) as OrderRow[];
  return rows[0] ?? null;
}

async function patchOrder(env: Env, orderId: number, patch: Partial<OrderRow>): Promise<OrderRow> {
  return must(await db(env).from('orders').update(patch).eq('id', orderId).select('*').single(), 'order patch') as OrderRow;
}

function isRetryableError(e: unknown): boolean {
  if (e instanceof ProviderError && e.status != null) return [400, 401, 402, 403, 404, 422].includes(e.status);
  return false;
}

/**
 * Deliver a paid order: try each usable source in routing order.
 *  - stock   → claim items atomically
 *  - manual  → admin queue
 *  - provider→ purchase via adapter (idempotent per order+source)
 * Failures that are known to be safe (nothing charged) move on to the next source
 * when on_failure = 'next_source'. Unknown outcomes stop and alert the admin.
 */
export async function fulfillOrder(app: AppCtx, orderId: number): Promise<void> {
  const { env } = app;
  const order = await claimForProcessing(env, orderId);
  if (!order) return; // already being processed / not paid
  const s = await getSettings(env);

  const product = order.product_id
    ? (must(await db(env).from('products').select('*').eq('id', order.product_id).maybeSingle(), 'product') as ProductRow | null)
    : null;
  if (!product) {
    await failAll(app, s, order, 'Product no longer exists');
    return;
  }

  if (product.fulfillment === 'manual') {
    await toManual(app, order, 'Manual product');
    return;
  }

  const options = (await loadOptions(env, [product])).get(product.id) ?? [];
  const pricing = priceProduct(product, options, s, null);
  const onFailure = product.on_failure ?? s.pricing.default_on_failure;

  let route: SourceOption[] = pricing.route.filter((o) => o.available == null || o.available >= order.quantity);
  if (s.pricing.block_loss) {
    route = route.filter((o) => o.unitCost == null || o.unitCost * order.quantity <= Number(order.total) + 0.0001 || o.source.kind !== 'provider');
  }
  if (!route.length) {
    await failAll(app, s, order, 'No source available');
    return;
  }

  const errors: string[] = [];
  for (const opt of route) {
    if (opt.source.kind === 'manual') {
      await toManual(app, order, errors.join('; ') || 'Manual source');
      return;
    }

    if (opt.source.kind === 'stock') {
      try {
        const items = must(
          await db(env).rpc('stock_claim', { p_product_id: product.id, p_qty: order.quantity, p_order_id: order.id }),
          'stock_claim',
        ) as { content: string }[];
        await deliverOrder(app, order, items.map((i) => i.content), {
          sourceId: opt.source.id,
          costTotal: product.base_cost != null ? round4(Number(product.base_cost) * order.quantity) : null,
        });
        await checkLowStock(app, s, product);
        return;
      } catch (e) {
        errors.push(`stock: ${dbErrorCode(e) ?? (e as Error).message}`);
        continue;
      }
    }

    // provider
    const pp = opt.providerProduct!;
    const prov = opt.provider!;
    const adapter = getAdapter(prov.kind);
    const idem = `${order.code}-${opt.source.id.slice(0, 8)}`;
    const attempt = must(
      await db(env).from('order_attempts').insert({
        order_id: order.id, source_id: opt.source.id, provider_id: prov.id, provider_product_id: pp.id,
        idempotency_key: idem, status: 'pending', request: { external_id: pp.external_id, quantity: order.quantity, inputs: order.inputs },
      }).select('id').single(),
      'attempt insert',
    ) as { id: number };

    let result: PurchaseResult;
    try {
      const ctx = await providerContext(env, prov);
      result = await adapter.purchase(ctx, {
        external_id: pp.external_id,
        quantity: order.quantity,
        idempotency_key: idem,
        reference: order.code,
        inputs: order.inputs,
      });
    } catch (e) {
      const retryable = isRetryableError(e);
      result = { status: 'failed', provider_order_ref: null, provider_status: null, items: [], cost_usd: null, error: (e as Error).message, retryable, raw: e instanceof ProviderError ? e.body : null };
      if (e instanceof ProviderError && e.status === 429 && e.retryAfterSec) {
        await db(env).from('providers').update({ rate_limited_until: new Date(Date.now() + e.retryAfterSec * 1000).toISOString() }).eq('id', prov.id);
        result.retryable = true;
      }
    }

    await db(env).from('order_attempts').update({
      status: result.status === 'completed' ? 'success' : result.status,
      response: result.raw ?? null,
      error: result.error ?? null,
    }).eq('id', attempt.id);

    const common = {
      source_id: opt.source.id,
      provider_id: prov.id,
      provider_product_id: pp.id,
      provider_order_ref: result.provider_order_ref,
      provider_status: result.provider_status,
      cost_total: result.cost_usd ?? (opt.unitCost != null ? round4(opt.unitCost * order.quantity) : null),
    };

    if (result.status === 'completed') {
      if (!result.items.length && pp.delivery_kind !== 'activation') {
        // paid at the provider but no credentials returned → a human must fetch them
        await patchOrder(env, order.id, common);
        await toManual(app, order, `${prov.name} completed order ${result.provider_order_ref ?? ''} without credentials — copy them from the provider`);
        return;
      }
      await deliverOrder(app, order, result.items, { sourceId: opt.source.id, costTotal: common.cost_total, extra: common });
      return;
    }
    if (result.status === 'pending') {
      const updated = await patchOrder(env, order.id, { ...common, status: 'awaiting_provider', next_check_at: new Date(Date.now() + 60_000).toISOString() });
      await sendOrderStatusMessage(app, updated, 'order_awaiting_provider');
      return;
    }

    // failed
    errors.push(`${prov.name}: ${result.error ?? 'failed'}`);
    if (!result.retryable) {
      // unknown outcome → do not re-route, let a human check the provider
      await patchOrder(env, order.id, { ...common, status: 'failed', error: errors.join('; ') });
      await notifyAdmins(env, 'order_failed',
        `⚠️ <b>Order ${order.code} needs attention</b>\nProvider <b>${prov.name}</b> returned an unknown result.\nCheck the provider panel, then deliver manually or refund.\n<code>${(result.error ?? '').slice(0, 300)}</code>`);
      await sendOrderStatusMessage(app, { ...order, status: 'failed' }, 'order_delayed');
      return;
    }
    if (onFailure === 'refund') {
      await failAll(app, s, order, errors.join('; '), 'refund');
      return;
    }
    if (onFailure === 'manual') {
      await toManual(app, order, errors.join('; '));
      return;
    }
    // next_source → continue loop
  }

  await failAll(app, s, order, errors.join('; '));
}

/** Every source failed (or none available). */
async function failAll(app: AppCtx, s: AppSettings, order: OrderRow, reason: string, force?: 'refund' | 'manual'): Promise<void> {
  const action = force ?? s.pricing.all_failed_action;
  if (action === 'manual') {
    await toManual(app, order, reason);
    return;
  }
  await patchOrder(app.env, order.id, { status: 'failed', error: reason });
  const refunded = await rpc<OrderRow>(app.env, 'order_refund', { p_order_id: order.id, p_amount: Number(order.total), p_note: `Auto refund ${order.code}` });
  await sendOrderStatusMessage(app, refunded, 'order_refunded_auto');
  await notifyAdmins(app.env, 'order_failed', `↩️ <b>Order ${order.code} auto-refunded</b> (${order.product_name} × ${order.quantity}, $${Number(order.total).toFixed(2)})\n<code>${reason.slice(0, 400)}</code>`);
}

async function toManual(app: AppCtx, order: OrderRow, reason: string): Promise<void> {
  const updated = await patchOrder(app.env, order.id, { status: 'manual_pending', error: reason || null });
  await sendOrderStatusMessage(app, updated, 'order_manual_pending');
  const inputs = Object.entries(order.inputs ?? {}).map(([k, v]) => `${k}: <code>${Array.isArray(v) ? v.join(', ') : String(v)}</code>`).join('\n');
  await notifyAdmins(app.env, 'manual_order',
    `🧑‍💻 <b>Manual order ${order.code}</b>\n${order.product_name} × ${order.quantity} — $${Number(order.total).toFixed(2)}\nUser: <code>${order.user_id}</code>${inputs ? `\n${inputs}` : ''}${reason ? `\n<i>${reason.slice(0, 300)}</i>` : ''}\n\nReply in the admin panel → Orders, or tap below.`,
    [[{ text: '📦 Deliver', callback_data: `adm:deliver:${order.id}`, style: 'success' }, { text: '↩️ Refund', callback_data: `adm:refund:${order.id}`, style: 'danger' }]]);
}

/** Mark delivered, award cashback, update counters and message the customer. */
export async function deliverOrder(
  app: AppCtx,
  order: OrderRow,
  items: string[],
  opts: { sourceId?: string | null; costTotal?: number | null; extra?: Partial<OrderRow>; adminId?: string | null } = {},
): Promise<OrderRow> {
  const { env } = app;
  const s = await getSettings(env);
  const now = new Date();
  const partial = items.length > 0 && items.length < order.quantity;
  const warrantyUntil = order.warranty_days > 0 ? new Date(now.getTime() + order.warranty_days * 86400_000).toISOString() : null;

  let updated = await patchOrder(env, order.id, {
    ...(opts.extra ?? {}),
    source_id: opts.sourceId ?? order.source_id,
    cost_total: opts.costTotal ?? order.cost_total,
    status: partial ? 'partially_delivered' : 'delivered',
    delivery: items,
    delivered_qty: partial ? items.length : order.quantity,
    delivered_at: now.toISOString(),
    warranty_until: warrantyUntil,
    error: null,
  });

  if (order.product_id) {
    const p = must(await db(env).from('products').select('sold_count').eq('id', order.product_id).maybeSingle(), 'sold') as { sold_count: number } | null;
    if (p) await db(env).from('products').update({ sold_count: p.sold_count + updated.delivered_qty }).eq('id', order.product_id);
  }

  if (partial) {
    const missing = order.quantity - items.length;
    const amount = round2((Number(order.total) / order.quantity) * missing);
    if (amount > 0) updated = await rpc<OrderRow>(env, 'order_refund', { p_order_id: order.id, p_amount: amount, p_note: `Partial refund (${missing} not delivered)` });
  }

  // cashback points
  if (s.features.cashback && s.cashback.points_per_usd > 0) {
    const paid = Number(updated.total) - Number(updated.refunded_amount);
    const pts = Math.floor(paid * s.cashback.points_per_usd);
    if (pts > 0) {
      await rpc(env, 'points_apply', { p_user_id: order.user_id, p_delta: pts, p_reason: 'cashback', p_ref_id: order.code });
      updated = await patchOrder(env, order.id, { points_awarded: pts });
    }
  }

  if (updated.channel === 'bot') await sendDeliveryMessage(app, updated);

  await notifyAdmins(env, 'new_order',
    `🛒 <b>New order ${updated.code}</b>\n${updated.product_name} × ${updated.delivered_qty} — $${Number(updated.total).toFixed(2)}${updated.cost_total != null ? ` (cost $${Number(updated.cost_total).toFixed(2)})` : ''}\nUser: <code>${updated.user_id}</code>${opts.adminId ? '\n<i>delivered by admin</i>' : ''}`);
  return updated;
}

/** Admin delivers a manual / failed order with the given items. */
export async function deliverManual(app: AppCtx, orderId: number, items: string[], adminId?: string | null): Promise<OrderRow> {
  const order = await getOrder(app.env, orderId);
  if (!order) throw new OrderError('ORDER_NOT_FOUND');
  if (!['manual_pending', 'failed', 'processing', 'awaiting_provider', 'paid'].includes(order.status)) throw new OrderError('ORDER_NOT_DELIVERABLE');
  return deliverOrder(app, order, items, { adminId });
}

/** Re-check an order waiting on a provider (cron). */
export async function checkAwaitingOrder(app: AppCtx, orderId: number): Promise<void> {
  const { env } = app;
  const order = await getOrder(env, orderId);
  if (!order || order.status !== 'awaiting_provider' || !order.provider_id || !order.provider_order_ref) return;
  const prov = must(await db(env).from('providers').select('*').eq('id', order.provider_id).single(), 'provider') as import('../types').ProviderRow;
  const pp = order.provider_product_id
    ? (must(await db(env).from('provider_products').select('external_id,delivery_kind').eq('id', order.provider_product_id).maybeSingle(), 'pp') as { external_id: string; delivery_kind: string } | null)
    : null;
  const s = await getSettings(env);
  const attempts = order.attempts + 1;

  let result: PurchaseResult;
  try {
    result = await getAdapter(prov.kind).getOrder(await providerContext(env, prov), order.provider_order_ref, {
      external_id: pp?.external_id, quantity: order.quantity, reference: order.code,
    });
  } catch (e) {
    // transient: back off
    const delayMin = Math.min(60, 2 ** Math.min(attempts, 6));
    await patchOrder(env, order.id, { attempts, next_check_at: new Date(Date.now() + delayMin * 60_000).toISOString(), error: (e as Error).message });
    return;
  }

  if (result.status === 'completed') {
    // only activation products legitimately complete without items; anything else needs a human
    if (!result.items.length && pp?.delivery_kind !== 'activation') {
      await patchOrder(env, order.id, { provider_status: result.provider_status });
      await toManual(app, order, `${prov.name} completed order ${order.provider_order_ref} without credentials — copy them from the provider`);
      return;
    }
    await deliverOrder(app, order, result.items, { costTotal: result.cost_usd ?? order.cost_total, extra: { provider_status: result.provider_status } });
    return;
  }
  if (result.status === 'failed') {
    await patchOrder(env, order.id, { status: 'processing', provider_status: result.provider_status });
    await failAll(app, s, order, `${prov.name}: ${result.error ?? result.provider_status ?? 'failed'}`);
    return;
  }
  const delayMin = Math.min(30, 1 + attempts);
  await patchOrder(env, order.id, { attempts, provider_status: result.provider_status, next_check_at: new Date(Date.now() + delayMin * 60_000).toISOString() });
  if (attempts === 60) {
    await notifyAdmins(env, 'order_failed', `⏳ <b>Order ${order.code}</b> is still pending at <b>${prov.name}</b> after many checks (status: ${result.provider_status ?? 'unknown'}).`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Refunds & queries
// ─────────────────────────────────────────────────────────────────────────────

export async function refundOrder(app: AppCtx, orderId: number, amount: number | null, note: string | null, adminId?: string | null): Promise<OrderRow> {
  const order = await getOrder(app.env, orderId);
  if (!order) throw new OrderError('ORDER_NOT_FOUND');
  const remaining = round4(Number(order.total) - Number(order.refunded_amount));
  const amt = amount == null ? remaining : Math.min(amount, remaining);
  if (amt <= 0) throw new OrderError('NOTHING_TO_REFUND');
  const updated = await rpc<OrderRow>(app.env, 'order_refund', { p_order_id: orderId, p_amount: amt, p_note: note, p_by: adminId ?? null });
  await sendOrderStatusMessage(app, updated, 'order_refunded', { amount: amt });
  return updated;
}

export async function getOrder(env: Env, id: number): Promise<OrderRow | null> {
  return must(await db(env).from('orders').select('*').eq('id', id).maybeSingle(), 'order') as OrderRow | null;
}

export async function getOrderByCode(env: Env, code: string): Promise<OrderRow | null> {
  return must(await db(env).from('orders').select('*').eq('code', code.trim().toUpperCase()).maybeSingle(), 'order') as OrderRow | null;
}

export async function listUserOrders(env: Env, userId: number, limit = 10, offset = 0): Promise<OrderRow[]> {
  return must(
    await db(env).from('orders').select('*').eq('user_id', userId).neq('status', 'pending_payment').neq('status', 'cancelled')
      .order('created_at', { ascending: false }).range(offset, offset + limit - 1),
    'orders',
  ) as OrderRow[];
}

async function checkLowStock(app: AppCtx, s: AppSettings, product: ProductRow): Promise<void> {
  const { count } = await db(app.env).from('stock_items').select('id', { count: 'exact', head: true }).eq('product_id', product.id).eq('status', 'available');
  const left = count ?? 0;
  if (left <= s.notifications.low_stock_threshold) {
    await notifyAdmins(app.env, 'low_stock', `📉 <b>Low stock</b>: ${product.name_en} — ${left} left`);
  }
}
