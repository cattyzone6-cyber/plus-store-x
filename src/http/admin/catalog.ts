import { Hono } from 'hono';
import { z } from 'zod';
import type { CategoryRow, ProductRow, ProductSourceRow, StockItemRow } from '../../types';
import { db } from '../../lib/db';
import { getSettings } from '../../lib/settings';
import { loadOptions } from '../../services/catalog';
import { priceProduct, requiredInputs } from '../../services/pricing';
import { SYNCABLE_FIELDS } from '../../services/sync-fields';
import { body, check, fail, likePattern, log, paging, requireOwner, type AdminEnv } from './util';

export const catalogRoutes = new Hono<AdminEnv>();

const styleEnum = z.enum(['default', 'primary', 'success', 'danger']);
const ownerOnly = async (c: Parameters<typeof requireOwner>[0], next: () => Promise<void>) => { requireOwner(c); await next(); };

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────

const categorySchema = z.object({
  parent_id: z.string().uuid().nullable().optional(),
  name_en: z.string().min(1).max(120),
  name_ar: z.string().max(120).nullable().optional(),
  description_en: z.string().max(4000).nullable().optional(),
  description_ar: z.string().max(4000).nullable().optional(),
  emoji: z.string().max(16).nullable().optional(),
  custom_emoji_id: z.string().max(40).nullable().optional(),
  image_url: z.string().max(1000).nullable().optional(),
  button_style: styleEnum.optional(),
  sort: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

catalogRoutes.get('/categories', async (c) => {
  const rows = check(await db(c.env).from('categories').select('*').order('sort').order('name_en')) as CategoryRow[];
  const prods = check(await db(c.env).from('products').select('category_id,is_active')) as { category_id: string | null; is_active: boolean }[];
  const counts = new Map<string, { total: number; active: number }>();
  for (const p of prods) {
    if (!p.category_id) continue;
    const x = counts.get(p.category_id) ?? { total: 0, active: 0 };
    x.total++;
    if (p.is_active) x.active++;
    counts.set(p.category_id, x);
  }
  return c.json({ ok: true, categories: rows.map((r) => ({ ...r, products: counts.get(r.id) ?? { total: 0, active: 0 } })) });
});

catalogRoutes.post('/categories', ownerOnly, async (c) => {
  const b = await body(c, categorySchema);
  const row = check(await db(c.env).from('categories').insert(b).select('*').single()) as CategoryRow;
  await log(c, 'category.create', 'category', row.id, { name: row.name_en });
  return c.json({ ok: true, category: row });
});

catalogRoutes.patch('/categories/:id', ownerOnly, async (c) => {
  const b = await body(c, categorySchema.partial());
  const row = check(await db(c.env).from('categories').update(b).eq('id', c.req.param('id')).select('*').single()) as CategoryRow;
  await log(c, 'category.update', 'category', row.id, b);
  return c.json({ ok: true, category: row });
});

catalogRoutes.delete('/categories/:id', ownerOnly, async (c) => {
  check(await db(c.env).from('categories').delete().eq('id', c.req.param('id')));
  await log(c, 'category.delete', 'category', c.req.param('id'));
  return c.json({ ok: true });
});

catalogRoutes.post('/categories/reorder', ownerOnly, async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()) }));
  await Promise.all(b.ids.map((id, i) => db(c.env).from('categories').update({ sort: i }).eq('id', id)));
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────────────

const fieldSchema = z.object({
  key: z.string().min(1).max(40),
  per_unit: z.boolean().optional(),
  required: z.boolean().optional(),
  options: z.array(z.union([z.string(), z.number()])).optional(),
  label_en: z.string().max(200).optional(),
  label_ar: z.string().max(200).optional(),
  fixed: z.union([z.string(), z.number()]).optional(),
});

const productSchema = z.object({
  category_id: z.string().uuid().nullable().optional(),
  name_en: z.string().min(1).max(200),
  name_ar: z.string().max(200).nullable().optional(),
  description_en: z.string().max(4000).nullable().optional(),
  description_ar: z.string().max(4000).nullable().optional(),
  emoji: z.string().max(16).nullable().optional(),
  custom_emoji_id: z.string().max(40).nullable().optional(),
  image_url: z.string().max(1000).nullable().optional(),
  duration_en: z.string().max(100).nullable().optional(),
  duration_ar: z.string().max(100).nullable().optional(),
  warranty_days: z.number().int().min(0).max(3650).optional(),
  fulfillment: z.enum(['auto', 'manual']).optional(),
  pricing_mode: z.enum(['markup', 'manual']).optional(),
  markup_percent: z.number().min(-100).max(10000).nullable().optional(),
  markup_fixed: z.number().nullable().optional(),
  manual_price: z.number().min(0).nullable().optional(),
  base_cost: z.number().min(0).nullable().optional(),
  compare_at_price: z.number().min(0).nullable().optional(),
  sale_percent: z.number().min(0).max(95).optional(),
  qty_discounts: z.array(z.object({ min_qty: z.number().int().min(1), percent: z.number().min(0).max(90) })).optional(),
  routing: z.enum(['priority', 'cheapest']).optional(),
  on_failure: z.enum(['next_source', 'refund', 'manual']).nullable().optional(),
  input_fields: z.array(fieldSchema).optional(),
  min_qty: z.number().int().min(1).optional(),
  max_qty: z.number().int().min(1).optional(),
  qty_presets: z.array(z.number().int().min(1)).nullable().optional(),
  button_style: styleEnum.nullable().optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  sort: z.number().int().optional(),
  auto_sync_info: z.boolean().optional(),
  delivery_note_en: z.string().max(2000).nullable().optional(),
  delivery_note_ar: z.string().max(2000).nullable().optional(),
});

