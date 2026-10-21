import { Hono, type Context } from 'hono';
import type { AppCtx, Env } from '../env';
import type { OrderRow, UserRow } from '../types';
import { getSettings } from '../lib/settings';
import { db, must } from '../lib/db';
import { sha256Hex } from '../lib/crypto';
import { listAllProducts } from '../services/catalog';
import { requiredInputs, fixedQuantity } from '../services/pricing';
import { cancelPendingOrder, createOrder, getOrder, getOrderByCode, OrderError, payOrderWithWallet } from '../services/orders';

// Public reseller API (/api/v1). Customers create keys in the bot (/api); purchases are paid
// from their wallet. Enabled with settings.features.reseller_api.

type Vars = { user: UserRow };
type HonoEnv = { Bindings: Env; Variables: Vars };

export const resellerApi = new Hono<HonoEnv>();

function appCtx(c: Context<HonoEnv>): AppCtx {
  return { env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) };
}

function fail(c: Context<HonoEnv>, status: 400 | 401 | 402 | 403 | 404 | 409 | 500, code: string, message?: string) {
  return c.json({ success: false, code, message: message ?? code }, status);
}

const ORDER_ERROR_STATUS: Record<string, 400 | 404 | 409> = {
  PRODUCT_NOT_FOUND: 404,
  SOLD_OUT: 409,
  NOT_ENOUGH_STOCK: 409,
  IDEMPOTENCY_CONFLICT: 409,
};

function serializeOrder(o: OrderRow) {
  const delivered = o.status === 'delivered' || o.status === 'partially_delivered';
  return {
    code: o.code,
    status: o.status,
    product_id: o.product_id,
    product_name: o.product_name,
    quantity: o.quantity,
    delivered_quantity: o.delivered_qty,
    unit_price: Number(o.unit_price),
    total: Number(o.total),
    refunded_amount: Number(o.refunded_amount),
    items: delivered ? o.delivery : [],
    warranty_until: o.warranty_until,
    created_at: o.created_at,
    delivered_at: o.delivered_at,
  };
}

resellerApi.use('*', async (c, next) => {
  const s = await getSettings(c.env);
  if (!s.features.reseller_api) return fail(c, 404, 'NOT_FOUND', 'Reseller API is disabled');
  const key = c.req.header('x-api-key')?.trim();
  if (!key) return fail(c, 401, 'UNAUTHORIZED', 'Missing X-API-Key header');

  const hash = await sha256Hex(key);
  const row = must(await db(c.env).from('api_keys').select('id,user_id,is_active,last_used_at').eq('key_hash', hash).maybeSingle(), 'api key') as
    { id: string; user_id: number; is_active: boolean; last_used_at: string | null } | null;
  if (!row || !row.is_active) return fail(c, 401, 'UNAUTHORIZED', 'Invalid API key');

  const user = must(await db(c.env).from('users').select('*').eq('id', row.user_id).maybeSingle(), 'api user') as UserRow | null;
  if (!user || user.is_banned) return fail(c, 403, 'FORBIDDEN', 'Account disabled');

  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) {
    c.executionCtx.waitUntil(Promise.resolve(db(c.env).from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)));
  }
  c.set('user', user);
  await next();
});

resellerApi.get('/me', (c) => {
  const u = c.get('user');
  return c.json({ success: true, user_id: u.id, username: u.username, balance: Number(u.balance), currency: 'USD' });
});

resellerApi.get('/products', async (c) => {
  const s = await getSettings(c.env);
  const views = await listAllProducts(c.env, s, c.get('user'), { includeSoldOut: true });
  return c.json({
    success: true,
    currency: 'USD',
    products: views.map(({ product: p, pricing }) => {
      const { ask } = requiredInputs(p, pricing.route);
      const fixed = fixedQuantity(pricing.route);
      return {
        id: p.id,
        category_id: p.category_id,
        name: p.name_en,
        name_ar: p.name_ar,
        description: p.description_en,
        price: pricing.unitPrice,
        original_price: pricing.originalUnitPrice,
        stock: pricing.available, // null = unlimited
        sold_out: pricing.soldOut,
        warranty_days: p.warranty_days,
        quantity: { min: fixed ?? p.min_qty, max: fixed ?? p.max_qty, fixed: fixed ?? null },
        qty_discounts: p.qty_discounts,
        inputs: ask.map((f) => ({ key: f.key, per_unit: !!f.per_unit, options: f.options ?? null, label: f.label_en ?? f.key })),
      };
    }),
  });
});

resellerApi.post('/orders', async (c) => {
  const app = appCtx(c);
  const user = c.get('user');
  let body: { product_id?: string; quantity?: number; inputs?: Record<string, unknown>; idempotency_key?: string };
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, 'BAD_REQUEST', 'Body must be JSON');
  }
  if (!body.product_id || typeof body.product_id !== 'string') return fail(c, 400, 'BAD_REQUEST', 'product_id is required');
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) return fail(c, 400, 'QTY_INVALID', 'quantity must be a positive integer');
  const idem = body.idempotency_key ? `api:${user.id}:${String(body.idempotency_key).slice(0, 100)}` : null;

  let order: OrderRow;
  try {
    order = await createOrder(app, { user, productId: body.product_id, quantity, inputs: body.inputs ?? {}, channel: 'api', idempotencyKey: idem });
  } catch (e) {
    if (e instanceof OrderError) return fail(c, ORDER_ERROR_STATUS[e.code] ?? 400, e.code, e.message);
    throw e;
  }

  if (order.status === 'pending_payment') {
    const paid = await payOrderWithWallet(app, order.id);
    if (!paid.ok) {
      await cancelPendingOrder(c.env, order.id, user.id);
      if (paid.code === 'INSUFFICIENT_BALANCE') return fail(c, 402, 'INSUFFICIENT_BALANCE', `Wallet balance too low (missing $${(paid.missing ?? 0).toFixed(2)})`);
      if (paid.code.startsWith('PROMO')) return fail(c, 409, paid.code);
      return fail(c, 500, paid.code);
    }
    order = paid.order;
    // fulfilment runs in the background; wait briefly so instant products return their items
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const fresh = await getOrder(c.env, order.id);
      if (fresh) order = fresh;
      if (!['paid', 'processing'].includes(order.status)) break;
    }
  }
  return c.json({ success: true, order: serializeOrder(order) });
});

resellerApi.get('/orders/:code', async (c) => {
  const order = await getOrderByCode(c.env, c.req.param('code'));
  if (!order || order.user_id !== c.get('user').id) return fail(c, 404, 'ORDER_NOT_FOUND');
  return c.json({ success: true, order: serializeOrder(order) });
});
