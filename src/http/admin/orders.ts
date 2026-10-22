import { Hono } from 'hono';
import { z } from 'zod';
import type { DepositRow, OrderRow } from '../../types';
import { db } from '../../lib/db';
import { enqueue } from '../../lib/jobs';
import { tg } from '../../lib/telegram';
import { cancelPendingOrder, deliverManual, getOrder, OrderError, refundOrder } from '../../services/orders';
import { approveManualDeposit, rejectDeposit } from '../../services/deposits';
import { appCtx, body, check, fail, likePattern, log, paging, requireOwner, type AdminEnv } from './util';

export const orderRoutes = new Hono<AdminEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

orderRoutes.get('/orders', async (c) => {
  const { page, limit, from, to } = paging(c, 25);
  let q = db(c.env).from('orders').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  const status = c.req.query('status');
  if (status) q = q.in('status', status.split(','));
  else if (c.req.query('include_unpaid') !== 'true') q = q.neq('status', 'pending_payment');
  const user = c.req.query('user_id');
  if (user) q = q.eq('user_id', Number(user));
  const product = c.req.query('product_id');
  if (product) q = q.eq('product_id', product);
  const provider = c.req.query('provider_id');
  if (provider) q = q.eq('provider_id', provider);
  const fromDate = c.req.query('from');
  if (fromDate) q = q.gte('created_at', fromDate);
  const toDate = c.req.query('to');
  if (toDate) q = q.lte('created_at', toDate);
  const search = c.req.query('q')?.trim();
  if (search) {
    if (/^\d+$/.test(search)) q = q.or(`user_id.eq.${search},id.eq.${search}`);
    else q = q.or(`code.ilike.${likePattern(search)},product_name.ilike.${likePattern(search)}`);
  }
  const res = await q.range(from, to);
  const items = check(res) as OrderRow[];
  const admin = c.get('admin');
  return c.json({
    ok: true, total: res.count ?? items.length, page, limit,
    items: items.map((o) => ({ ...o, delivery: admin.role === 'owner' ? o.delivery : o.delivery.map(() => '••••••'), cost_total: admin.role === 'owner' ? o.cost_total : null })),
  });
});

orderRoutes.get('/orders/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const order = await getOrder(c.env, id);
  if (!order) fail(404, 'Order not found');
  const [attempts, user, deposits, tickets] = await Promise.all([
    db(c.env).from('order_attempts').select('*').eq('order_id', id).order('created_at'),
    db(c.env).from('users').select('id,username,first_name,lang,balance').eq('id', order.user_id).maybeSingle(),
    db(c.env).from('deposits').select('id,method,amount_usd,status,created_at').eq('order_id', id),
    db(c.env).from('tickets').select('*').eq('order_id', id).order('created_at', { ascending: false }),
  ]);
  const providerName = order.provider_id
    ? ((check(await db(c.env).from('providers').select('name').eq('id', order.provider_id).maybeSingle()) as { name: string } | null)?.name ?? null)
    : null;
  // support sees the order flow, not credentials, costs or raw provider payloads (same as the list)
  const isOwner = c.get('admin').role === 'owner';
  const attemptRows = check(attempts) as Record<string, unknown>[];
  return c.json({
    ok: true,
    order: isOwner ? order : { ...order, delivery: order.delivery.map(() => '••••••'), cost_total: null },
    provider_name: providerName,
    attempts: isOwner ? attemptRows : attemptRows.map(({ request: _q, response: _r, ...rest }) => rest),
    user: check(user),
    deposits: check(deposits),
    tickets: check(tickets),
  });
});

function orderErr(e: unknown): never {
  if (e instanceof OrderError) fail(409, e.code);
  throw e;
}

orderRoutes.post('/orders/:id/deliver', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await body(c, z.object({ items: z.array(z.string()).default([]), text: z.string().optional() }));
  const items = [...b.items, ...(b.text ? b.text.split('\n') : [])].map((s) => s.trim()).filter(Boolean);
  try {
    const order = await deliverManual(appCtx(c), id, items, c.get('admin').user_id);
    await log(c, 'order.deliver', 'order', id, { items: items.length });
    return c.json({ ok: true, order });
  } catch (e) {
    orderErr(e);
  }
});

orderRoutes.post('/orders/:id/refund', async (c) => {
  requireOwner(c);
  const id = Number(c.req.param('id'));
  const b = await body(c, z.object({ amount: z.number().positive().nullable().optional(), note: z.string().max(500).nullable().optional() }));
  try {
    const order = await refundOrder(appCtx(c), id, b.amount ?? null, b.note ?? null, c.get('admin').user_id);
    await log(c, 'order.refund', 'order', id, b);
    return c.json({ ok: true, order });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('REFUND_EXCEEDS_TOTAL')) fail(409, 'REFUND_EXCEEDS_TOTAL');
    if (msg.includes('ORDER_NOT_PAID')) fail(409, 'ORDER_NOT_PAID');
    orderErr(e);
  }
});

