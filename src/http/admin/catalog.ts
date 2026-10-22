import { Hono } from 'hono';
import { z } from 'zod';
import type { CategoryRow, ProductGroupRow, ProductRow, ProductSourceRow, StockItemRow } from '../../types';
import { db } from '../../lib/db';
import { getSettings } from '../../lib/settings';
import { loadOptions, viewProducts, type ProductView } from '../../services/catalog';
import { cleanProviderName } from '../../lib/names';
import { acceptPendingCost } from '../../services/price-guards';
import { priceProduct, requiredInputs } from '../../services/pricing';
import { SYNCABLE_FIELDS } from '../../services/sync-fields';
import { markRestocked } from '../../services/alerts';
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
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()).max(1000) }));
  if (!b.ids.length) return c.json({ ok: true });
  // bulk upsert (see /products/reorder)
  const rows = check(await db(c.env).from('categories').select('id,name_en').in('id', b.ids)) as { id: string; name_en: string }[];
  const names = new Map(rows.map((r) => [r.id, r.name_en]));
  check(await db(c.env).from('categories').upsert(
    b.ids.filter((id) => names.has(id)).map((id, i) => ({ id, name_en: names.get(id)!, sort: i })),
    { onConflict: 'id' },
  ));
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
  group_id: z.string().uuid().nullable().optional(),
  min_margin_percent: z.number().min(0).max(1000).nullable().optional(),
  pinned: z.boolean().optional(),
});

// Support staff may only touch these product fields; pricing/sources stay with the owner.
const PRICING_FIELDS = ['pricing_mode', 'markup_percent', 'markup_fixed', 'manual_price', 'base_cost', 'compare_at_price', 'sale_percent', 'qty_discounts', 'routing', 'on_failure', 'min_margin_percent'];

/** A pack moved into a product (group) also moves to that product's category. */
async function withGroupCategory<T extends { group_id?: string | null; category_id?: string | null }>(env: Parameters<typeof db>[0], b: T): Promise<T> {
  if (!b.group_id || b.category_id !== undefined) return b;
  const g = check(await db(env).from('product_groups').select('category_id').eq('id', b.group_id).maybeSingle()) as { category_id: string | null } | null;
  if (!g) fail(404, 'Product not found');
  return { ...b, category_id: g.category_id };
}

/** Pack list item (also used by the group endpoints). */
function packItem(v: ProductView, groupNames?: Map<string, string>) {
  const p = v.product;
  const pr = v.pricing;
  return {
    ...p,
    group_name: p.group_id ? groupNames?.get(p.group_id) ?? null : null,
    price: pr.unitPrice,
    original_price: pr.originalUnitPrice,
    reference_cost: pr.referenceCost,
    available: pr.available,
    sold_out: pr.soldOut,
    sources: pr.options.map((o) => ({ kind: o.source.kind, usable: o.usable, provider: o.provider?.name ?? null })),
  };
}

/** Packs inside a group: sold-out last, pinned first, then the owner's order and natural name order. */
function sortPacks<T extends { product: ProductRow; pricing: { soldOut: boolean } }>(views: T[]): T[] {
  return [...views].sort((a, b) =>
    Number(a.pricing.soldOut) - Number(b.pricing.soldOut)
    || Number(b.product.pinned) - Number(a.product.pinned)
    || a.product.sort - b.product.sort
    || a.product.name_en.localeCompare(b.product.name_en, undefined, { numeric: true }));
}

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
  if (c.req.query('paused') === '1') q = q.not('paused_reason', 'is', null);
  const group = c.req.query('group_id');
  if (group === 'none') q = q.is('group_id', null);
  else if (group) q = q.eq('group_id', group);
  const res = await q.range(from, to);
  const rows = check(res) as ProductRow[];
  const views = await viewProducts(c.env, s, rows, null);
  const groupIds = [...new Set(rows.map((r) => r.group_id).filter(Boolean) as string[])];
  const groups = groupIds.length ? (check(await db(c.env).from('product_groups').select('id,name_en').in('id', groupIds)) as { id: string; name_en: string }[]) : [];
  const groupNames = new Map(groups.map((g) => [g.id, g.name_en]));
  const items = views.map((v) => packItem(v, groupNames));
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
      min_margin_percent: pr.minMarginPercent,
      paused: pr.paused,
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
  const b = await withGroupCategory(c.env, await body(c, productSchema));
  const row = check(await db(c.env).from('products').insert(b).select('*').single()) as ProductRow;
  await log(c, 'product.create', 'product', row.id, { name: row.name_en });
  return c.json({ ok: true, product: row });
});

