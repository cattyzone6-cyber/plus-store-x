import { Hono } from 'hono';
import { db } from '../../lib/db';
import { check, fail, requireOwner, type AdminEnv } from './util';

export const profitRoutes = new Hono<AdminEnv>();

const DAY = 86400_000;

/** `from`/`to` as ISO dates or datetimes; `to` is exclusive. Default: the last 30 days. */
function parseTime(v: string | undefined, name: string): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (!isFinite(t)) fail(422, `${name}: invalid date`);
  return t;
}

profitRoutes.get('/profit', async (c) => {
  requireOwner(c);
  const now = Date.now();
  const to = parseTime(c.req.query('to'), 'to') ?? now;
  const from = parseTime(c.req.query('from'), 'from') ?? to - 30 * DAY;
  if (from >= to) fail(422, 'from must be before to');
  if (to - from > 366 * DAY) fail(422, 'Range is limited to 366 days');

  const res = await db(c.env).rpc('admin_profit', { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
  return c.json({ ok: true, ...(check(res) as Record<string, unknown>) });
});
