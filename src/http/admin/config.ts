import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminRow, DepositMethod, EmojiRow } from '../../types';
import { db } from '../../lib/db';
import { mask } from '../../lib/crypto';
import { DICTS } from '../../lib/i18n';
import { DEFAULT_EMOJIS, invalidateEmojis } from '../../lib/emoji';
import {
  DEFAULT_SETTINGS, SECRET_KEYS, SETTINGS_KEYS, getSecret, getSettings, saveSettingsSection, setSecret,
  type SecretKey, type SettingsKey,
} from '../../lib/settings';
import { tg } from '../../lib/telegram';
import { testGatewayKeys } from '../../payments/test';
import { setupBotCommands } from '../../bot/commands';
import { clearAuthCache } from './auth';
import { streamTelegramFile } from './orders';
import { body, check, fail, log, paging, requireOwner, type AdminEnv } from './util';

export const configRoutes = new Hono<AdminEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

configRoutes.get('/settings', async (c) => {
  const s = await getSettings(c.env, true);
  return c.json({ ok: true, settings: s, defaults: DEFAULT_SETTINGS, has_queue: !!c.env.JOBS });
});

configRoutes.put('/settings/:section', async (c) => {
  requireOwner(c);
  const section = c.req.param('section') as SettingsKey;
  if (!SETTINGS_KEYS.includes(section) || section === 'texts') fail(404, 'Unknown settings section');
  const value = await body(c, z.record(z.string(), z.unknown()));
  if (section === 'system' && value.plan === 'paid' && !c.env.JOBS) {
    // allowed (bigger batches), but warn the UI that the queue binding is missing
  }
  await saveSettingsSection(c.env, section, value as never);
  await log(c, 'settings.update', 'settings', section);
  const s = await getSettings(c.env, true);
  return c.json({ ok: true, settings: s });
});

configRoutes.get('/texts', async (c) => {
  const s = await getSettings(c.env, true);
  const keys = [...new Set([...Object.keys(DICTS.en), ...Object.keys(DICTS.ar), ...Object.keys(s.texts ?? {})])].sort();
  return c.json({
    ok: true,
    items: keys.map((key) => ({
      key,
      default_en: DICTS.en[key] ?? '',
      default_ar: DICTS.ar[key] ?? '',
      en: s.texts?.[key]?.en ?? '',
      ar: s.texts?.[key]?.ar ?? '',
    })),
  });
});

