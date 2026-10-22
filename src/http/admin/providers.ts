import { Hono } from 'hono';
import { z } from 'zod';
import type { ProductGroupRow, ProductRow, ProductSourceRow, ProviderProductRow, ProviderRow } from '../../types';
import { db } from '../../lib/db';
import { getSettings } from '../../lib/settings';
import { cleanProviderName, durationText } from '../../lib/names';
import { buildOption, priceProduct } from '../../services/pricing';
import { decryptJson, encryptJson, mask } from '../../lib/crypto';
import { ADAPTERS, getAdapter, providerContext } from '../../providers/registry';
import type { ProviderCredentials } from '../../providers/types';
import { syncProvider } from '../../services/sync';
import { appCtx, body, check, fail, likePattern, log, paging, requireOwner, type AdminEnv } from './util';

export const providerRoutes = new Hono<AdminEnv>();

// Everything about providers is owner-only (tokens, costs).
providerRoutes.use('/providers/*', async (c, next) => { requireOwner(c); await next(); });
providerRoutes.use('/providers', async (c, next) => { requireOwner(c); await next(); });
providerRoutes.use('/provider-products/*', async (c, next) => { requireOwner(c); await next(); });
providerRoutes.use('/provider-products', async (c, next) => { requireOwner(c); await next(); });
providerRoutes.use('/import', async (c, next) => { requireOwner(c); await next(); });
providerRoutes.use('/import/*', async (c, next) => { requireOwner(c); await next(); });

async function publicProvider(env: AdminEnv['Bindings'], p: ProviderRow) {
  const { credentials_enc, ...rest } = p;
  let creds: ProviderCredentials | null = null;
  try {
    creds = await decryptJson<ProviderCredentials>(credentials_enc, env.ENCRYPTION_KEY);
  } catch {
    creds = null;
  }
  const adapter = ADAPTERS[p.kind];
  const fields = adapter?.credentialFields ?? [{ key: 'api_key', label: 'API key', secret: true }];
  return {
    ...rest,
    kind_label: adapter?.label ?? p.kind,
    credentials: fields.map((f) => ({
      key: f.key,
      label: f.label,
      secret: f.secret,
      set: !!creds?.[f.key],
      value: f.secret ? mask(creds?.[f.key]) : creds?.[f.key] ?? '',
    })),
  };
}

providerRoutes.get('/providers/kinds', (c) =>
  c.json({
    ok: true,
    kinds: Object.values(ADAPTERS).map((a) => ({ kind: a.kind, label: a.label, defaultBaseUrl: a.defaultBaseUrl, credentialFields: a.credentialFields })),
  }),
);

providerRoutes.get('/providers', async (c) => {
  const rows = check(await db(c.env).from('providers').select('*').order('sort').order('name')) as ProviderRow[];
  const counts = check(await db(c.env).from('provider_products').select('provider_id,is_removed,is_new')) as { provider_id: string; is_removed: boolean; is_new: boolean }[];
  const stats = new Map<string, { total: number; removed: number; new: number }>();
  for (const r of counts) {
    const s = stats.get(r.provider_id) ?? { total: 0, removed: 0, new: 0 };
    s.total++;
    if (r.is_removed) s.removed++;
    else if (r.is_new) s.new++;
    stats.set(r.provider_id, s);
  }
  const providers = await Promise.all(rows.map(async (p) => ({ ...(await publicProvider(c.env, p)), products: stats.get(p.id) ?? { total: 0, removed: 0, new: 0 } })));
  return c.json({ ok: true, providers });
});

const providerSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.string().min(1),
  base_url: z.string().url(),
  credentials: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  sync_interval_minutes: z.number().int().min(1).max(1440).optional(),
  low_balance_threshold: z.number().nullable().optional(),
  sort: z.number().int().optional(),
  // import defaults (null = use the store-wide setting)
  import_category_id: z.string().uuid().nullable().optional(),
  import_markup_percent: z.number().min(0).max(1000).nullable().optional(),
  import_markup_fixed: z.number().min(0).max(100000).nullable().optional(),
  import_min_margin_percent: z.number().min(0).max(1000).nullable().optional(),
  max_jump_percent: z.number().min(0).max(1000).nullable().optional(),
  import_description_en: z.string().max(4000).nullable().optional(),
  import_description_ar: z.string().max(4000).nullable().optional(),
});

