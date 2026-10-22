import type { Env } from '../env';
import type { AppSettings } from '../lib/settings';
import type { ProductGroupRow, ProductRow, UserRow } from '../types';
import { db, must } from '../lib/db';
import { orderPacks, viewProducts, type GroupView, type ProductView } from './catalog';

// Customer search (bot /search and inline mode). Every word of the query is matched on its
// own, so "capcut 1m" finds the pack "CapCut Pro 1M". Products (groups) are matched on their
// name; packs on their own name plus their product's name. A pack is not listed again when
// its product matched. When nothing matches every word, results matching some words are
// shown instead (most words first). Budget: 4–6 subrequests per search.

export interface SearchResult {
  groups: GroupView[];
  packs: ProductView[];
}

const MAX_WORDS = 5;
const MAX_CANDIDATES = 300;
const nameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Lowercase words of a query: letters and digits only (so %, _, commas and brackets never
 * reach the ilike / PostgREST filter), single characters dropped, at most 5 words.
 * Returns [] when the query is too short to search (under 2 characters).
 */
export function searchWords(query: string): string[] {
  const words = (query.toLowerCase().normalize('NFKC').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length >= 2)
    .map((w) => w.slice(0, 40));
  return [...new Set(words)].slice(0, MAX_WORDS);
}

/** How many of the words appear in the text (case-insensitive substring). */
export function matchCount(text: string, words: string[]): number {
  const hay = text.toLowerCase().normalize('NFKC').replace(/\p{M}/gu, '');
  return words.filter((w) => hay.includes(w)).length;
}

function names(row: { name_en: string; name_ar: string | null }): string {
  return `${row.name_en} ${row.name_ar ?? ''}`;
}

/** PostgREST or-filter: any word in name_en / name_ar (words are letters/digits only). */
function anyWordFilter(words: string[]): string {
  return words.flatMap((w) => [`name_en.ilike.*${w}*`, `name_ar.ilike.*${w}*`]).join(',');
}

function sellable(s: AppSettings, v: ProductView): boolean {
  return v.pricing.unitPrice != null && (s.bot.show_sold_out || !v.pricing.soldOut);
}

function toGroupView(group: ProductGroupRow, packs: ProductView[]): GroupView | null {
  if (!packs.length) return null;
  const ordered = orderPacks(packs);
  const live = ordered.filter((v) => !v.pricing.soldOut);
  const pool = live.length ? live : ordered;
  return { group, packs: ordered, fromPrice: Math.min(...pool.map((v) => v.pricing.unitPrice!)), inStock: live.length > 0 };
}

/** In stock first, then name. */
function byStockThenName<T>(stock: (x: T) => boolean, name: (x: T) => string) {
  return (a: T, b: T) => Number(stock(b)) - Number(stock(a)) || nameCollator.compare(name(a), name(b));
}

export async function searchCatalog(env: Env, s: AppSettings, query: string, user: UserRow | null, limit = 20): Promise<SearchResult> {
  const words = searchWords(query);
  if (!words.length) return { groups: [], packs: [] };

  // all groups (small table): hidden ones are needed to exclude their packs
  const allGroups = must(await db(env).from('product_groups').select('*'), 'search groups') as ProductGroupRow[];
  const groupById = new Map(allGroups.map((g) => [g.id, g]));
  const groupScore = new Map<string, number>();
  for (const g of allGroups) {
    if (!g.is_active) continue;
    const n = matchCount(names(g), words);
    if (n) groupScore.set(g.id, n);
  }

  // packs whose name has any word, plus the packs of groups that have any word
  const groupIds = [...groupScore.keys()].slice(0, 100);
  const filter = anyWordFilter(words) + (groupIds.length ? `,group_id.in.(${groupIds.join(',')})` : '');
  const rows = must(
    await db(env).from('products').select('*').eq('is_active', true).or(filter).limit(MAX_CANDIDATES),
    'search packs',
  ) as ProductRow[];
  const visibleRows = rows.filter((r) => !r.group_id || groupById.get(r.group_id)?.is_active === true);
  const views = (await viewProducts(env, s, visibleRows, user)).filter((v) => sellable(s, v));

  const packsByGroup = new Map<string, ProductView[]>();
  for (const v of views) {
    if (!v.product.group_id) continue;
    const list = packsByGroup.get(v.product.group_id) ?? [];
    list.push(v);
    packsByGroup.set(v.product.group_id, list);
  }

  type Hit<T> = { item: T; score: number };
  const groupHits: Hit<GroupView>[] = [];
  for (const [id, score] of groupScore) {
    const gv = toGroupView(groupById.get(id)!, packsByGroup.get(id) ?? []);
    if (gv) groupHits.push({ item: gv, score });
  }
  const packHits: Hit<ProductView>[] = views.map((v) => {
    const g = v.product.group_id ? groupById.get(v.product.group_id) : null;
    return { item: v, score: matchCount(`${names(v.product)} ${g ? names(g) : ''}`, words) };
  }).filter((h) => h.score > 0);

  // every word if possible, else the best partial matches
  const best = Math.max(0, ...groupHits.map((h) => h.score), ...packHits.map((h) => h.score));
  const min = best === words.length ? words.length : 1;
  const groups = groupHits.filter((h) => h.score >= min);
  const shownGroups = new Set(groups.map((h) => h.item.group.id));
  const packs = packHits.filter((h) => h.score >= min && !(h.item.product.group_id && shownGroups.has(h.item.product.group_id)));

  const groupOrder = byStockThenName<Hit<GroupView>>((h) => h.item.inStock, (h) => h.item.group.name_en);
  const packOrder = byStockThenName<Hit<ProductView>>((h) => !h.item.pricing.soldOut, (h) => h.item.product.name_en);
  groups.sort((a, b) => b.score - a.score || groupOrder(a, b));
  packs.sort((a, b) => b.score - a.score || packOrder(a, b));

  const outGroups = groups.slice(0, limit).map((h) => h.item);
  return { groups: outGroups, packs: packs.slice(0, Math.max(0, limit - outGroups.length)).map((h) => h.item) };
}

/** What inline mode shows before anything is typed: featured products first, then the rest. */
export async function featuredCatalog(env: Env, s: AppSettings, user: UserRow | null, limit = 20): Promise<SearchResult> {
  const groups = must(
    await db(env).from('product_groups').select('*').eq('is_active', true).order('is_featured', { ascending: false }).order('sort').order('name_en').limit(limit),
    'featured groups',
  ) as ProductGroupRow[];
  const filter = `group_id.is.null${groups.length ? `,group_id.in.(${groups.map((g) => g.id).join(',')})` : ''}`;
  const rows = must(
    await db(env).from('products').select('*').eq('is_active', true).or(filter).order('is_featured', { ascending: false }).order('sort').order('name_en').limit(MAX_CANDIDATES),
    'featured packs',
  ) as ProductRow[];
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const views = (await viewProducts(env, s, rows.filter((r) => !r.group_id || groupById.has(r.group_id)), user)).filter((v) => sellable(s, v) && !v.pricing.soldOut);

  const byGroup = new Map<string, ProductView[]>();
  for (const v of views) {
    if (!v.product.group_id) continue;
    const list = byGroup.get(v.product.group_id) ?? [];
    list.push(v);
    byGroup.set(v.product.group_id, list);
  }
  const outGroups = groups.map((g) => toGroupView(g, byGroup.get(g.id) ?? [])).filter((g): g is GroupView => g !== null);
  const loose = views.filter((v) => !v.product.group_id); // featured first (query order)
  return { groups: outGroups.slice(0, limit), packs: loose.slice(0, Math.max(0, limit - outGroups.length)) };
}
