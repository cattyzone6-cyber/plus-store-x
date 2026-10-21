import { Hono } from 'hono';
import { z } from 'zod';
import type { BroadcastRow } from '../../types';
import { db } from '../../lib/db';
import { randomCode } from '../../lib/crypto';
import { enqueue } from '../../lib/jobs';
import { appCtx, body, check, fail, likePattern, log, paging, requireOwner, type AdminEnv } from './util';

export const marketingRoutes = new Hono<AdminEnv>();

const ownerOnly = async (c: Parameters<typeof requireOwner>[0], next: () => Promise<void>) => { requireOwner(c); await next(); };
for (const p of ['/promo-codes', '/promo-codes/*', '/redeem-codes', '/redeem-codes/*', '/giveaways', '/giveaways/*', '/freebies', '/freebies/*', '/broadcasts', '/broadcasts/*']) {
  marketingRoutes.use(p, ownerOnly);
}

const isoDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/));

// ─────────────────────────────────────────────────────────────────────────────
// Generic CRUD helper for simple tables
// ─────────────────────────────────────────────────────────────────────────────

function crud(path: string, table: string, schema: z.ZodObject<z.ZodRawShape>, opts: { order?: string; ascending?: boolean; search?: string[]; transform?: (b: Record<string, unknown>) => Record<string, unknown> } = {}) {
  marketingRoutes.get(path, async (c) => {
    const { page, limit, from, to } = paging(c, 50);
    let q = db(c.env).from(table).select('*', { count: 'exact' }).order(opts.order ?? 'created_at', { ascending: opts.ascending ?? false });
    const search = c.req.query('q')?.trim();
    if (search && opts.search?.length) q = q.or(opts.search.map((f) => `${f}.ilike.${likePattern(search)}`).join(','));
    const res = await q.range(from, to);
    return c.json({ ok: true, total: res.count ?? 0, page, limit, items: check(res) });
  });
  marketingRoutes.post(path, async (c) => {
    const b = (await body(c, schema)) as Record<string, unknown>;
    const res = await db(c.env).from(table).insert(opts.transform ? opts.transform(b) : b).select('*').single();
    if (res.error) fail(409, res.error.message.includes('duplicate') ? 'Already exists' : res.error.message);
    await log(c, `${table}.create`, table, (res.data as { id: string }).id);
    return c.json({ ok: true, item: res.data });
  });
  marketingRoutes.patch(`${path}/:id`, async (c) => {
    const b = (await body(c, schema.partial())) as Record<string, unknown>;
    const res = await db(c.env).from(table).update(opts.transform ? opts.transform(b) : b).eq('id', c.req.param('id')).select('*').single();
    if (res.error) fail(409, res.error.message);
    await log(c, `${table}.update`, table, c.req.param('id'), b);
    return c.json({ ok: true, item: res.data });
  });
  marketingRoutes.delete(`${path}/:id`, async (c) => {
    check(await db(c.env).from(table).delete().eq('id', c.req.param('id')));
    await log(c, `${table}.delete`, table, c.req.param('id'));
    return c.json({ ok: true });
  });
}

const upper = (b: Record<string, unknown>) => (typeof b.code === 'string' ? { ...b, code: b.code.trim().toUpperCase() } : b);

crud('/promo-codes', 'promo_codes', z.object({
  code: z.string().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().positive(),
  scope: z.enum(['all', 'category', 'product']).default('all'),
  target_ids: z.array(z.string().uuid()).default([]),
  min_order: z.number().min(0).default(0),
  max_uses: z.number().int().positive().nullable().optional(),
  per_user_limit: z.number().int().min(0).default(1),
  starts_at: isoDate.nullable().optional(),
  expires_at: isoDate.nullable().optional(),
  is_active: z.boolean().default(true),
  note: z.string().max(300).nullable().optional(),
}), { search: ['code', 'note'], transform: upper });

crud('/redeem-codes', 'redeem_codes', z.object({
  code: z.string().min(4).max(40).regex(/^[A-Za-z0-9_-]+$/),
  amount: z.number().positive(),
  max_uses: z.number().int().positive().default(1),
  expires_at: isoDate.nullable().optional(),
  is_active: z.boolean().default(true),
  note: z.string().max(300).nullable().optional(),
}), { search: ['code', 'note'], transform: upper });

marketingRoutes.post('/redeem-codes/generate', async (c) => {
  const b = await body(c, z.object({
    count: z.number().int().min(1).max(500),
    amount: z.number().positive(),
    max_uses: z.number().int().positive().default(1),
    prefix: z.string().max(10).regex(/^[A-Za-z0-9]*$/).default(''),
    length: z.number().int().min(6).max(20).default(10),
    expires_at: isoDate.nullable().optional(),
    note: z.string().max(300).nullable().optional(),
  }));
  const codes = new Set<string>();
  while (codes.size < b.count) codes.add(`${b.prefix.toUpperCase()}${b.prefix ? '-' : ''}${randomCode(b.length)}`);
  const rows = [...codes].map((code) => ({ code, amount: b.amount, max_uses: b.max_uses, expires_at: b.expires_at ?? null, note: b.note ?? null }));
  check(await db(c.env).from('redeem_codes').insert(rows));
  await log(c, 'redeem_codes.generate', 'redeem_codes', b.count, { amount: b.amount });
  return c.json({ ok: true, codes: [...codes] });
});