const IMPORT_DEFAULT_KEYS = [
  'import_category_id', 'import_markup_percent', 'import_markup_fixed', 'import_min_margin_percent',
  'max_jump_percent', 'import_description_en', 'import_description_ar',
] as const;

providerRoutes.post('/providers', async (c) => {
  const b = await body(c, providerSchema);
  if (!ADAPTERS[b.kind]) fail(422, `Unknown provider kind ${b.kind}`);
  const creds = Object.fromEntries(Object.entries(b.credentials ?? {}).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
  const row = check(
    await db(c.env).from('providers').insert({
      name: b.name,
      kind: b.kind,
      base_url: b.base_url.replace(/\/+$/, ''),
      credentials_enc: Object.keys(creds).length ? await encryptJson(creds, c.env.ENCRYPTION_KEY) : null,
      enabled: b.enabled ?? true,
      config: b.config ?? {},
      sync_interval_minutes: b.sync_interval_minutes ?? 10,
      low_balance_threshold: b.low_balance_threshold ?? null,
      sort: b.sort ?? 0,
    }).select('*').single(),
  ) as ProviderRow;
  await log(c, 'provider.create', 'provider', row.id, { name: row.name, kind: row.kind });
  return c.json({ ok: true, provider: await publicProvider(c.env, row) });
});

providerRoutes.patch('/providers/:id', async (c) => {
  const id = c.req.param('id');
  const b = await body(c, providerSchema.partial());
  const current = check(await db(c.env).from('providers').select('*').eq('id', id).maybeSingle()) as ProviderRow | null;
  if (!current) fail(404, 'Provider not found');
  const patch: Record<string, unknown> = {};
  for (const k of ['name', 'enabled', 'config', 'sync_interval_minutes', 'low_balance_threshold', 'sort', ...IMPORT_DEFAULT_KEYS] as const) {
    const v = b[k];
    if (v !== undefined) patch[k] = typeof v === 'string' && v.trim() === '' ? null : v;
  }
  if (b.base_url) patch.base_url = b.base_url.replace(/\/+$/, '');
  if (b.kind && b.kind !== current.kind) {
    if (!ADAPTERS[b.kind]) fail(422, `Unknown provider kind ${b.kind}`);
    patch.kind = b.kind;
  }
  if (b.credentials) {
    // empty value = keep the existing secret
    const existing = (await decryptJson<ProviderCredentials>(current.credentials_enc, c.env.ENCRYPTION_KEY).catch(() => null)) ?? {};
    const merged: Record<string, string> = { ...existing };
    for (const [k, v] of Object.entries(b.credentials)) if (v.trim() !== '') merged[k] = v.trim();
    patch.credentials_enc = await encryptJson(merged, c.env.ENCRYPTION_KEY);
    patch.rate_limited_until = null;
  }
  if (b.low_balance_threshold !== undefined) patch.low_balance_notified = false;
  const row = check(await db(c.env).from('providers').update(patch).eq('id', id).select('*').single()) as ProviderRow;
  await log(c, 'provider.update', 'provider', id, { ...patch, credentials_enc: patch.credentials_enc ? '[updated]' : undefined });
  return c.json({ ok: true, provider: await publicProvider(c.env, row) });
});

providerRoutes.delete('/providers/:id', async (c) => {
  const id = c.req.param('id');
  check(await db(c.env).from('providers').delete().eq('id', id));
  await log(c, 'provider.delete', 'provider', id);
  return c.json({ ok: true });
});

providerRoutes.post('/providers/:id/test', async (c) => {
  const id = c.req.param('id');
  const row = check(await db(c.env).from('providers').select('*').eq('id', id).maybeSingle()) as ProviderRow | null;
  if (!row) fail(404, 'Provider not found');
  try {
    const info = await getAdapter(row.kind).getBalance(await providerContext(c.env, row));
    await db(c.env).from('providers').update({
      balance: info.balance_usd,
      balance_currency: 'USD',
      balance_checked_at: new Date().toISOString(),
      low_balance_notified: false,
    }).eq('id', id);
    return c.json({ ok: true, balance: info });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 502);
  }
});