// Support staff may only touch these product fields; pricing/sources stay with the owner.
const PRICING_FIELDS = ['pricing_mode', 'markup_percent', 'markup_fixed', 'manual_price', 'base_cost', 'compare_at_price', 'sale_percent', 'qty_discounts', 'routing', 'on_failure'];

catalogRoutes.get('/products', async (c) => {
  const s = await getSettings(c.env);
  const { page, limit, from, to } = paging(c, 50);
  let q = db(c.env).from('products').select('*', { count: 'exact' }).order('sort').order('name_en');
  const search = c.req.query('q')?.trim();
  if (search) q = q.or(`name_en.ilike.${likePattern(search)},name_ar.ilike.${likePattern(search)}`);
  const cat = c.req.query('category_id');
  if (cat === 'none') q = q.is('category_id', null);
  else if (cat) q = q.eq('category_id', cat);
  const active = c.req.query('active');
  if (active === 'true') q = q.eq('is_active', true);
  if (active === 'false') q = q.eq('is_active', false);
  const res = await q.range(from, to);
  const rows = check(res) as ProductRow[];
  const opts = await loadOptions(c.env, rows);
  const items = rows.map((p) => {
    const pr = priceProduct(p, opts.get(p.id) ?? [], s, null);
    return {
      ...p,
      price: pr.unitPrice,
      original_price: pr.originalUnitPrice,
      reference_cost: pr.referenceCost,
      available: pr.available,
      sold_out: pr.soldOut,
      sources: (opts.get(p.id) ?? []).map((o) => ({ kind: o.source.kind, usable: o.usable, provider: o.provider?.name ?? null })),
    };
  });
  return c.json({ ok: true, total: res.count ?? items.length, page, limit, items });
});

catalogRoutes.get('/products/:id', async (c) => {
  const s = await getSettings(c.env);
  const p = check(await db(c.env).from('products').select('*').eq('id', c.req.param('id')).maybeSingle()) as ProductRow | null;
  if (!p) fail(404, 'Product not found');
  const options = (await loadOptions(c.env, [p])).get(p.id) ?? [];
  const pr = priceProduct(p, options, s, null);
  const routeIds = pr.route.map((o) => o.source.id);
  const { ask, fixed } = requiredInputs(p, pr.route);
  const stock = check(await db(c.env).from('stock_items').select('status')
    .eq('product_id', p.id)) as { status: string }[];
  const stockCounts: Record<string, number> = {};
  for (const r of stock) stockCounts[r.status] = (stockCounts[r.status] ?? 0) + 1;
  return c.json({
    ok: true,
    product: p,
    pricing: {
      unit_price: pr.unitPrice,
      original_unit_price: pr.originalUnitPrice,
      reference_cost: pr.referenceCost,
      profit: pr.unitPrice != null && pr.referenceCost != null ? pr.unitPrice - pr.referenceCost : null,
      available: pr.available,
      sold_out: pr.soldOut,
      sale_percent: pr.salePercent,
    },
    sources: options
      .sort((a, b) => a.source.priority - b.source.priority)
      .map((o) => ({
        ...o.source,
        provider_name: o.provider?.name ?? null,
        provider_enabled: o.provider?.enabled ?? null,
        provider_product: o.providerProduct
          ? {
              id: o.providerProduct.id,
              name: o.providerProduct.name,
              external_id: o.providerProduct.external_id,
              cost: o.providerProduct.cost,
              stock: o.providerProduct.stock,
              is_removed: o.providerProduct.is_removed,
              is_available: o.providerProduct.is_available,
              delivery_kind: o.providerProduct.delivery_kind,
              requirements: o.providerProduct.requirements,
              warranty_days: o.providerProduct.warranty_days,
            }
          : null,
        unit_cost: o.unitCost,
        available: o.available,
        usable: o.usable,
        reason: o.reason ?? null,
        route_position: routeIds.indexOf(o.source.id),
        profit: pr.unitPrice != null && o.unitCost != null ? pr.unitPrice - o.unitCost : null,
      })),
    inputs: { ask, fixed },
    stock: stockCounts,
    syncable_fields: SYNCABLE_FIELDS,
  });
});