configRoutes.put('/texts', async (c) => {
  requireOwner(c);
  const b = await body(c, z.object({ texts: z.record(z.string(), z.object({ en: z.string().optional(), ar: z.string().optional() })) }));
  const s = await getSettings(c.env, true);
  const merged: Record<string, { en?: string; ar?: string }> = { ...(s.texts ?? {}) };
  for (const [k, v] of Object.entries(b.texts)) {
    const entry = { ...(merged[k] ?? {}), ...v };
    if (!entry.en?.trim()) delete entry.en;
    if (!entry.ar?.trim()) delete entry.ar;
    if (entry.en || entry.ar) merged[k] = entry;
    else delete merged[k];
  }
  // texts is replaced as a whole (deepMerge would keep deleted keys otherwise)
  check(await db(c.env).from('settings').upsert({ key: 'texts', value: merged, updated_at: new Date().toISOString() }));
  await getSettings(c.env, true);
  await log(c, 'texts.update', 'settings', 'texts', Object.keys(b.texts));
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Secrets (payment gateway keys)
// ─────────────────────────────────────────────────────────────────────────────

configRoutes.get('/secrets', async (c) => {
  requireOwner(c);
  const items = await Promise.all(SECRET_KEYS.map(async (key) => {
    const v = await getSecret(c.env, key).catch(() => null);
    return { key, set: !!v, masked: mask(v) };
  }));
  return c.json({ ok: true, items });
});

/** Settings → Payments "Test keys": one read-only call to the gateway with the saved keys. */
configRoutes.post('/payments/test/:method', async (c) => {
  requireOwner(c);
  const method = c.req.param('method');
  if (!['binance_pay', 'binance_id', 'nowpayments'].includes(method)) fail(404, 'Unknown payment method');
  const s = await getSettings(c.env, true);
  const result = await testGatewayKeys(c.env, s, method as DepositMethod);
  await log(c, 'payments.test', 'payment', method, { ok: result.ok });
  return c.json({ ok: true, result });
});

configRoutes.put('/secrets', async (c) => {
  requireOwner(c);
  const b = await body(c, z.object({ key: z.enum(SECRET_KEYS as unknown as [SecretKey, ...SecretKey[]]), value: z.string().max(5000).nullable() }));
  await setSecret(c.env, b.key, b.value?.trim() || null);
  await log(c, 'secret.update', 'secret', b.key, { cleared: !b.value });
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Emoji library
// ─────────────────────────────────────────────────────────────────────────────

configRoutes.get('/emojis', async (c) => {
  const rows = check(await db(c.env).from('emojis').select('*')) as EmojiRow[];
  const map = new Map(rows.map((r) => [r.key, r]));
  const keys = [...new Set([...Object.keys(DEFAULT_EMOJIS), ...rows.map((r) => r.key)])];
  return c.json({
    ok: true,
    items: keys.map((key) => ({
      key,
      default_fallback: DEFAULT_EMOJIS[key] ?? '',
      fallback: map.get(key)?.fallback ?? DEFAULT_EMOJIS[key] ?? '',
      custom_emoji_id: map.get(key)?.custom_emoji_id ?? null,
      label: map.get(key)?.label ?? null,
    })),
  });
});

configRoutes.put('/emojis/:key', async (c) => {
  requireOwner(c);
  const key = c.req.param('key');
  if (!/^[a-z0-9_]{1,40}$/.test(key)) fail(422, 'Invalid key');
  const b = await body(c, z.object({
    custom_emoji_id: z.string().regex(/^\d{5,30}$/).nullable().optional(),
    fallback: z.string().min(1).max(16).optional(),
    label: z.string().max(80).nullable().optional(),
  }));
  const current = check(await db(c.env).from('emojis').select('*').eq('key', key).maybeSingle()) as EmojiRow | null;
  check(await db(c.env).from('emojis').upsert({
    key,
    custom_emoji_id: b.custom_emoji_id !== undefined ? b.custom_emoji_id : current?.custom_emoji_id ?? null,
    fallback: b.fallback ?? current?.fallback ?? DEFAULT_EMOJIS[key] ?? '⭐',
    label: b.label !== undefined ? b.label : current?.label ?? null,
    updated_at: new Date().toISOString(),
  }));
  invalidateEmojis();
  await log(c, 'emoji.update', 'emoji', key, b);
  return c.json({ ok: true });
});

configRoutes.delete('/emojis/:key', async (c) => {
  requireOwner(c);
  check(await db(c.env).from('emojis').delete().eq('key', c.req.param('key')));
  invalidateEmojis();
  return c.json({ ok: true });
});

configRoutes.get('/emoji-inbox', async (c) => {
  const rows = check(await db(c.env).from('emoji_inbox').select('*').order('created_at', { ascending: false }).limit(200));
  return c.json({ ok: true, items: rows });
});

configRoutes.delete('/emoji-inbox/:id', async (c) => {
  check(await db(c.env).from('emoji_inbox').delete().eq('custom_emoji_id', c.req.param('id')));
  return c.json({ ok: true });
});

/** Preview image of a custom emoji (public: registered before auth in index.ts). */
export async function emojiPreview(env: AdminEnv['Bindings'], customEmojiId: string): Promise<Response> {
  if (!/^\d{5,30}$/.test(customEmojiId)) return new Response('bad id', { status: 400 });
  try {
    const stickers = await tg<{ file_id: string; thumbnail?: { file_id: string }; is_animated?: boolean; is_video?: boolean }[]>(env, 'getCustomEmojiStickers', { custom_emoji_ids: [customEmojiId] });
    const st = stickers[0];
    if (!st) return new Response('not found', { status: 404 });
    const fileId = st.thumbnail?.file_id ?? st.file_id;
    const file = await tg<{ file_path: string }>(env, 'getFile', { file_id: fileId });
    const res = await streamTelegramFile(env.TELEGRAM_BOT_TOKEN, file, 86400);
    const headers = new Headers(res.headers);
    headers.set('cache-control', 'public, max-age=86400');
    return new Response(res.body, { headers });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Uploads (Supabase Storage, public bucket)
// ─────────────────────────────────────────────────────────────────────────────

// created by supabase/config.toml (local) — created on first upload elsewhere
const BUCKET = 'public-assets';
let bucketReady = false;

configRoutes.post('/upload', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') fail(422, 'file is required');
  const f = file as File;
  if (f.size > 5 * 1024 * 1024) fail(422, 'Max 5 MB');
  if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(f.type)) fail(422, 'Only images are allowed');
  const storage = db(c.env).storage;
  if (!bucketReady) {
    const { error } = await storage.createBucket(BUCKET, { public: true });
    if (error && !/exist/i.test(error.message)) fail(500, `Storage: ${error.message}`);
    bucketReady = true;
  }
  const ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'png';
  const path = `uploads/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await storage.from(BUCKET).upload(path, await f.arrayBuffer(), { contentType: f.type, upsert: false });
  if (error) fail(500, `Upload failed: ${error.message}`);
  const { data } = storage.from(BUCKET).getPublicUrl(path);
  await log(c, 'upload', 'storage', path);
  return c.json({ ok: true, url: data.publicUrl });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin accounts
// ─────────────────────────────────────────────────────────────────────────────

configRoutes.patch('/me', async (c) => {
  const b = await body(c, z.object({ telegram_id: z.number().int().positive().nullable().optional(), display_name: z.string().max(80).nullable().optional() }));
  const res = await db(c.env).from('admins').update(b).eq('user_id', c.get('admin').user_id).select('*').single();
  if (res.error) fail(409, res.error.message.includes('duplicate') ? 'This Telegram ID is linked to another admin' : res.error.message);
  clearAuthCache();
  return c.json({ ok: true, admin: res.data });
});

configRoutes.get('/admins', async (c) => {
  requireOwner(c);
  const rows = check(await db(c.env).from('admins').select('*').order('created_at')) as AdminRow[];
  return c.json({ ok: true, items: rows });
});

configRoutes.post('/admins', async (c) => {
  requireOwner(c);
  const b = await body(c, z.object({
    email: z.string().email(),
    password: z.string().min(8).max(100).optional(),
    role: z.enum(['owner', 'support']),
    telegram_id: z.number().int().positive().nullable().optional(),
    display_name: z.string().max(80).nullable().optional(),
  }));
  const email = b.email.trim().toLowerCase();
  const auth = db(c.env).auth.admin;
  let userId: string | null = null;
  if (b.password) {
    const { data, error } = await auth.createUser({ email, password: b.password, email_confirm: true });
    if (error && !/already/i.test(error.message)) fail(409, error.message);
    userId = data?.user?.id ?? null;
  } else {
    const { data, error } = await auth.inviteUserByEmail(email);
    if (error && !/already/i.test(error.message)) fail(409, error.message);
    userId = data?.user?.id ?? null;
  }
  if (!userId) {
    // existing auth user: find it
    const { data } = await auth.listUsers({ page: 1, perPage: 1000 });
    userId = data?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  }
  if (!userId) fail(500, 'Could not create the user');
  const res = await db(c.env).from('admins').upsert({ user_id: userId, email, role: b.role, telegram_id: b.telegram_id ?? null, display_name: b.display_name ?? null }).select('*').single();
  if (res.error) fail(409, res.error.message);
  clearAuthCache();
  await log(c, 'admin.create', 'admin', userId, { email, role: b.role });
  return c.json({ ok: true, admin: res.data });
});

configRoutes.patch('/admins/:id', async (c) => {
  requireOwner(c);
  const id = c.req.param('id');
  const b = await body(c, z.object({
    role: z.enum(['owner', 'support']).optional(),
    telegram_id: z.number().int().positive().nullable().optional(),
    display_name: z.string().max(80).nullable().optional(),
  }));
  if (id === c.get('admin').user_id && b.role === 'support') fail(409, 'You cannot demote yourself');
  const res = await db(c.env).from('admins').update(b).eq('user_id', id).select('*').single();
  if (res.error) fail(409, res.error.message);
  clearAuthCache();
  await log(c, 'admin.update', 'admin', id, b);
  return c.json({ ok: true, admin: res.data });
});

configRoutes.delete('/admins/:id', async (c) => {
  requireOwner(c);
  const id = c.req.param('id');
  if (id === c.get('admin').user_id) fail(409, 'You cannot remove yourself');
  check(await db(c.env).from('admins').delete().eq('user_id', id));
  clearAuthCache();
  await log(c, 'admin.delete', 'admin', id);
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// System
// ─────────────────────────────────────────────────────────────────────────────

configRoutes.get('/system', async (c) => {
  requireOwner(c);
  const s = await getSettings(c.env, true);
  const [me, webhook] = await Promise.all([
    tg<Record<string, unknown>>(c.env, 'getMe').catch((e) => ({ error: (e as Error).message })),
    tg<Record<string, unknown>>(c.env, 'getWebhookInfo').catch((e) => ({ error: (e as Error).message })),
  ]);
  return c.json({
    ok: true,
    plan: s.system.plan,
    has_queue: !!c.env.JOBS,
    app_env: c.env.APP_ENV,
    base_url: s.system.public_base_url || new URL(c.req.url).origin,
    expected_webhook: `${s.system.public_base_url || new URL(c.req.url).origin}/webhook/telegram`,
    bot: me,
    webhook,
  });
});

configRoutes.post('/system/webhook', async (c) => {
  requireOwner(c);
  const s = await getSettings(c.env, true);
  const origin = new URL(c.req.url).origin;
  const base = (s.system.public_base_url || origin).replace(/\/+$/, '');
  if (!s.system.public_base_url) await saveSettingsSection(c.env, 'system', { ...s.system, public_base_url: origin });
  await tg(c.env, 'setWebhook', {
    url: `${base}/webhook/telegram`,
    secret_token: c.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query', 'my_chat_member', 'inline_query'],
    drop_pending_updates: false,
    max_connections: 40,
  });
  // remember the bot username for links (referrals, landing page)
  try {
    const me = await tg<{ username?: string }>(c.env, 'getMe');
    if (me.username && !s.brand.bot_username) await saveSettingsSection(c.env, 'brand', { ...s.brand, bot_username: me.username });
  } catch { /* ignore */ }
  await log(c, 'system.webhook', 'system', base);
  const info = await tg(c.env, 'getWebhookInfo');
  return c.json({ ok: true, webhook: info });
});

configRoutes.delete('/system/webhook', async (c) => {
  requireOwner(c);
  await tg(c.env, 'deleteWebhook', { drop_pending_updates: false });
  await log(c, 'system.webhook.delete', 'system');
  return c.json({ ok: true });
});

configRoutes.post('/system/commands', async (c) => {
  requireOwner(c);
  await setupBotCommands(c.env);
  await log(c, 'system.commands', 'system');
  return c.json({ ok: true });
});

configRoutes.get('/audit', async (c) => {
  requireOwner(c);
  const { page, limit, from, to } = paging(c, 50);
  let q = db(c.env).from('audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  const action = c.req.query('action');
  if (action) q = q.ilike('action', `${action}%`);
  const res = await q.range(from, to);
  return c.json({ ok: true, total: res.count ?? 0, page, limit, items: check(res) });
});