providerRoutes.post('/providers/:id/sync', async (c) => {
  const id = c.req.param('id');
  try {
    const stats = await syncProvider(appCtx(c), id);
    await log(c, 'provider.sync', 'provider', id);
    return c.json({ ok: true, stats });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 502);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider catalog browser
// ─────────────────────────────────────────────────────────────────────────────

const PP_LIST_COLUMNS =
  'id,provider_id,external_id,name,description,image_url,emoji,delivery_kind,raw_type,cost,cost_original,cost_currency,stock,sold,warranty_days,requirements,price_tiers,is_available,is_removed,is_new,first_seen_at,last_seen_at,last_changed_at,removed_at';

async function linksFor(env: AdminEnv['Bindings'], ids: string[]): Promise<Map<string, { product_id: string; product_name: string }[]>> {
  const map = new Map<string, { product_id: string; product_name: string }[]>();
  if (!ids.length) return map;
  const rows = check(await db(env).rpc('admin_pp_links', { p_ids: ids })) as { provider_product_id: string; product_id: string; product_name: string }[];
  for (const r of rows) {
    const list = map.get(r.provider_product_id) ?? [];
    list.push({ product_id: r.product_id, product_name: r.product_name });
    map.set(r.provider_product_id, list);
  }
  return map;
}

providerRoutes.get('/providers/:id/products', async (c) => {
  const id = c.req.param('id');
  const filter = c.req.query('filter') ?? 'all'; // all | new | removed | linked | unlinked | available
  const q = c.req.query('q')?.trim();
  const { page, limit, from } = paging(c, 50);

  let query = db(c.env).from('provider_products').select(PP_LIST_COLUMNS).eq('provider_id', id).order('name');
  if (q) query = query.ilike('name', likePattern(q));
  if (filter === 'new') query = query.eq('is_new', true).eq('is_removed', false);
  if (filter === 'removed') query = query.eq('is_removed', true);
  if (filter === 'available') query = query.eq('is_available', true).eq('is_removed', false);
  const rows = check(await query) as ProviderProductRow[];
  const links = await linksFor(c.env, rows.map((r) => r.id));
  const words = (await getSettings(c.env)).catalog.name_words ?? {};
  // clean = which store product this item belongs to (packs keep their full name)
  let list = rows.map((r) => ({ ...r, links: links.get(r.id) ?? [], clean: cleanProviderName(r.name, words) }));
  if (filter === 'linked') list = list.filter((r) => r.links.length);
  if (filter === 'unlinked') list = list.filter((r) => !r.links.length && !r.is_removed);
  // ?all=1: the whole catalog in one list (the admin page selects across all of it)
  if (c.req.query('all') === '1') return c.json({ ok: true, total: list.length, page: 1, limit: list.length, items: list });
  return c.json({ ok: true, total: list.length, page, limit, items: list.slice(from, from + limit) });
});

/** Search provider products across all providers (product editor → add source). */
providerRoutes.get('/provider-products', async (c) => {
  const q = c.req.query('q')?.trim();
  let query = db(c.env).from('provider_products').select(`${PP_LIST_COLUMNS}`).eq('is_removed', false).order('name').limit(60);
  if (q) query = query.ilike('name', likePattern(q));
  const providerId = c.req.query('provider_id');
  if (providerId) query = query.eq('provider_id', providerId);
  const rows = check(await query) as ProviderProductRow[];
  const providers = check(await db(c.env).from('providers').select('id,name')) as { id: string; name: string }[];
  const names = new Map(providers.map((p) => [p.id, p.name]));
  return c.json({ ok: true, items: rows.map((r) => ({ ...r, provider_name: names.get(r.provider_id) ?? '' })) });
});

providerRoutes.get('/provider-products/:id', async (c) => {
  const row = check(await db(c.env).from('provider_products').select('*').eq('id', c.req.param('id')).maybeSingle());
  if (!row) fail(404, 'Not found');
  return c.json({ ok: true, item: row });
});

providerRoutes.post('/provider-products/mark-seen', async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()).optional(), provider_id: z.string().uuid().optional() }));
  let q = db(c.env).from('provider_products').update({ is_new: false });
  if (b.ids?.length) q = q.in('id', b.ids);
  else if (b.provider_id) q = q.eq('provider_id', b.provider_id);
  else fail(422, 'ids or provider_id required');
  check(await q);
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Import provider products into the store
// ─────────────────────────────────────────────────────────────────────────────

