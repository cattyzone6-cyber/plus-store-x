import { Hono } from 'hono';
import { z } from 'zod';
import type { TicketRow, UserRow } from '../../types';
import { db, dbErrorCode } from '../../lib/db';
import { escapeHtml } from '../../lib/i18n';
import { notifyUser } from '../../services/notify';
import { resolveTicket } from '../../services/tickets';
import { appCtx, body, check, fail, likePattern, log, paging, requireOwner, type AdminEnv } from './util';

export const userRoutes = new Hono<AdminEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

userRoutes.get('/users', async (c) => {
  const { page, limit, from, to } = paging(c, 25);
  const sort = c.req.query('sort') ?? 'joined_at';
  const allowed = ['joined_at', 'last_seen_at', 'balance', 'total_spent', 'total_deposited', 'orders_count'];
  let q = db(c.env).from('users').select('*', { count: 'exact' }).order(allowed.includes(sort) ? sort : 'joined_at', { ascending: false });
  const search = c.req.query('q')?.trim().replace(/^@/, '');
  if (search) {
    if (/^\d+$/.test(search)) q = q.eq('id', Number(search));
    else q = q.or(`username.ilike.${likePattern(search)},first_name.ilike.${likePattern(search)},last_name.ilike.${likePattern(search)}`);
  }
  if (c.req.query('banned') === 'true') q = q.eq('is_banned', true);
  if (c.req.query('with_balance') === 'true') q = q.gt('balance', 0);
  const res = await q.range(from, to);
  return c.json({ ok: true, total: res.count ?? 0, page, limit, items: check(res) });
});

userRoutes.get('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const user = check(await db(c.env).from('users').select('*').eq('id', id).maybeSingle()) as UserRow | null;
  if (!user) fail(404, 'User not found');
  const [orders, deposits, ledger, points, tickets, referrer, referrals] = await Promise.all([
    db(c.env).from('orders').select('id,code,product_name,quantity,total,status,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(30),
    db(c.env).from('deposits').select('id,method,amount_usd,credited_amount,status,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(30),
    db(c.env).from('wallet_ledger').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
    db(c.env).from('points_ledger').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(30),
    db(c.env).from('tickets').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
    user.referrer_id ? db(c.env).from('users').select('id,username,first_name').eq('id', user.referrer_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db(c.env).from('users').select('id,username,first_name,total_deposited,joined_at').eq('referrer_id', id).order('joined_at', { ascending: false }).limit(30),
  ]);
  return c.json({
    ok: true,
    user,
    orders: check(orders),
    deposits: check(deposits),
    ledger: check(ledger),
    points: check(points),
    tickets: check(tickets),
    referrer: check(referrer),
    referrals: check(referrals),
  });
});

userRoutes.post('/users/:id/balance', async (c) => {
  requireOwner(c);
  const id = Number(c.req.param('id'));
  const b = await body(c, z.object({ amount: z.number().refine((n) => n !== 0, 'amount must not be 0'), note: z.string().max(300).optional(), notify: z.boolean().optional() }));
  const res = await db(c.env).rpc('wallet_apply', {
    p_user_id: id, p_amount: b.amount, p_type: 'admin_adjust', p_ref_type: 'admin', p_ref_id: c.get('admin').email, p_note: b.note ?? null, p_created_by: c.get('admin').user_id,
  });
  if (res.error) fail(409, dbErrorCode(res.error.message) ?? res.error.message);
  await log(c, 'user.balance', 'user', id, b);
  if (b.notify) {
    const sign = b.amount > 0 ? '+' : '−';
    await notifyUser(c.env, id, `💰 <b>Wallet update</b>\n${sign}$${Math.abs(b.amount).toFixed(2)}${b.note ? `\n<i>${escapeHtml(b.note)}</i>` : ''}\nBalance: <b>$${Number(res.data).toFixed(2)}</b>`);
  }
  return c.json({ ok: true, balance: res.data });
});

userRoutes.patch('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await body(c, z.object({
    discount_percent: z.number().min(0).max(90).optional(),
    is_banned: z.boolean().optional(),
    ban_reason: z.string().max(300).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    lang: z.enum(['en', 'ar']).optional(),
  }));
  if (b.discount_percent !== undefined) requireOwner(c);
  const row = check(await db(c.env).from('users').update(b).eq('id', id).select('*').single());
  await log(c, 'user.update', 'user', id, b);
  return c.json({ ok: true, user: row });
});

userRoutes.post('/users/:id/message', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await body(c, z.object({ text: z.string().min(1).max(4000), html: z.boolean().optional() }));
  const ok = await notifyUser(c.env, id, b.html ? b.text : escapeHtml(b.text));
  await log(c, 'user.message', 'user', id);
  if (!ok) fail(502, 'Could not deliver the message (user may have blocked the bot)');
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tickets (support / warranty replacement / refund requests)
// ─────────────────────────────────────────────────────────────────────────────

userRoutes.get('/tickets', async (c) => {
  const { page, limit, from, to } = paging(c, 25);
  let q = db(c.env).from('tickets').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  const status = c.req.query('status');
  if (status) q = q.in('status', status.split(','));
  const kind = c.req.query('kind');
  if (kind) q = q.eq('kind', kind);
  const user = c.req.query('user_id');
  if (user) q = q.eq('user_id', Number(user));
  const res = await q.range(from, to);
  return c.json({ ok: true, total: res.count ?? 0, page, limit, items: check(res) });
});

userRoutes.get('/tickets/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const ticket = check(await db(c.env).from('tickets').select('*').eq('id', id).maybeSingle()) as TicketRow | null;
  if (!ticket) fail(404, 'Ticket not found');
  const [user, order] = await Promise.all([
    db(c.env).from('users').select('id,username,first_name,lang,balance').eq('id', ticket.user_id).maybeSingle(),
    ticket.order_id ? db(c.env).from('orders').select('*').eq('id', ticket.order_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  return c.json({ ok: true, ticket, user: check(user), order: check(order) });
});

userRoutes.post('/tickets/:id/resolve', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await body(c, z.object({
    resolution: z.enum(['replaced', 'refunded', 'rejected', 'answered']),
    note: z.string().max(2000).optional(),
    replacement_items: z.array(z.string()).optional(),
    replacement_text: z.string().optional(),
    refund_amount: z.number().positive().optional(),
  }));
  const items = [...(b.replacement_items ?? []), ...(b.replacement_text ? b.replacement_text.split('\n') : [])].map((s) => s.trim()).filter(Boolean);
  const result = await resolveTicket(appCtx(c), id, b.resolution, {
    adminId: c.get('admin').user_id,
    note: b.note,
    replacementItems: items.length ? items : undefined,
    refundAmount: b.refund_amount,
  });
  await log(c, 'ticket.resolve', 'ticket', id, { resolution: b.resolution });
  return c.json({ ok: true, result: result ?? null });
});