catalogRoutes.patch('/products/:id', async (c) => {
  const id = c.req.param('id');
  const b = await withGroupCategory(c.env, await body(c, productSchema.partial()));
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
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()).max(1000) }));
  if (!b.ids.length) return c.json({ ok: true });
  // one bulk upsert instead of one update per product (Workers Free: ~50 calls per request);
  // name_en is carried because an upsert row must satisfy NOT NULL columns
  const rows = check(await db(c.env).from('products').select('id,name_en').in('id', b.ids)) as { id: string; name_en: string }[];
  const names = new Map(rows.map((r) => [r.id, r.name_en]));
  const payload = b.ids.filter((id) => names.has(id)).map((id, i) => ({ id, name_en: names.get(id)!, sort: i }));
  check(await db(c.env).from('products').upsert(payload, { onConflict: 'id' }));
  return c.json({ ok: true });
});

/** Bulk actions from the Products list (one query for any number of products). */
catalogRoutes.post('/products/bulk', ownerOnly, async (c) => {
  const b = await body(c, z.object({
    ids: z.array(z.string().uuid()).min(1).max(1000),
    action: z.enum(['move', 'show', 'hide', 'feature', 'unfeature', 'delete', 'group']),
    category_id: z.string().uuid().nullable().optional(),
    group_id: z.string().uuid().nullable().optional(),
  }));
  if (b.action === 'group') {
    // into a product (its category follows) or out of any product (group_id null)
    const patch = b.group_id ? await withGroupCategory(c.env, { group_id: b.group_id }) : { group_id: null };
    const rows = check(await db(c.env).from('products').update(patch).in('id', b.ids).select('id')) as { id: string }[];
    await log(c, 'product.bulk_group', 'products', `${rows.length}`, { ids: b.ids, ...patch });
    return c.json({ ok: true, updated: rows.length });
  }
  if (b.action === 'delete') {
    // products with orders keep their history, products with unsold stock keep their items:
    // both are skipped (hide them instead)
    const [ordered, stocked] = await Promise.all([
      db(c.env).from('orders').select('product_id').in('product_id', b.ids),
      db(c.env).from('stock_items').select('product_id').in('product_id', b.ids).eq('status', 'available'),
    ]);
    const keep = new Set([...(check(ordered) as { product_id: string }[]), ...(check(stocked) as { product_id: string }[])].map((r) => r.product_id));
    const ids = b.ids.filter((id) => !keep.has(id));
    const rows = ids.length ? (check(await db(c.env).from('products').delete().in('id', ids).select('id')) as { id: string }[]) : [];
    await log(c, 'product.bulk_delete', 'products', `${rows.length}`, { ids: rows.map((r) => r.id), skipped: [...keep] });
    return c.json({ ok: true, deleted: rows.length, skipped: b.ids.length - rows.length });
  }
  const patch =
    b.action === 'move' ? { category_id: b.category_id ?? null }
    : b.action === 'show' ? { is_active: true }
    : b.action === 'hide' ? { is_active: false }
    : { is_featured: b.action === 'feature' };
  if (b.action === 'move' && b.category_id) {
    const cat = check(await db(c.env).from('categories').select('id').eq('id', b.category_id).maybeSingle());
    if (!cat) fail(404, 'Category not found');
  }
  const rows = check(await db(c.env).from('products').update(patch).in('id', b.ids).select('id')) as { id: string }[];
  await log(c, `product.bulk_${b.action}`, 'products', `${rows.length}`, { ids: b.ids, ...patch });
  return c.json({ ok: true, updated: rows.length });
});