const EMOJI_RE = /\p{Extended_Pictographic}/u;

function productFromPP(pp: ProviderProductRow, categoryId: string | null) {
  return {
    category_id: categoryId,
    name_en: pp.name,
    description_en: pp.description,
    image_url: pp.image_url,
    emoji: pp.emoji && EMOJI_RE.test(pp.emoji) ? pp.emoji : null,
    warranty_days: pp.warranty_days ?? 0,
    pricing_mode: 'markup',
    auto_sync_info: true,
  };
}

providerRoutes.post('/import', async (c) => {
  const b = await body(c, z.object({
    provider_product_ids: z.array(z.string().uuid()).min(1).max(200),
    category_id: z.string().uuid().nullable().optional(),
    mode: z.enum(['separate', 'group']),
    product_id: z.string().uuid().optional(),
    routing: z.enum(['priority', 'cheapest']).optional(),
    // optional name for a NEW grouped product (default: first provider product's name)
    name_en: z.string().trim().min(1).max(200).optional(),
    name_ar: z.string().trim().max(200).optional(),
    // separate mode, from the review step: per product category and name
    items: z.array(z.object({
      id: z.string().uuid(),
      category_id: z.string().uuid().nullable().optional(),
      name_en: z.string().trim().min(1).max(200).optional(),
      name_ar: z.string().trim().max(200).optional(),
    })).max(1000).optional(),
  }));
  const perItem = new Map((b.items ?? []).map((i) => [i.id, i]));
  const pps = check(await db(c.env).from('provider_products').select('*').in('id', b.provider_product_ids)) as ProviderProductRow[];
  if (!pps.length) fail(404, 'Provider products not found');
  // keep the order the admin selected
  const order = new Map(b.provider_product_ids.map((id, i) => [id, i]));
  pps.sort((a, b2) => (order.get(a.id) ?? 0) - (order.get(b2.id) ?? 0));

  const created: string[] = [];
  let skipped = 0;
  if (b.mode === 'separate') {
    // never import the same provider product twice (a retried or double-clicked import
    // used to create a second copy of every product)
    const linked = check(await db(c.env).from('product_sources').select('provider_product_id').in('provider_product_id', pps.map((p) => p.id))) as { provider_product_id: string }[];
    const already = new Set(linked.map((l) => l.provider_product_id));
    const fresh = pps.filter((pp) => !already.has(pp.id));
    skipped = pps.length - fresh.length;
    if (!fresh.length) fail(409, `All ${pps.length} selected products are already in the store`);

    // bulk inserts (Workers Free allows ~50 outgoing calls per request): ids are generated
    // here so every source row can point at its product without a read-back
    const products = fresh.map((pp) => {
      const o = perItem.get(pp.id);
      const base = productFromPP(pp, o && o.category_id !== undefined ? o.category_id : (b.category_id ?? null));
      // a name typed in the review is kept: sync will not overwrite it.
      // Every row carries the same keys (a bulk insert sends missing keys as NULL).
      const renamed = !!o?.name_en && o.name_en !== pp.name;
      return {
        id: crypto.randomUUID(),
        ...base,
        name_en: renamed ? o!.name_en! : base.name_en,
        name_ar: o?.name_ar || null,
        locked_fields: renamed ? ['name_en'] : [],
      };
    });
    const sources = products.map((p, i) => ({ product_id: p.id, kind: 'provider', provider_product_id: fresh[i].id, priority: 0 }));
    try {
      for (let i = 0; i < products.length; i += 100) {
        check(await db(c.env).from('products').insert(products.slice(i, i + 100)));
        check(await db(c.env).from('product_sources').insert(sources.slice(i, i + 100)));
      }
    } catch (e) {
      // all or nothing: remove what this request created so a retry starts clean
      await db(c.env).from('products').delete().in('id', products.map((p) => p.id));
      throw e;
    }
    created.push(...products.map((p) => p.id));
  } else {
    let productId = b.product_id;
    if (!productId) {
      const base = productFromPP(pps[0], b.category_id ?? null);
      const named = b.name_en ? { name_en: b.name_en, name_ar: b.name_ar || null, locked_fields: ['name_en'] } : {};
      const product = check(await db(c.env).from('products').insert({ ...base, ...named, routing: b.routing ?? 'priority' }).select('id').single()) as { id: string };
      productId = product.id;
      created.push(productId);
    } else if (b.routing) {
      check(await db(c.env).from('products').update({ routing: b.routing }).eq('id', productId));
    }
    const existing = check(await db(c.env).from('product_sources').select('priority,provider_product_id').eq('product_id', productId)) as { priority: number; provider_product_id: string | null }[];
    const have = new Set(existing.map((e) => e.provider_product_id));
    let prio = existing.reduce((m, e) => Math.max(m, e.priority), -1) + 1;
    const rows = pps.filter((pp) => !have.has(pp.id)).map((pp) => ({ product_id: productId!, kind: 'provider', provider_product_id: pp.id, priority: prio++ }));
    if (rows.length) check(await db(c.env).from('product_sources').insert(rows));
    if (!created.length) created.push(productId);
  }

  check(await db(c.env).from('provider_products').update({ is_new: false }).in('id', pps.map((p) => p.id)));
  await log(c, 'catalog.import', 'products', created.join(','), { mode: b.mode, count: created.length, skipped });
  return c.json({ ok: true, product_ids: created, skipped });
});

