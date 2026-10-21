import type { Env } from '../env';
import type { AppSettings } from '../lib/settings';
import type { CategoryRow, ProductRow, ProductSourceRow, ProviderProductRow, ProviderRow, UserRow } from '../types';
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

/** Active products of a category, priced for this user. Sold-out items hidden if settings say so. */
export async function listProducts(env: Env, s: AppSettings, categoryId: string, user: UserRow | null): Promise<ProductView[]> {
  const rows = must(
    await db(env).from('products').select('*').eq('category_id', categoryId).eq('is_active', true).order('sort').order('name_en'),
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
  const rows = must(await q, 'products') as ProductRow[];
  const views = await viewProducts(env, s, rows, user);
  return views.filter((v) => v.pricing.unitPrice != null && (opts.includeSoldOut || !v.pricing.soldOut));
}

/** Count of active products per category (for category buttons). */
export async function productCounts(env: Env): Promise<Map<string, number>> {
  const rows = must(await db(env).from('products').select('category_id').eq('is_active', true), 'product counts') as { category_id: string | null }[];
  const m = new Map<string, number>();
  for (const r of rows) if (r.category_id) m.set(r.category_id, (m.get(r.category_id) ?? 0) + 1);
  return m;
}