/** Accept the new provider cost of a pack paused by a cost jump. */
catalogRoutes.post('/products/:id/accept-cost', ownerOnly, async (c) => {
  const row = await acceptPendingCost(c.env, c.req.param('id')!);
  await log(c, 'product.accept_cost', 'product', row.id, { cost_basis: row.cost_basis });
  return c.json({ ok: true, product: row });
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
  const { count: availableBefore } = await db(c.env).from('stock_items').select('id', { count: 'exact', head: true }).eq('product_id', productId).eq('status', 'available');
  for (let i = 0; i < items.length; i += 500) {
    check(await db(c.env).from('stock_items').insert(items.slice(i, i + 500).map((content) => ({
      product_id: productId, content, batch: b.batch ?? null, created_by: admin.user_id,
    }))));
  }
  // make sure the product has a stock source
  const existingStock = check(await db(c.env).from('product_sources').select('id').eq('product_id', productId).eq('kind', 'stock')) as { id: string }[];
  if (!existingStock.length) await db(c.env).from('product_sources').insert({ product_id: productId, kind: 'stock', priority: 0 });
  // empty → refilled: customers get a "back in stock" alert on the next cron tick
  if (items.length && !availableBefore) await markRestocked(c.env, [productId]);
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

// ─────────────────────────────────────────────────────────────────────────────
// Product groups ("products" customers see: ChatGPT Plus → its packs)
// ─────────────────────────────────────────────────────────────────────────────

const groupSchema = z.object({
  category_id: z.string().uuid().nullable().optional(),
  name_en: z.string().trim().min(1).max(200),
  name_ar: z.string().max(200).nullable().optional(),
  description_en: z.string().max(4000).nullable().optional(),
  description_ar: z.string().max(4000).nullable().optional(),
  emoji: z.string().max(16).nullable().optional(),
  custom_emoji_id: z.string().max(40).nullable().optional(),
  image_url: z.string().max(1000).nullable().optional(),
  button_style: styleEnum.nullable().optional(),
  sort: z.number().int().optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
});

/** Move packs into a group (their category follows the group's). */
async function attachPacks(env: Parameters<typeof db>[0], groupId: string, categoryId: string | null, productIds: string[]): Promise<number> {
  if (!productIds.length) return 0;
  const rows = check(await db(env).from('products').update({ group_id: groupId, category_id: categoryId }).in('id', productIds).select('id')) as { id: string }[];
  return rows.length;
}

catalogRoutes.get('/groups', async (c) => {
  const s = await getSettings(c.env);
  let q = db(c.env).from('product_groups').select('*').order('sort').order('name_en');
  const cat = c.req.query('category_id');
  if (cat === 'none') q = q.is('category_id', null);
  else if (cat) q = q.eq('category_id', cat);
  const groups = check(await q) as ProductGroupRow[];
  if (!groups.length) return c.json({ ok: true, groups: [] });
  // unfiltered: every grouped pack (avoids a URL with hundreds of group ids)
  const pq = db(c.env).from('products').select('*');
  const packs = check(await (cat ? pq.in('group_id', groups.map((g) => g.id)) : pq.not('group_id', 'is', null))) as ProductRow[];
  const views = await viewProducts(c.env, s, packs, null);
  const byGroup = new Map<string, ProductView[]>();
  for (const v of views) {
    const list = byGroup.get(v.product.group_id!) ?? [];
    list.push(v);
    byGroup.set(v.product.group_id!, list);
  }
  return c.json({
    ok: true,
    groups: groups.map((g) => {
      const vs = byGroup.get(g.id) ?? [];
      const live = vs.filter((v) => v.product.is_active && !v.pricing.soldOut && v.pricing.unitPrice != null);
      return {
        ...g,
        packs: vs.length,
        active_packs: vs.filter((v) => v.product.is_active).length,
        in_stock: live.length,
        paused: vs.filter((v) => v.product.paused_reason).length,
        from_price: live.length ? Math.min(...live.map((v) => v.pricing.unitPrice!)) : null,
      };
    }),
  });
});

catalogRoutes.get('/groups/:id', async (c) => {
  const s = await getSettings(c.env);
  const g = check(await db(c.env).from('product_groups').select('*').eq('id', c.req.param('id')).maybeSingle()) as ProductGroupRow | null;
  if (!g) fail(404, 'Product not found');
  const packs = check(await db(c.env).from('products').select('*').eq('group_id', g.id)) as ProductRow[];
  const views = sortPacks(await viewProducts(c.env, s, packs, null));
  return c.json({ ok: true, group: g, packs: views.map((v) => packItem(v)) });
});

catalogRoutes.post('/groups/reorder', ownerOnly, async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()).max(1000) }));
  if (!b.ids.length) return c.json({ ok: true });
  const rows = check(await db(c.env).from('product_groups').select('id,name_en').in('id', b.ids)) as { id: string; name_en: string }[];
  const names = new Map(rows.map((r) => [r.id, r.name_en]));
  check(await db(c.env).from('product_groups').upsert(
    b.ids.filter((id) => names.has(id)).map((id, i) => ({ id, name_en: names.get(id)!, sort: i })),
    { onConflict: 'id' },
  ));
  return c.json({ ok: true });
});