// ─────────────────────────────────────────────────────────────────────────────
// Import v2: choose packs → review plan → apply
// Category → Product (product_groups) → Packs (products, full names kept).
// ─────────────────────────────────────────────────────────────────────────────

/** Existing products (groups) for the review's "add to existing" choice. */
providerRoutes.get('/import/groups', async (c) => {
  const rows = check(await db(c.env).from('product_groups').select('id,name_en,name_ar,category_id,is_active').order('name_en')) as Pick<ProductGroupRow, 'id' | 'name_en' | 'name_ar' | 'category_id' | 'is_active'>[];
  return c.json({ ok: true, groups: rows });
});

/** A pack row as it would be created, so pricing can be previewed with the real rules. */
function previewPack(pp: ProviderProductRow): ProductRow {
  return {
    id: `preview-${pp.id}`, category_id: null, group_id: null, name_en: pp.name, name_ar: null, description_en: null, description_ar: null,
    emoji: null, custom_emoji_id: null, image_url: null, duration_en: null, duration_ar: null, warranty_days: pp.warranty_days ?? 0,
    fulfillment: 'auto', pricing_mode: 'markup', markup_percent: null, markup_fixed: null, manual_price: null, base_cost: null,
    compare_at_price: null, sale_percent: 0, qty_discounts: [], routing: 'priority', on_failure: null, input_fields: [], min_qty: 1,
    max_qty: 50, qty_presets: null, button_style: null, is_active: true, is_featured: false, sort: 0, auto_sync_info: true,
    locked_fields: [], sold_count: 0, delivery_note_en: null, delivery_note_ar: null, announced_at: null, restocked_at: null,
    last_restock_alert_at: null, min_margin_percent: null, cost_basis: null, paused_reason: null, pending_cost: null, pinned: false,
    created_at: '', updated_at: '',
  };
}