orderRoutes.post('/orders/:id/retry', async (c) => {
  const id = Number(c.req.param('id'));
  const rows = check(await db(c.env).from('orders').update({ status: 'paid', error: null })
    .eq('id', id).in('status', ['failed', 'manual_pending', 'processing', 'awaiting_provider']).select('id')) as { id: number }[];
  if (!rows.length) fail(409, 'Order cannot be retried in its current status');
  await enqueue(appCtx(c), { type: 'fulfill_order', orderId: id });
  await log(c, 'order.retry', 'order', id);
  return c.json({ ok: true });
});

orderRoutes.post('/orders/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'));
  const ok = await cancelPendingOrder(c.env, id);
  if (!ok) fail(409, 'Only unpaid orders can be cancelled');
  await log(c, 'order.cancel', 'order', id);
  return c.json({ ok: true });
});

orderRoutes.post('/orders/:id/note', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await body(c, z.object({ note: z.string().max(2000).nullable() }));
  check(await db(c.env).from('orders').update({ admin_note: b.note }).eq('id', id));
  await log(c, 'order.note', 'order', id);
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deposits
// ─────────────────────────────────────────────────────────────────────────────

orderRoutes.get('/deposits', async (c) => {
  const { page, limit, from, to } = paging(c, 25);
  let q = db(c.env).from('deposits').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  const status = c.req.query('status');
  if (status) q = q.in('status', status.split(','));
  const method = c.req.query('method');
  if (method) q = q.eq('method', method);
  const user = c.req.query('user_id');
  if (user) q = q.eq('user_id', Number(user));
  if (c.req.query('review') === 'true') {
    // any deposit a customer sent proof for (ShamCash, Binance Pay ID in manual mode, or an auto match that failed)
    q = q.in('status', ['pending', 'confirming']).or('proof_file_id.not.is.null,proof_text.not.is.null');
  }
  const search = c.req.query('q')?.trim();
  if (search) {
    if (/^\d+$/.test(search)) q = q.eq('user_id', Number(search));
    else q = q.or(`reference.ilike.${likePattern(search)},external_id.ilike.${likePattern(search)},proof_text.ilike.${likePattern(search)}`);
  }
  const res = await q.range(from, to);
  return c.json({ ok: true, total: res.count ?? 0, page, limit, items: check(res) });
});

orderRoutes.get('/deposits/:id', async (c) => {
  const d = check(await db(c.env).from('deposits').select('*').eq('id', c.req.param('id')).maybeSingle()) as DepositRow | null;
  if (!d) fail(404, 'Deposit not found');
  const user = check(await db(c.env).from('users').select('id,username,first_name,balance,total_deposited').eq('id', d.user_id).maybeSingle());
  return c.json({ ok: true, deposit: d, user });
});

orderRoutes.post('/deposits/:id/approve', async (c) => {
  const id = c.req.param('id');
  const b = await body(c, z.object({ credit_usd: z.number().positive().optional() }));
  const d = check(await db(c.env).from('deposits').select('status,amount_usd').eq('id', id).maybeSingle()) as Pick<DepositRow, 'status' | 'amount_usd'> | null;
  if (!d) fail(404, 'Deposit not found');
  // support may only confirm the requested amount of an open deposit; anything else is the owner's call
  const customCredit = b.credit_usd != null && Math.abs(b.credit_usd - Number(d.amount_usd)) > 0.0001;
  if (customCredit || !['pending', 'confirming'].includes(d.status)) requireOwner(c);
  const res = await approveManualDeposit(appCtx(c), id, c.get('admin').user_id, b.credit_usd);
  return c.json({ ok: true, result: res ?? null });
});

orderRoutes.post('/deposits/:id/reject', async (c) => {
  const id = c.req.param('id');
  const b = await body(c, z.object({ note: z.string().max(500).optional() }));
  const res = await rejectDeposit(appCtx(c), id, c.get('admin').user_id, b.note);
  return c.json({ ok: true, result: res ?? null });
});

/** Stream the customer's payment screenshot without exposing the bot token. */
orderRoutes.get('/deposits/:id/proof', async (c) => {
  const d = check(await db(c.env).from('deposits').select('proof_file_id').eq('id', c.req.param('id')).maybeSingle()) as { proof_file_id: string | null } | null;
  if (!d?.proof_file_id) fail(404, 'No proof uploaded');
  return streamTelegramFile(c.env.TELEGRAM_BOT_TOKEN, await tg<{ file_path: string }>(c.env, 'getFile', { file_id: d.proof_file_id }));
});

export async function streamTelegramFile(token: string, file: { file_path?: string }, cacheSeconds = 300): Promise<Response> {
  if (!file.file_path) fail(404, 'File not available');
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok || !res.body) fail(502, 'Could not download file');
  const ext = file.file_path.split('.').pop()?.toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'webm' ? 'video/webm' : ext === 'tgs' ? 'application/x-tgsticker' : ext === 'pdf' ? 'application/pdf' : 'image/jpeg';
  return new Response(res.body, { headers: { 'content-type': type, 'cache-control': `private, max-age=${cacheSeconds}` } });
}