catalogRoutes.post('/groups', ownerOnly, async (c) => {
  const b = await body(c, groupSchema.extend({ product_ids: z.array(z.string().uuid()).max(1000).optional() }));
  const { product_ids, ...fields } = b;
  const g = check(await db(c.env).from('product_groups').insert(fields).select('*').single()) as ProductGroupRow;
  const attached = await attachPacks(c.env, g.id, g.category_id, product_ids ?? []);
  await log(c, 'group.create', 'group', g.id, { name: g.name_en, packs: attached });
  return c.json({ ok: true, group: g, attached });
});

catalogRoutes.patch('/groups/:id', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  const b = await body(c, groupSchema.partial());
  const g = check(await db(c.env).from('product_groups').update(b).eq('id', id).select('*').single()) as ProductGroupRow;
  // a product moved to another category takes its packs along
  if ('category_id' in b) check(await db(c.env).from('products').update({ category_id: g.category_id }).eq('group_id', id));
  await log(c, 'group.update', 'group', id, b);
  return c.json({ ok: true, group: g });
});

/** Deleting a product keeps its packs: they go back to "packs without a product". */
catalogRoutes.delete('/groups/:id', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  check(await db(c.env).from('products').update({ group_id: null }).eq('group_id', id));
  check(await db(c.env).from('product_groups').delete().eq('id', id));
  await log(c, 'group.delete', 'group', id);
  return c.json({ ok: true });
});

catalogRoutes.post('/groups/:id/packs', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  const b = await body(c, z.object({ product_ids: z.array(z.string().uuid()).min(1).max(1000) }));
  const g = check(await db(c.env).from('product_groups').select('id,category_id').eq('id', id).maybeSingle()) as { id: string; category_id: string | null } | null;
  if (!g) fail(404, 'Product not found');
  const attached = await attachPacks(c.env, g.id, g.category_id, b.product_ids);
  await log(c, 'group.attach', 'group', id, { packs: b.product_ids });
  return c.json({ ok: true, attached });
});

/** Pack order inside a product (one bulk upsert, see /products/reorder). */
catalogRoutes.post('/groups/:id/reorder', ownerOnly, async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()).max(1000) }));
  if (!b.ids.length) return c.json({ ok: true });
  const rows = check(await db(c.env).from('products').select('id,name_en').in('id', b.ids).eq('group_id', c.req.param('id')!)) as { id: string; name_en: string }[];
  const names = new Map(rows.map((r) => [r.id, r.name_en]));
  check(await db(c.env).from('products').upsert(
    b.ids.filter((id) => names.has(id)).map((id, i) => ({ id, name_en: names.get(id)!, sort: i })),
    { onConflict: 'id' },
  ));
  return c.json({ ok: true });
});

interface AutoEntry {
  key: string;
  name: string;
  existing_group_id: string | null;
  category_id: string | null;
  packs: { id: string; name_en: string; source_name: string | null }[];
}

/**
 * Group the packs that have no product yet, by the product their provider name points to
 * ("Capcut pro 1M …" and "CapCut Pro Team 3 Months" → CapCut Pro). Packs are never renamed.
 * dry_run returns the plan; otherwise groups are created (or reused by name) and packs attached.
 */