/** Store price each provider item would get with the current pricing rules (no writes). */
providerRoutes.post('/import/preview', async (c) => {
  const b = await body(c, z.object({ provider_id: z.string().uuid(), items: z.array(z.string().uuid()).min(1).max(1000) }));
  const [prov, pps, s] = await Promise.all([
    db(c.env).from('providers').select('*').eq('id', b.provider_id).maybeSingle(),
    db(c.env).from('provider_products').select('*').eq('provider_id', b.provider_id).in('id', b.items),
    getSettings(c.env),
  ]);
  const provider = check(prov) as ProviderRow | null;
  if (!provider) fail(404, 'Provider not found');
  const prices: Record<string, { cost: number | null; price: number | null; min_margin_percent: number }> = {};
  for (const pp of check(pps) as ProviderProductRow[]) {
    const product = previewPack(pp);
    const source: ProductSourceRow = { id: `preview-src-${pp.id}`, product_id: product.id, kind: 'provider', provider_product_id: pp.id, priority: 0, is_enabled: true, created_at: '' };
    const pricing = priceProduct(product, [buildOption(source, pp, provider, 0, product)], s, null);
    prices[pp.id] = { cost: pp.cost == null ? null : Number(pp.cost), price: pricing.unitPrice, min_margin_percent: pricing.minMarginPercent };
  }
  return c.json({ ok: true, prices });
});

const applySchema = z.object({
  provider_id: z.string().uuid(),
  groups: z.array(z.object({
    group_id: z.string().uuid().optional(),
    new: z.object({
      name_en: z.string().trim().min(1).max(200),
      name_ar: z.string().trim().max(200).optional(),
      category_id: z.string().uuid().nullable().optional(),
    }).optional(),
    packs: z.array(z.object({
      pp_id: z.string().uuid(),
      name_en: z.string().trim().min(1).max(200).optional(),
      name_ar: z.string().trim().max(200).optional(),
    })).min(1).max(500),
  })).max(500).default([]),
  remove: z.array(z.string().uuid()).max(1000).default([]),
});

/**
 * Apply an import plan in a few bulk queries (Workers Free budget): create or extend products
 * (groups), create packs with their full names, link them to the provider, and remove unticked
 * packs (deleted when never ordered and without stock, otherwise hidden).
 */
