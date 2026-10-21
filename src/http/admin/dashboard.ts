import { Hono } from 'hono';
import { db } from '../../lib/db';
import { check, type AdminEnv } from './util';

export const dashboardRoutes = new Hono<AdminEnv>();

dashboardRoutes.get('/dashboard', async (c) => {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const d7 = new Date(now - 7 * 86400_000).toISOString();
  const d30 = new Date(now - 30 * 86400_000).toISOString();

  const [today, week, month, overview] = await Promise.all([
    db(c.env).rpc('admin_stats', { p_from: startOfToday.toISOString() }),
    db(c.env).rpc('admin_stats', { p_from: d7 }),
    db(c.env).rpc('admin_stats', { p_from: d30 }),
    db(c.env).rpc('admin_overview'),
  ]);
  return c.json({
    ok: true,
    today: check(today),
    week: check(week),
    month: check(month),
    overview: check(overview),
  });
});
