import type { Env } from '../env';
import type { AppSettings } from '../lib/settings';
import type { CategoryRow, ProductGroupRow, ProductRow, ProductSourceRow, ProviderProductRow, ProviderRow, UserRow } from '../types';
import { db, must } from '../lib/db';
import { buildOption, priceProduct, type ProductPricing, type SourceOption } from './pricing';

export interface ProductView {
  product: ProductRow;
  pricing: ProductPricing;
}

export async function listCategories(env: Env, parentId: string | null = null): Promise<CategoryRow[]> {
  let q = db(env).from('categories').select('*').eq('is_active', true).order('sort').order('name_en');
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  return must(await q, 'categories') as CategoryRow[];
}

export async function getCategory(env: Env, id: string): Promise<CategoryRow | null> {
  return must(await db(env).from('categories').select('*').eq('id', id).maybeSingle(), 'category') as CategoryRow | null;
}

/** Load sources + provider products + providers + stock counts for a batch of products. */
export async function loadOptions(env: Env, products: ProductRow[]): Promise<Map<string, SourceOption[]>> {
  const out = new Map<string, SourceOption[]>();
  if (!products.length) return out;
  const ids = products.map((p) => p.id);

  const sources = must(await db(env).from('product_sources').select('*').in('product_id', ids), 'sources') as ProductSourceRow[];
  const ppIds = [...new Set(sources.map((s) => s.provider_product_id).filter(Boolean) as string[])];
  const stockProductIds = [...new Set(sources.filter((s) => s.kind === 'stock').map((s) => s.product_id))];

  const [pps, providers, counts] = await Promise.all([
    ppIds.length
      ? (must(await db(env).from('provider_products').select('*').in('id', ppIds), 'provider_products') as ProviderProductRow[])
      : [],
    must(await db(env).from('providers').select('*'), 'providers') as ProviderRow[],
    stockProductIds.length
      ? (must(await db(env).rpc('stock_counts', { p_product_ids: stockProductIds }), 'stock_counts') as { product_id: string; available: number }[])
      : [],
  ]);

  const ppMap = new Map(pps.map((p) => [p.id, p]));
  const provMap = new Map(providers.map((p) => [p.id, p]));
  const countMap = new Map(counts.map((c) => [c.product_id, Number(c.available)]));
  const prodMap = new Map(products.map((p) => [p.id, p]));

  for (const s of sources) {
    const product = prodMap.get(s.product_id)!;
    const pp = s.provider_product_id ? ppMap.get(s.provider_product_id) ?? null : null;
    const prov = pp ? provMap.get(pp.provider_id) ?? null : null;
    const opt = buildOption(s, pp, prov, countMap.get(s.product_id) ?? 0, product);
    const list = out.get(s.product_id) ?? [];
    list.push(opt);
    out.set(s.product_id, list);
  }
  return out;
}

export async function viewProducts(env: Env, s: AppSettings, products: ProductRow[], user: UserRow | null): Promise<ProductView[]> {
  const opts = await loadOptions(env, products);
  return products.map((product) => ({ product, pricing: priceProduct(product, opts.get(product.id) ?? [], s, user) }));
}

/**
 * Active packs of a category that are NOT inside a product group (grouped packs are listed on
 * their group's screen), priced for this user. Sold-out items hidden if settings say so.
 */
export async function listProducts(env: Env, s: AppSettings, categoryId: string, user: UserRow | null): Promise<ProductView[]> {
  const rows = must(
    await db(env).from('products').select('*').eq('category_id', categoryId).is('group_id', null).eq('is_active', true).order('sort').order('name_en'),
    'products',
  ) as ProductRow[];
  const views = await viewProducts(env, s, rows, user);
  return views.filter((v) => v.pricing.unitPrice != null && (s.bot.show_sold_out || !v.pricing.soldOut));
}

export async function getProductView(env: Env, s: AppSettings, productId: string, user: UserRow | null): Promise<ProductView | null> {
  const row = must(await db(env).from('products').select('*').eq('id', productId).maybeSingle(), 'product') as ProductRow | null;
  if (!row) return null;
  return (await viewProducts(env, s, [row], user))[0];
}

/** Every active, in-stock product (for the /product price list and the landing page). */
export async function listAllProducts(env: Env, s: AppSettings, user: UserRow | null, opts: { featuredOnly?: boolean; includeSoldOut?: boolean } = {}): Promise<ProductView[]> {
  let q = db(env).from('products').select('*').eq('is_active', true).order('sort').order('name_en');
  if (opts.featuredOnly) q = q.eq('is_featured', true);
  const [rows, hiddenGroups] = await Promise.all([
    q.then((r) => must(r, 'products') as ProductRow[]),
    inactiveGroupIds(env),
  ]);
  const views = await viewProducts(env, s, rows.filter((r) => !r.group_id || !hiddenGroups.has(r.group_id)), user);
  return views.filter((v) => v.pricing.unitPrice != null && (opts.includeSoldOut || !v.pricing.soldOut));
}

