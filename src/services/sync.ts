import type { AppCtx } from '../env';
import type { ProductRow, ProductSourceRow, ProviderProductRow, ProviderRow } from '../types';
import type { NormalizedProduct } from '../providers/types';
import { ProviderError } from '../providers/types';
import { getAdapter, providerContext } from '../providers/registry';
import { db, must } from '../lib/db';
import { sha256Hex } from '../lib/crypto';
import { getSettings } from '../lib/settings';
import { fmtUsd } from '../lib/money';
import { escapeHtml } from '../lib/i18n';
import { notifyAdmins } from './notify';
import { SYNCABLE_FIELDS } from './sync-fields';
import { markRestocked } from './alerts';
import { applyPriceGuards } from './price-guards';

export interface SyncStats {
  total: number;
  added: number;
  updated: number;
  removed: number;
  restored: number;
  priceChanged: number;
  productsUpdated?: number;
  errors?: string[];
}

const CHUNK = 200;
const MAX_PRODUCT_UPDATES = 400; // per sync; written in bulk upserts
const COST_ALERT_RATIO = 0.1;

type ExistingRow = Pick<ProviderProductRow, 'id' | 'external_id' | 'name' | 'cost' | 'stock' | 'is_available' | 'is_removed' | 'content_hash' | 'last_changed_at'>;

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function contentHash(p: NormalizedProduct): Promise<string> {
  return sha256Hex([p.name, p.description ?? '', p.image_url ?? '', p.warranty_days ?? '', p.delivery_kind, JSON.stringify(p.requirements ?? {})].join('|'));
}