crud('/giveaways', 'giveaways', z.object({
  title_en: z.string().min(1).max(200),
  title_ar: z.string().max(200).nullable().optional(),
  description_en: z.string().max(4000).nullable().optional(),
  description_ar: z.string().max(4000).nullable().optional(),
  prize_type: z.enum(['balance', 'text']).default('balance'),
  prize_amount: z.number().positive().nullable().optional(),
  prize_text: z.string().max(2000).nullable().optional(),
  winners_count: z.number().int().min(1).max(1000).default(1),
  min_spent: z.number().min(0).default(0),
  ends_at: isoDate,
  status: z.enum(['active', 'ended', 'cancelled']).default('active'),
}), { search: ['title_en'] });

marketingRoutes.get('/giveaways/:id/entries', async (c) => {
  const rows = check(await db(c.env).from('giveaway_entries').select('user_id,is_winner,created_at').eq('giveaway_id', c.req.param('id')).order('created_at'));
  return c.json({ ok: true, items: rows });
});

/** End now: the cron picks winners on its next run (within a minute). */
marketingRoutes.post('/giveaways/:id/end', async (c) => {
  check(await db(c.env).from('giveaways').update({ ends_at: new Date().toISOString() }).eq('id', c.req.param('id')).eq('status', 'active'));
  await log(c, 'giveaway.end', 'giveaway', c.req.param('id'));
  return c.json({ ok: true });
});

crud('/freebies', 'freebies', z.object({
  title_en: z.string().min(1).max(200),
  title_ar: z.string().max(200).nullable().optional(),
  content_en: z.string().min(1).max(4000),
  content_ar: z.string().max(4000).nullable().optional(),
  is_active: z.boolean().default(true),
  sort: z.number().int().default(0),
}), { order: 'sort', ascending: true, search: ['title_en'] });

// ─────────────────────────────────────────────────────────────────────────────
// Broadcasts
// ─────────────────────────────────────────────────────────────────────────────

const broadcastSchema = z.object({
  text_en: z.string().min(1).max(4000),
  text_ar: z.string().max(4000).nullable().optional(),
  image_url: z.string().max(1000).nullable().optional(),
  buttons: z.array(z.object({ text: z.string().min(1).max(64), url: z.string().url() })).max(6).default([]),
  target: z.enum(['all', 'lang_en', 'lang_ar', 'buyers', 'non_buyers']).default('all'),
});

marketingRoutes.get('/broadcasts', async (c) => {
  const { page, limit, from, to } = paging(c, 25);
  const res = await db(c.env).from('broadcasts').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
  return c.json({ ok: true, total: res.count ?? 0, page, limit, items: check(res) });
});

marketingRoutes.post('/broadcasts', async (c) => {
  const b = await body(c, broadcastSchema);
  const row = check(await db(c.env).from('broadcasts').insert({ ...b, created_by: c.get('admin').user_id }).select('*').single()) as BroadcastRow;
  await log(c, 'broadcast.create', 'broadcast', row.id);
  return c.json({ ok: true, item: row });
});

marketingRoutes.patch('/broadcasts/:id', async (c) => {
  const b = await body(c, broadcastSchema.partial());
  const row = check(await db(c.env).from('broadcasts').update(b).eq('id', c.req.param('id')).eq('status', 'draft').select('*').maybeSingle());
  if (!row) fail(409, 'Only drafts can be edited');
  return c.json({ ok: true, item: row });
});

marketingRoutes.delete('/broadcasts/:id', async (c) => {
  check(await db(c.env).from('broadcasts').delete().eq('id', c.req.param('id')).in('status', ['draft', 'done', 'cancelled']));
  return c.json({ ok: true });
});

/** Estimated recipient count for a target. */
marketingRoutes.get('/broadcasts/audience/:target', async (c) => {
  const target = c.req.param('target');
  let q = db(c.env).from('users').select('id', { count: 'exact', head: true }).eq('blocked_bot', false).eq('is_banned', false);
  if (target === 'lang_en') q = q.eq('lang', 'en');
  if (target === 'lang_ar') q = q.eq('lang', 'ar');
  if (target === 'buyers') q = q.gt('orders_count', 0);
  if (target === 'non_buyers') q = q.eq('orders_count', 0);
  const res = await q;
  return c.json({ ok: true, count: res.count ?? 0 });
});

marketingRoutes.post('/broadcasts/:id/send', async (c) => {
  const id = c.req.param('id');
  const rows = check(await db(c.env).from('broadcasts').update({ status: 'queued', started_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'draft').select('id')) as { id: string }[];
  if (!rows.length) fail(409, 'Broadcast is not a draft');
  await enqueue(appCtx(c), { type: 'broadcast', broadcastId: id });
  await log(c, 'broadcast.send', 'broadcast', id);
  return c.json({ ok: true });
});

marketingRoutes.post('/broadcasts/:id/cancel', async (c) => {
  const id = c.req.param('id');
  check(await db(c.env).from('broadcasts').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id).in('status', ['queued', 'sending']));
  await log(c, 'broadcast.cancel', 'broadcast', id);
  return c.json({ ok: true });
});