catalogRoutes.post('/products', ownerOnly, async (c) => {
  const b = await body(c, productSchema);
  const row = check(await db(c.env).from('products').insert(b).select('*').single()) as ProductRow;
  await log(c, 'product.create', 'product', row.id, { name: row.name_en });
  return c.json({ ok: true, product: row });
});

catalogRoutes.patch('/products/:id', async (c) => {
  const id = c.req.param('id');
  const b = await body(c, productSchema.partial());
  const admin = c.get('admin');
  if (admin.role !== 'owner' && Object.keys(b).some((k) => PRICING_FIELDS.includes(k))) fail(403, 'Only the owner can change pricing');
  const current = check(await db(c.env).from('products').select('*').eq('id', id).maybeSingle()) as ProductRow | null;
  if (!current) fail(404, 'Product not found');

  // Any edited syncable field is locked so the catalog sync never overwrites it.
  const locked = new Set(current.locked_fields ?? []);
  for (const f of SYNCABLE_FIELDS) {
    if (f in b && (b as Record<string, unknown>)[f] !== (current as unknown as Record<string, unknown>)[f]) locked.add(f);
  }
  const row = check(await db(c.env).from('products').update({ ...b, locked_fields: [...locked] }).eq('id', id).select('*').single()) as ProductRow;
  await log(c, 'product.update', 'product', id, b);
  return c.json({ ok: true, product: row });
});

/** "Reset to provider": remove locks so the next sync copies these fields again. */
catalogRoutes.post('/products/:id/unlock', ownerOnly, async (c) => {
  const id = c.req.param('id');
  const b = await body(c, z.object({ fields: z.array(z.string()) }));
  const current = check(await db(c.env).from('products').select('locked_fields').eq('id', id).single()) as { locked_fields: string[] };
  const locked = (current.locked_fields ?? []).filter((f) => !b.fields.includes(f));
  const row = check(await db(c.env).from('products').update({ locked_fields: locked }).eq('id', id).select('*').single()) as ProductRow;
  await log(c, 'product.unlock', 'product', id, b.fields);
  return c.json({ ok: true, product: row });
});

catalogRoutes.delete('/products/:id', ownerOnly, async (c) => {
  check(await db(c.env).from('products').delete().eq('id', c.req.param('id')));
  await log(c, 'product.delete', 'product', c.req.param('id'));
  return c.json({ ok: true });
});

catalogRoutes.post('/products/reorder', ownerOnly, async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()) }));
  await Promise.all(b.ids.map((id, i) => db(c.env).from('products').update({ sort: i }).eq('id', id)));
  return c.json({ ok: true });
});

catalogRoutes.post('/products/:id/duplicate', ownerOnly, async (c) => {
  const p = check(await db(c.env).from('products').select('*').eq('id', c.req.param('id')).single()) as ProductRow;
  const { id: _id, created_at: _c, updated_at: _u, sold_count: _s, ...rest } = p;
  const copy = check(await db(c.env).from('products').insert({ ...rest, name_en: `${p.name_en} (copy)`, is_active: false }).select('*').single()) as ProductRow;
  const sources = check(await db(c.env).from('product_sources').select('*').eq('product_id', p.id)) as ProductSourceRow[];
  if (sources.length) {
    check(await db(c.env).from('product_sources').insert(sources.map((s) => ({
      product_id: copy.id, kind: s.kind, provider_product_id: s.provider_product_id, priority: s.priority, is_enabled: s.is_enabled,
    }))));
  }
  await log(c, 'product.duplicate', 'product', copy.id, { from: p.id });
  return c.json({ ok: true, product: copy });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────────

catalogRoutes.post('/products/:id/sources', ownerOnly, async (c) => {
  const productId = c.req.param('id');
  const b = await body(c, z.object({
    kind: z.enum(['provider', 'stock', 'manual']),
    provider_product_id: z.string().uuid().optional(),
    priority: z.number().int().optional(),
  }));
  if (b.kind === 'provider' && !b.provider_product_id) fail(422, 'provider_product_id required');
  const existing = check(await db(c.env).from('product_sources').select('priority').eq('product_id', productId)) as { priority: number }[];
  const priority = b.priority ?? existing.reduce((m, e) => Math.max(m, e.priority), -1) + 1;
  const res = await db(c.env).from('product_sources').insert({
    product_id: productId,
    kind: b.kind,
    provider_product_id: b.kind === 'provider' ? b.provider_product_id : null,
    priority,
  }).select('*').single();
  if (res.error) fail(409, res.error.message.includes('duplicate') ? 'This source is already attached' : res.error.message);
  if (b.provider_product_id) await db(c.env).from('provider_products').update({ is_new: false }).eq('id', b.provider_product_id);
  await log(c, 'source.add', 'product', productId, b);
  return c.json({ ok: true, source: res.data });
});

catalogRoutes.patch('/sources/:id', ownerOnly, async (c) => {
  const b = await body(c, z.object({ priority: z.number().int().optional(), is_enabled: z.boolean().optional() }));
  const row = check(await db(c.env).from('product_sources').update(b).eq('id', c.req.param('id')).select('*').single());
  await log(c, 'source.update', 'source', c.req.param('id'), b);
  return c.json({ ok: true, source: row });
});

catalogRoutes.delete('/sources/:id', ownerOnly, async (c) => {
  check(await db(c.env).from('product_sources').delete().eq('id', c.req.param('id')));
  await log(c, 'source.delete', 'source', c.req.param('id'));
  return c.json({ ok: true });
});

catalogRoutes.post('/products/:id/sources/reorder', ownerOnly, async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()) }));
  await Promise.all(b.ids.map((id, i) => db(c.env).from('product_sources').update({ priority: i }).eq('id', id).eq('product_id', c.req.param('id'))));
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stock
// ─────────────────────────────────────────────────────────────────────────────