async function inactiveGroupIds(env: Env): Promise<Set<string>> {
  const rows = must(await db(env).from('product_groups').select('id').eq('is_active', false), 'hidden groups') as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Customer-visible entries per category (for category buttons and landing tiles): each active
 * product group with at least one active pack counts once, plus every active pack that has no
 * group. Key UNCATEGORIZED = entries without a category.
 */
export async function productCounts(env: Env): Promise<Map<string, number>> {
  const [rows, groups] = await Promise.all([
    db(env).from('products').select('category_id,group_id').eq('is_active', true).then((r) => must(r, 'product counts') as { category_id: string | null; group_id: string | null }[]),
    db(env).from('product_groups').select('id,category_id').eq('is_active', true).then((r) => must(r, 'group counts') as { id: string; category_id: string | null }[]),
  ]);
  const groupCat = new Map(groups.map((g) => [g.id, g.category_id]));
  const counted = new Set<string>();
  const m = new Map<string, number>();
  for (const r of rows) {
    let k: string;
    if (r.group_id) {
      if (!groupCat.has(r.group_id) || counted.has(r.group_id)) continue; // hidden group, or already counted
      counted.add(r.group_id);
      k = groupCat.get(r.group_id) ?? UNCATEGORIZED;
    } else {
      k = r.category_id ?? UNCATEGORIZED;
    }
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** productCounts() key for active products without a category. */
export const UNCATEGORIZED = 'none';

/** Active products without a category (shown as "Other products" in the bot). */
export async function listUncategorizedProducts(env: Env, s: AppSettings, user: UserRow | null): Promise<ProductView[]> {
  const rows = must(
    await db(env).from('products').select('*').is('category_id', null).is('group_id', null).eq('is_active', true).order('sort').order('name_en'),
    'uncategorized products',
  ) as ProductRow[];
  const views = await viewProducts(env, s, rows, user);
  return views.filter((v) => v.pricing.unitPrice != null && (s.bot.show_sold_out || !v.pricing.soldOut));
}

// ─────────────────────────────────────────────────────────────────────────────
// Product groups (Category → Product → Packs)
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupView {
  group: ProductGroupRow;
  /** active, priced packs in display order */
  packs: ProductView[];
  /** lowest price of an in-stock pack (or of any pack when all are sold out) */
  fromPrice: number | null;
  inStock: boolean;
}

const nameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Pack order inside a product: sold out last, pinned first, then the admin's sort,
 * then price, then natural name order ("ChatGPT 12M" before "ChatGPT 100M").
 */
export function orderPacks<T extends ProductView>(views: T[]): T[] {
  return [...views].sort((a, b) =>
    Number(a.pricing.soldOut) - Number(b.pricing.soldOut)
    || Number(b.product.pinned ?? false) - Number(a.product.pinned ?? false)
    || (a.product.sort ?? 0) - (b.product.sort ?? 0)
    || (a.pricing.unitPrice ?? Number.MAX_VALUE) - (b.pricing.unitPrice ?? Number.MAX_VALUE)
    || nameCollator.compare(a.product.name_en, b.product.name_en));
}

function toGroupView(group: ProductGroupRow, views: ProductView[], s: AppSettings): GroupView | null {
  const priced = views.filter((v) => v.pricing.unitPrice != null && (s.bot.show_sold_out || !v.pricing.soldOut));
  if (!priced.length) return null;
  const packs = orderPacks(priced);
  const live = packs.filter((v) => !v.pricing.soldOut);
  const pool = live.length ? live : packs;
  return {
    group,
    packs,
    fromPrice: Math.min(...pool.map((v) => v.pricing.unitPrice!)),
    inStock: live.length > 0,
  };
}

/** Packs of the given groups, priced in one batch. */
async function groupPacks(env: Env, s: AppSettings, groups: ProductGroupRow[], user: UserRow | null): Promise<GroupView[]> {
  if (!groups.length) return [];
  const rows = must(
    await db(env).from('products').select('*').in('group_id', groups.map((g) => g.id)).eq('is_active', true),
    'group packs',
  ) as ProductRow[];
  const views = await viewProducts(env, s, rows, user);
  const byGroup = new Map<string, ProductView[]>();
  for (const v of views) {
    const list = byGroup.get(v.product.group_id!) ?? [];
    list.push(v);
    byGroup.set(v.product.group_id!, list);
  }
  return groups.map((g) => toGroupView(g, byGroup.get(g.id) ?? [], s)).filter((g): g is GroupView => g !== null);
}

/** Active product groups of a category (null = groups without a category). */
export async function listGroups(env: Env, s: AppSettings, categoryId: string | null, user: UserRow | null): Promise<GroupView[]> {
  let q = db(env).from('product_groups').select('*').eq('is_active', true).order('sort').order('name_en');
  q = categoryId ? q.eq('category_id', categoryId) : q.is('category_id', null);
  const groups = must(await q, 'groups') as ProductGroupRow[];
  return groupPacks(env, s, groups, user);
}

export async function getGroupView(env: Env, s: AppSettings, groupId: string, user: UserRow | null): Promise<GroupView | null> {
  const group = must(await db(env).from('product_groups').select('*').eq('id', groupId).maybeSingle(), 'group') as ProductGroupRow | null;
  if (!group || !group.is_active) return null;
  return (await groupPacks(env, s, [group], user))[0] ?? null;
}

/** Everything a category screen lists: its product groups, then its packs that have no group. */
export async function listCategoryEntries(
  env: Env,
  s: AppSettings,
  categoryId: string | null,
  user: UserRow | null,
): Promise<{ groups: GroupView[]; packs: ProductView[] }> {
  const [groups, packs] = await Promise.all([
    listGroups(env, s, categoryId, user),
    categoryId ? listProducts(env, s, categoryId, user) : listUncategorizedProducts(env, s, user),
  ]);
  return { groups, packs };
}

/** Active groups by id (price list, landing). */
export async function activeGroups(env: Env): Promise<Map<string, ProductGroupRow>> {
  const rows = must(await db(env).from('product_groups').select('*').eq('is_active', true).order('sort').order('name_en'), 'groups') as ProductGroupRow[];
  return new Map(rows.map((g) => [g.id, g]));
}