async function loadExisting(app: AppCtx, providerId: string): Promise<ExistingRow[]> {
  const out: ExistingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(
      await db(app.env).from('provider_products')
        .select('id,external_id,name,cost,stock,is_available,is_removed,content_hash,last_changed_at')
        .eq('provider_id', providerId).order('id').range(from, from + 999),
      'pp existing',
    ) as ExistingRow[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

async function markSyncError(app: AppCtx, prov: ProviderRow, e: unknown): Promise<void> {
  const patch: Record<string, unknown> = {
    last_sync_at: new Date().toISOString(),
    last_sync_status: 'error',
    last_sync_error: (e as Error).message?.slice(0, 500) ?? 'error',
  };
  if (e instanceof ProviderError && e.status === 429) {
    patch.rate_limited_until = new Date(Date.now() + (e.retryAfterSec ?? 300) * 1000).toISOString();
  }
  await db(app.env).from('providers').update(patch).eq('id', prov.id);
}

/**
 * Mirror a provider catalog into provider_products, then refresh the info of linked
 * store products (auto_sync_info, respecting locked_fields). Prices/stock are never
 * copied to products — they are computed live from the sources.
 */
export async function syncProvider(app: AppCtx, providerId: string): Promise<SyncStats> {
  const { env } = app;
  const prov = must(await db(env).from('providers').select('*').eq('id', providerId).single(), 'provider') as ProviderRow;
  const stats: SyncStats = { total: 0, added: 0, updated: 0, removed: 0, restored: 0, priceChanged: 0 };

  let feed: NormalizedProduct[];
  try {
    feed = await getAdapter(prov.kind).listProducts(await providerContext(env, prov));
  } catch (e) {
    await markSyncError(app, prov, e);
    return { ...stats, errors: [(e as Error).message] };
  }

  try {
    const now = new Date().toISOString();
    const existing = await loadExisting(app, prov.id);
    const byExt = new Map(existing.map((r) => [r.external_id, r]));
    const seen = new Set<string>();

    const inserts: Record<string, unknown>[] = [];
    const upserts: Record<string, unknown>[] = [];
    const costChanges: { ppId: string; name: string; from: number; to: number }[] = [];
    const backInStock: string[] = []; // pp ids that became available again

    for (const p of feed) {
      if (seen.has(p.external_id)) continue;
      seen.add(p.external_id);
      const hash = await contentHash(p);
      const isAvailable = p.stock == null || p.stock > 0;
      const base = {
        provider_id: prov.id,
        external_id: p.external_id,
        name: p.name,
        description: p.description,
        image_url: p.image_url,
        emoji: p.emoji,
        delivery_kind: p.delivery_kind,
        raw_type: p.raw_type,
        cost: p.cost,
        cost_original: p.cost_original,
        cost_currency: p.cost_currency,
        stock: p.stock,
        sold: p.sold,
        warranty_days: p.warranty_days,
        requirements: p.requirements ?? {},
        price_tiers: p.price_tiers,
        promotions: p.promotions,
        raw: p.raw,
        content_hash: hash,
        is_available: isAvailable,
        is_removed: false,
        last_seen_at: now,
        removed_at: null,
      };
      const ex = byExt.get(p.external_id);
      if (!ex) {
        inserts.push({ ...base, is_new: true, first_seen_at: now, last_changed_at: now });
        stats.added++;
        continue;
      }
      const changed = ex.content_hash !== hash;
      if (changed) stats.updated++;
      if (ex.is_removed) stats.restored++;
      const oldCost = ex.cost == null ? null : Number(ex.cost);
      if (oldCost != null && p.cost != null && Math.abs(oldCost - p.cost) > 0.00005) {
        stats.priceChanged++;
        if (oldCost > 0 && Math.abs(p.cost - oldCost) / oldCost >= COST_ALERT_RATIO) costChanges.push({ ppId: ex.id, name: p.name, from: oldCost, to: p.cost });
      }
      if (isAvailable && (!ex.is_available || ex.is_removed)) backInStock.push(ex.id);
      upserts.push({ ...base, last_changed_at: changed ? now : ex.last_changed_at });
    }
    stats.total = seen.size;

    for (const c of chunks(inserts)) must(await db(env).from('provider_products').insert(c), 'pp insert');
    for (const c of chunks(upserts)) must(await db(env).from('provider_products').upsert(c, { onConflict: 'provider_id,external_id' }), 'pp upsert');

    const gone = existing.filter((r) => !seen.has(r.external_id) && !r.is_removed);
    stats.removed = gone.length;
    for (const c of chunks(gone.map((r) => r.id))) {
      must(await db(env).from('provider_products').update({ is_removed: true, is_available: false, removed_at: now }).in('id', c), 'pp removed');
    }

    // ── linked store products ──
    const ppIds = existing.map((r) => r.id); // new rows cannot be linked yet
    const linkedSources: ProductSourceRow[] = [];
    for (const c of chunks(ppIds)) {
      linkedSources.push(...(must(await db(env).from('product_sources').select('*').eq('kind', 'provider').in('provider_product_id', c), 'linked') as ProductSourceRow[]));
    }
    const linkedPp = new Set(linkedSources.map((s) => s.provider_product_id!));
    const productIds = [...new Set(linkedSources.map((s) => s.product_id))];

    const products: ProductRow[] = [];
    const allSources: ProductSourceRow[] = [];
    for (const c of chunks(productIds)) {
      products.push(...(must(await db(env).from('products').select('*').in('id', c), 'linked products') as ProductRow[]));
      allSources.push(...(must(await db(env).from('product_sources').select('*').in('product_id', c), 'linked all sources') as ProductSourceRow[]));
    }

    stats.productsUpdated = await refreshProductInfo(app, prov, products, allSources, feed, byExt);

    // price guards: cost basis, cost-jump review, manual price below the minimum margin
    const costByPp = new Map<string, number>();
    for (const f of feed) {
      const ex = byExt.get(f.external_id);
      if (ex && f.cost != null) costByPp.set(ex.id, Number(f.cost));
    }
    const guards = await applyPriceGuards(env, await getSettings(env), prov, products, allSources, costByPp);

    // ── notifications ──
    const lines: string[] = [];
    if (stats.added) {
      const names = inserts.slice(0, 15).map((r) => `• ${escapeHtml(String(r.name))}`);
      lines.push(`🆕 <b>${stats.added} new product(s)</b>${names.length ? `\n${names.join('\n')}` : ''}${stats.added > 15 ? '\n…' : ''}`);
    }
    const goneLinked = gone.filter((r) => linkedPp.has(r.id));
    if (goneLinked.length) lines.push(`🗑️ <b>Removed by provider (linked):</b>\n${goneLinked.slice(0, 15).map((r) => `• ${escapeHtml(r.name)}`).join('\n')}`);
    const costLinked = costChanges.filter((c) => linkedPp.has(c.ppId));
    if (costLinked.length) {
      lines.push(`💱 <b>Cost changes ≥10% (linked):</b>\n${costLinked.slice(0, 15).map((c) => `• ${escapeHtml(c.name)}: ${fmtUsd(c.from)} → ${fmtUsd(c.to)}`).join('\n')}`);
    }
    if (guards.jumps.length) {
      lines.push(`⏸️ <b>Paused — cost jumped (accept in admin → Products → Paused):</b>\n${guards.jumps.slice(0, 15).map((j) => `• ${escapeHtml(j.name)}: ${fmtUsd(j.from)} → ${fmtUsd(j.to)}`).join('\n')}`);
    }
    if (guards.belowMargin.length) lines.push(`⏸️ <b>Paused — your fixed price is below the minimum margin:</b>\n${guards.belowMargin.slice(0, 15).map((n) => `• ${escapeHtml(n)}`).join('\n')}`);
    if (guards.resumed.length) lines.push(`▶️ <b>Resumed (margin OK again):</b>\n${guards.resumed.slice(0, 15).map((n) => `• ${escapeHtml(n)}`).join('\n')}`);
    if (lines.length) await notifyAdmins(env, 'catalog_changes', `📦 <b>${escapeHtml(prov.name)}</b> catalog sync\n\n${lines.join('\n\n')}`);

    // announced to customers / the channel by services/alerts.ts on the next cron tick
    const restockedProducts = [...new Set(linkedSources.filter((s) => backInStock.includes(s.provider_product_id!)).map((s) => s.product_id))];
    await markRestocked(env, restockedProducts);

    await db(env).from('providers').update({
      last_sync_at: now,
      last_sync_status: 'ok',
      last_sync_error: null,
      last_sync_stats: stats,
      rate_limited_until: null,
    }).eq('id', prov.id);
    return stats;
  } catch (e) {
    await markSyncError(app, prov, e);
    return { ...stats, errors: [(e as Error).message] };
  }
}

/** Copy SYNCABLE_FIELDS from the primary provider source into products that follow it. */
async function refreshProductInfo(
  app: AppCtx,
  prov: ProviderRow,
  products: ProductRow[],
  sources: ProductSourceRow[],
  feed: NormalizedProduct[],
  byExt: Map<string, ExistingRow>,
): Promise<number> {
  const feedByPpId = new Map<string, NormalizedProduct>();
  for (const p of feed) {
    const ex = byExt.get(p.external_id);
    if (ex) feedByPpId.set(ex.id, p);
  }
  // changed products are written in bulk (one upsert per 200) to stay within the Free plan budget
  const rows: Record<string, unknown>[] = [];
  for (const product of products) {
    if (!product.auto_sync_info || rows.length >= MAX_PRODUCT_UPDATES) continue;
    const primary = sources
      .filter((s) => s.product_id === product.id && s.kind === 'provider' && s.is_enabled)
      .sort((a, b) => a.priority - b.priority)[0];
    const src = primary?.provider_product_id ? feedByPpId.get(primary.provider_product_id) : undefined;
    if (!src) continue; // primary belongs to another provider, or was removed

    const values: Record<string, unknown> = {
      name_en: src.name,
      description_en: src.description,
      image_url: src.image_url,
      warranty_days: src.warranty_days ?? undefined,
      emoji: src.emoji ?? undefined,
    };
    const patch: Record<string, unknown> = {};
    for (const f of SYNCABLE_FIELDS) {
      if (product.locked_fields?.includes(f)) continue;
      const v = values[f];
      if (v === undefined || v === null) continue; // never blank out a field
      if ((product as unknown as Record<string, unknown>)[f] !== v) patch[f] = v;
    }
    if (Object.keys(patch).length) {
      // every row carries all syncable fields (current value when unchanged/locked) so one
      // upsert statement fits all of them
      const row: Record<string, unknown> = { id: product.id };
      for (const f of SYNCABLE_FIELDS) row[f] = f in patch ? patch[f] : (product as unknown as Record<string, unknown>)[f];
      rows.push(row);
    }
  }
  for (const c of chunks(rows)) {
    must(await db(app.env).from('products').upsert(c, { onConflict: 'id' }), `product refresh ${prov.name}`);
  }
  return rows.length;
}

/** Cron: sync up to 2 providers whose interval elapsed. */
export async function syncDueProviders(app: AppCtx): Promise<void> {
  const s = await getSettings(app.env);
  if (!s.system.sync_enabled) return;
  const rows = must(await db(app.env).from('providers').select('*').eq('enabled', true), 'providers') as ProviderRow[];
  const now = Date.now();
  const due = rows
    .filter((p) => !p.rate_limited_until || new Date(p.rate_limited_until).getTime() <= now)
    .filter((p) => !p.last_sync_at || now - new Date(p.last_sync_at).getTime() >= p.sync_interval_minutes * 60_000)
    .sort((a, b) => (a.last_sync_at ? new Date(a.last_sync_at).getTime() : 0) - (b.last_sync_at ? new Date(b.last_sync_at).getTime() : 0))
    .slice(0, 2);
  for (const p of due) {
    try {
      await syncProvider(app, p.id);
    } catch (e) {
      console.error('sync failed', p.name, e);
    }
  }
}

const BALANCE_EVERY_MS = 30 * 60_000;

/** Cron: refresh provider wallet balances (every 30 min per provider) and alert once when low. */
export async function checkProviderBalances(app: AppCtx, force = false): Promise<void> {
  const rows = must(await db(app.env).from('providers').select('*').eq('enabled', true), 'providers') as ProviderRow[];
  const now = Date.now();
  const due = rows
    .filter((p) => force || !p.balance_checked_at || now - new Date(p.balance_checked_at).getTime() >= BALANCE_EVERY_MS)
    .filter((p) => !p.rate_limited_until || new Date(p.rate_limited_until).getTime() <= now)
    .slice(0, 3);
  for (const p of due) {
    try {
      const b = await getAdapter(p.kind).getBalance(await providerContext(app.env, p));
      const threshold = p.low_balance_threshold == null ? null : Number(p.low_balance_threshold);
      const low = threshold != null && b.balance_usd < threshold;
      await db(app.env).from('providers').update({
        balance: b.balance,
        balance_currency: b.currency,
        balance_checked_at: new Date().toISOString(),
        low_balance_notified: low ? true : false,
      }).eq('id', p.id);
      if (low && !p.low_balance_notified) {
        await notifyAdmins(app.env, 'low_provider_balance',
          `🪫 <b>Low balance at ${escapeHtml(p.name)}</b>: ${fmtUsd(b.balance_usd)} (threshold ${fmtUsd(threshold)}).\nTop up the provider wallet to keep orders flowing.`);
      }
    } catch (e) {
      const patch: Record<string, unknown> = { balance_checked_at: new Date().toISOString() };
      if (e instanceof ProviderError && e.status === 429) patch.rate_limited_until = new Date(now + (e.retryAfterSec ?? 300) * 1000).toISOString();
      await db(app.env).from('providers').update(patch).eq('id', p.id);
      console.error('balance check failed', p.name, (e as Error).message);
    }
  }
}