catalogRoutes.get('/products/:id/stock', async (c) => {
  const { page, limit, from, to } = paging(c, 100);
  let q = db(c.env).from('stock_items').select('*', { count: 'exact' }).eq('product_id', c.req.param('id')).order('created_at', { ascending: false });
  const status = c.req.query('status');
  if (status) q = q.eq('status', status);
  const res = await q.range(from, to);
  const items = check(res) as StockItemRow[];
  const admin = c.get('admin');
  // support staff never see sold credentials of other orders
  // support can add stock and see counts, never read the items themselves
  const visible = admin.role === 'owner' ? items : items.map((i) => ({ ...i, content: '••••••' }));
  return c.json({ ok: true, total: res.count ?? items.length, page, limit, items: visible });
});

catalogRoutes.post('/products/:id/stock', async (c) => {
  const productId = c.req.param('id');
  const b = await body(c, z.object({
    text: z.string().min(1).max(500_000),
    separator: z.string().max(20).optional(), // default: new line
    batch: z.string().max(80).optional(),
    skip_duplicates: z.boolean().optional(),
  }));
  const sep = b.separator && b.separator !== '\\n' ? b.separator : '\n';
  let items = b.text.split(sep).map((s) => s.replace(/\r/g, '').trim()).filter(Boolean);
  if (!items.length) fail(422, 'No items found');
  if (items.length > 5000) fail(422, 'Max 5000 items per upload');
  let skipped = 0;
  if (b.skip_duplicates !== false) {
    const unique = [...new Set(items)];
    skipped += items.length - unique.length;
    items = unique;
    const existing = check(await db(c.env).from('stock_items').select('content').eq('product_id', productId).in('content', items.slice(0, 1000))) as { content: string }[];
    const have = new Set(existing.map((e) => e.content));
    const before = items.length;
    items = items.filter((i) => !have.has(i));
    skipped += before - items.length;
  }
  const admin = c.get('admin');
  for (let i = 0; i < items.length; i += 500) {
    check(await db(c.env).from('stock_items').insert(items.slice(i, i + 500).map((content) => ({
      product_id: productId, content, batch: b.batch ?? null, created_by: admin.user_id,
    }))));
  }
  // make sure the product has a stock source
  const existingStock = check(await db(c.env).from('product_sources').select('id').eq('product_id', productId).eq('kind', 'stock')) as { id: string }[];
  if (!existingStock.length) await db(c.env).from('product_sources').insert({ product_id: productId, kind: 'stock', priority: 0 });
  await log(c, 'stock.add', 'product', productId, { added: items.length, skipped });
  return c.json({ ok: true, added: items.length, skipped });
});

catalogRoutes.post('/stock/update', async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()).min(1), action: z.enum(['invalid', 'available', 'delete']) }));
  if (b.action === 'delete') {
    check(await db(c.env).from('stock_items').delete().in('id', b.ids).neq('status', 'sold'));
  } else {
    check(await db(c.env).from('stock_items').update({ status: b.action }).in('id', b.ids).neq('status', 'sold'));
  }
  await log(c, `stock.${b.action}`, 'stock', b.ids.length);
  return c.json({ ok: true });
});

catalogRoutes.get('/products/:id/stock/export', ownerOnly, async (c) => {
  const status = c.req.query('status') ?? 'available';
  const rows = check(await db(c.env).from('stock_items').select('content').eq('product_id', c.req.param('id')).eq('status', status).order('created_at')) as { content: string }[];
  return new Response(rows.map((r) => r.content).join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="stock-${status}.txt"` },
  });
});