providerRoutes.post('/import/apply', async (c) => {
  const b = await body(c, applySchema);
  if (!b.groups.length && !b.remove.length) fail(422, 'Nothing to apply');
  for (const g of b.groups) if (!g.group_id && !g.new) fail(422, 'Each product needs group_id or new');

  const env = c.env;
  const s = await getSettings(env);
  const words = s.catalog.name_words ?? {};
  const provider = check(await db(env).from('providers').select('*').eq('id', b.provider_id).maybeSingle()) as ProviderRow | null;
  if (!provider) fail(404, 'Provider not found');

  // ── packs to create ──
  const ppIds = [...new Set(b.groups.flatMap((g) => g.packs.map((p) => p.pp_id)))];
  const pps = ppIds.length
    ? (check(await db(env).from('provider_products').select('*').eq('provider_id', provider.id).in('id', ppIds)) as ProviderProductRow[])
    : [];
  const ppMap = new Map(pps.filter((p) => !p.is_removed).map((p) => [p.id, p]));
  const linked = ppIds.length
    ? new Set((check(await db(env).from('product_sources').select('provider_product_id').in('provider_product_id', ppIds)) as { provider_product_id: string }[]).map((r) => r.provider_product_id))
    : new Set<string>();

  const existingIds = [...new Set(b.groups.map((g) => g.group_id).filter(Boolean) as string[])];
  const existing = existingIds.length
    ? (check(await db(env).from('product_groups').select('id,category_id').in('id', existingIds)) as { id: string; category_id: string | null }[])
    : [];
  const existingMap = new Map(existing.map((g) => [g.id, g]));

  const fill = (tpl: string | null, name: string) => (tpl && tpl.trim() ? tpl.replace(/\{name\}/g, name) : null);
  const newGroups: Record<string, unknown>[] = [];
  const packs: Record<string, unknown>[] = [];
  const sources: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const g of b.groups) {
    let groupId: string;
    let categoryId: string | null;
    if (g.group_id) {
      const ex = existingMap.get(g.group_id);
      if (!ex) fail(404, 'Product not found (it may have been deleted)');
      groupId = ex.id;
      categoryId = ex.category_id;
    } else {
      const nw = g.new!;
      const firstPp = g.packs.map((p) => ppMap.get(p.pp_id)).find(Boolean);
      groupId = crypto.randomUUID();
      categoryId = nw.category_id ?? provider.import_category_id ?? null;
      newGroups.push({
        id: groupId,
        category_id: categoryId,
        name_en: nw.name_en,
        name_ar: nw.name_ar || null,
        description_en: fill(provider.import_description_en, nw.name_en),
        description_ar: fill(provider.import_description_ar, nw.name_ar || nw.name_en),
        emoji: firstPp?.emoji && EMOJI_RE.test(firstPp.emoji) ? firstPp.emoji : null,
        image_url: firstPp?.image_url ?? null,
      });
    }

    for (const item of g.packs) {
      const pp = ppMap.get(item.pp_id);
      if (!pp || linked.has(pp.id)) { skipped++; continue; }
      linked.add(pp.id); // never twice, even within one plan
      const clean = cleanProviderName(pp.name, words);
      const edited = !!item.name_en && item.name_en !== pp.name;
      const warranty = pp.warranty_days ?? (typeof clean.warranty === 'number' ? clean.warranty : 0);
      const id = crypto.randomUUID();
      // every row carries the same keys (a bulk insert sends missing keys as NULL)
      packs.push({
        id,
        group_id: groupId,
        category_id: categoryId,
        name_en: edited ? item.name_en : pp.name,
        name_ar: item.name_ar || null,
        description_en: pp.description,
        image_url: pp.image_url,
        emoji: pp.emoji && EMOJI_RE.test(pp.emoji) ? pp.emoji : null,
        warranty_days: warranty,
        duration_en: durationText(clean.durationDays, 'en'),
        duration_ar: durationText(clean.durationDays, 'ar'),
        pricing_mode: 'markup',
        markup_percent: null,
        markup_fixed: null,
        cost_basis: pp.cost == null ? null : Number(pp.cost),
        auto_sync_info: true,
        locked_fields: edited ? ['name_en'] : [],
        is_active: true,
      });
      sources.push({ product_id: id, kind: 'provider', provider_product_id: pp.id, priority: 0 });
    }
  }

  // ── packs to remove (only packs fed by THIS provider) ──
  let removeIds: string[] = [];
  if (b.remove.length) {
    const own = check(await db(env).from('product_sources').select('product_id,provider_products!inner(provider_id)').in('product_id', b.remove).eq('provider_products.provider_id', provider.id)) as { product_id: string }[];
    removeIds = [...new Set(own.map((r) => r.product_id))];
  }

  const createdGroups = newGroups.map((g) => g.id as string);
  const createdPacks = packs.map((p) => p.id as string);
  let deleted = 0;
  let hidden = 0;
  try {
    if (newGroups.length) check(await db(env).from('product_groups').insert(newGroups));
    for (let i = 0; i < packs.length; i += 100) {
      check(await db(env).from('products').insert(packs.slice(i, i + 100)));
      check(await db(env).from('product_sources').insert(sources.slice(i, i + 100)));
    }
    if (ppMap.size) check(await db(env).from('provider_products').update({ is_new: false }).in('id', [...ppMap.keys()]));

    if (removeIds.length) {
      const [ordered, stocked] = await Promise.all([
        db(env).from('orders').select('product_id').in('product_id', removeIds),
        db(env).from('stock_items').select('product_id').in('product_id', removeIds).eq('status', 'available'),
      ]);
      const keep = new Set([...(check(ordered) as { product_id: string }[]), ...(check(stocked) as { product_id: string }[])].map((r) => r.product_id));
      const del = removeIds.filter((id) => !keep.has(id));
      const hide = removeIds.filter((id) => keep.has(id));
      if (del.length) deleted = (check(await db(env).from('products').delete().in('id', del).select('id')) as unknown[]).length;
      if (hide.length) hidden = (check(await db(env).from('products').update({ is_active: false }).in('id', hide).select('id')) as unknown[]).length;
    }
  } catch (e) {
    // all or nothing for what this request created
    if (createdPacks.length) await db(env).from('products').delete().in('id', createdPacks);
    if (createdGroups.length) await db(env).from('product_groups').delete().in('id', createdGroups);
    throw e;
  }

  const result = { groups_created: createdGroups.length, packs_created: createdPacks.length, skipped, deleted, hidden };
  await log(c, 'catalog.import_apply', 'provider', provider.id, result);
  return c.json({ ok: true, ...result, group_ids: createdGroups });
});
