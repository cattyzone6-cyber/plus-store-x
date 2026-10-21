import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getSettings } from '../../lib/settings';
import { adminAuth } from './auth';
import type { AdminEnv } from './util';
import { dashboardRoutes } from './dashboard';
import { providerRoutes } from './providers';
import { catalogRoutes } from './catalog';
import { orderRoutes } from './orders';
import { userRoutes } from './users';
import { marketingRoutes } from './marketing';
import { configRoutes, emojiPreview } from './config';

export const adminApi = new Hono<AdminEnv>();

adminApi.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ ok: false, error: err.message }, err.status);
  // domain errors (OrderError, DepositError, TicketError...) carry a stable code
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Z_]+$/.test(code)) return c.json({ ok: false, error: code }, 409);
  console.error('admin api error', err);
  return c.json({ ok: false, error: err instanceof Error ? err.message : 'Internal error' }, 500);
});

// Public: lets the SPA initialise Supabase Auth (anon key is public by design).
adminApi.get('/config', async (c) => {
  const s = await getSettings(c.env);
  return c.json({
    ok: true,
    supabaseUrl: c.env.SUPABASE_URL,
    supabaseAnonKey: c.env.SUPABASE_ANON_KEY,
    brandName: s.brand.name,
    logoUrl: s.brand.logo_url,
  });
});

// Public: custom emoji previews are public Telegram assets (used by <img> tags without auth).
adminApi.get('/emojis/preview/:id', (c) => emojiPreview(c.env, c.req.param('id')));

adminApi.use('*', adminAuth);

adminApi.get('/me', (c) => c.json({ ok: true, admin: c.get('admin') }));

adminApi.route('/', dashboardRoutes);
adminApi.route('/', providerRoutes);
adminApi.route('/', catalogRoutes);
adminApi.route('/', orderRoutes);
adminApi.route('/', userRoutes);
adminApi.route('/', marketingRoutes);
adminApi.route('/', configRoutes);