catalogRoutes.post('/groups/auto', ownerOnly, async (c) => {
  const b = await body(c, z.object({
    dry_run: z.boolean().default(true),
    category_id: z.string().uuid().nullable().optional(),
    // 2 = leave single packs as they are (they still join an existing product of the same name)
    min_packs: z.number().int().min(1).max(50).default(1),
  }));
  const s = await getSettings(c.env);
  let q = db(c.env).from('products').select('id,name_en,category_id').eq('is_active', true).is('group_id', null);
  if (b.category_id) q = q.eq('category_id', b.category_id);
  const packs = check(await q) as Pick<ProductRow, 'id' | 'name_en' | 'category_id'>[];
  if (!packs.length) return c.json({ ok: true, plan: [], applied: false });

  // the primary provider product's name is the best grouping hint
  const sources = check(await db(c.env).from('product_sources').select('product_id,provider_product_id,priority,is_enabled')
    .in('product_id', packs.map((p) => p.id)).eq('kind', 'provider')) as Pick<ProductSourceRow, 'product_id' | 'provider_product_id' | 'priority' | 'is_enabled'>[];
  const primary = new Map<string, string>();
  for (const src of [...sources].sort((x, y) => Number(y.is_enabled) - Number(x.is_enabled) || x.priority - y.priority)) {
    if (src.provider_product_id && !primary.has(src.product_id)) primary.set(src.product_id, src.provider_product_id);
  }
  const ppIds = [...new Set(primary.values())];
  const pps = ppIds.length ? (check(await db(c.env).from('provider_products').select('id,name').in('id', ppIds)) as { id: string; name: string }[]) : [];
  const ppName = new Map(pps.map((p) => [p.id, p.name]));

  const existing = check(await db(c.env).from('product_groups').select('id,name_en,category_id')) as Pick<ProductGroupRow, 'id' | 'name_en' | 'category_id'>[];
  const byName = new Map<string, Pick<ProductGroupRow, 'id' | 'name_en' | 'category_id'>>();
  for (const g of existing) if (!byName.has(g.name_en.toLowerCase())) byName.set(g.name_en.toLowerCase(), g);

  const plan = new Map<string, AutoEntry>();
  for (const p of packs) {
    const source = primary.has(p.id) ? ppName.get(primary.get(p.id)!) ?? null : null;
    const clean = cleanProviderName(source ?? p.name_en, s.catalog?.name_words ?? {});
    const entry = plan.get(clean.key) ?? { key: clean.key, name: clean.product, existing_group_id: byName.get(clean.key)?.id ?? null, category_id: null, packs: [] };
    entry.packs.push({ id: p.id, name_en: p.name_en, source_name: source });
    plan.set(clean.key, entry);
  }
  // category: the one asked for, the existing group's, else the most common among its packs
  const catOf = new Map(packs.map((p) => [p.id, p.category_id]));
  for (const e of plan.values()) {
    if (b.category_id) { e.category_id = b.category_id; continue; }
    if (e.existing_group_id) { e.category_id = byName.get(e.key)!.category_id; continue; }
    const tally = new Map<string, number>();
    for (const pk of e.packs) { const cid = catOf.get(pk.id); if (cid) tally.set(cid, (tally.get(cid) ?? 0) + 1); }
    e.category_id = [...tally.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  }
  const list = [...plan.values()]
    .filter((e) => e.existing_group_id || e.packs.length >= b.min_packs)
    .sort((x, y) => y.packs.length - x.packs.length || x.name.localeCompare(y.name));
  if (b.dry_run) return c.json({ ok: true, plan: list, applied: false });

  // apply: new groups in one insert, all packs in one upsert (few queries for any size)
  const fresh = list.filter((e) => !e.existing_group_id).map((e) => ({ id: crypto.randomUUID(), name_en: e.name, category_id: e.category_id, key: e.key }));
  if (fresh.length) check(await db(c.env).from('product_groups').insert(fresh.map(({ key: _k, ...g }) => g)));
  const idOf = new Map(fresh.map((g) => [g.key, g.id]));
  const rows = list.flatMap((e) => e.packs.map((pk) => ({ id: pk.id, name_en: pk.name_en, group_id: e.existing_group_id ?? idOf.get(e.key)!, category_id: e.category_id })));
  for (let i = 0; i < rows.length; i += 500) check(await db(c.env).from('products').upsert(rows.slice(i, i + 500), { onConflict: 'id' }));
  await log(c, 'group.auto', 'groups', `${fresh.length}`, { groups: list.length, packs: rows.length });
  return c.json({ ok: true, plan: list, applied: true, created: fresh.length, packs: rows.length });
});

/** Live preview for Settings → Catalog: how provider names group with the (unsaved) word list. */
catalogRoutes.post('/names/preview', async (c) => {
  const b = await body(c, z.object({ names: z.array(z.string().max(300)).max(300), words: z.record(z.string(), z.string()).optional() }));
  const s = await getSettings(c.env);
  const words = b.words ?? s.catalog?.name_words ?? {};
  return c.json({ ok: true, items: b.names.filter((n) => n.trim()).map((n) => ({ name: n, ...cleanProviderName(n, words) })) });
});
