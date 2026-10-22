import type { Env } from '../env';
import type { ProductRow, ProductSourceRow, ProviderRow } from '../types';
import type { AppSettings } from '../lib/settings';
import { db, must } from '../lib/db';

// Price guards, evaluated after each provider sync for the packs whose PRIMARY source is
// that provider:
//  - cost_basis: the cost the price is built on. It follows increases; it follows drops
//    only when settings.pricing.follow_drops is on.
//  - cost jump above max_jump_percent → pack paused ('cost_jump') with pending_cost until
//    the owner accepts it (acceptPendingCost).
//  - manual price below cost × (1 + minimum margin) → paused ('below_margin'); resumes by
//    itself once the price or cost makes the margin OK again.

export interface GuardReport {
  jumps: { name: string; from: number; to: number }[];
  belowMargin: string[];
  resumed: string[];
}

export async function applyPriceGuards(
  env: Env,
  s: AppSettings,
  prov: ProviderRow,
  products: ProductRow[],
  sources: ProductSourceRow[],
  costByPp: Map<string, number>,
): Promise<GuardReport> {
  const report: GuardReport = { jumps: [], belowMargin: [], resumed: [] };
  const maxJump = Number(prov.max_jump_percent ?? s.pricing.max_jump_percent ?? 30);
  const rows: Pick<ProductRow, 'id' | 'name_en' | 'cost_basis' | 'paused_reason' | 'pending_cost'>[] = [];

  for (const p of products) {
    const primary = sources
      .filter((x) => x.product_id === p.id && x.kind === 'provider' && x.is_enabled)
      .sort((a, b) => a.priority - b.priority)[0];
    const cost = primary?.provider_product_id ? costByPp.get(primary.provider_product_id) : undefined;
    if (cost == null || !(cost > 0)) continue; // primary belongs to another provider / unknown cost

    let basis = p.cost_basis != null ? Number(p.cost_basis) : null;
    let paused = p.paused_reason;
    let pending = p.pending_cost != null ? Number(p.pending_cost) : null;

    if (basis == null) basis = cost;
    else if (cost > basis) {
      if ((cost - basis) / basis * 100 > maxJump) {
        if (paused !== 'cost_jump' || pending !== cost) report.jumps.push({ name: p.name_en, from: basis, to: cost });
        paused = 'cost_jump';
        pending = cost;
      } else {
        basis = cost;
        if (paused === 'cost_jump') { paused = null; pending = null; }
      }
    } else if (cost < basis) {
      if (s.pricing.follow_drops) basis = cost;
      if (paused === 'cost_jump') { paused = null; pending = null; } // the jump went away
    }

    if (p.pricing_mode === 'manual' && p.manual_price != null && paused !== 'cost_jump') {
      const minMargin = Number(p.min_margin_percent ?? prov.import_min_margin_percent ?? s.pricing.min_margin_percent ?? 0);
      const ok = Number(p.manual_price) >= cost * (1 + minMargin / 100) - 0.0001;
      if (!ok && paused !== 'below_margin') { paused = 'below_margin'; report.belowMargin.push(p.name_en); }
      if (ok && paused === 'below_margin') { paused = null; report.resumed.push(p.name_en); }
    }

    const changed = basis !== (p.cost_basis != null ? Number(p.cost_basis) : null) || paused !== p.paused_reason || pending !== (p.pending_cost != null ? Number(p.pending_cost) : null);
    if (changed) rows.push({ id: p.id, name_en: p.name_en, cost_basis: basis, paused_reason: paused, pending_cost: pending });
  }

  // one bulk upsert (rows carry name_en so the NOT NULL column is satisfied)
  for (let i = 0; i < rows.length; i += 200) {
    must(await db(env).from('products').upsert(rows.slice(i, i + 200), { onConflict: 'id' }), 'price guards');
  }
  return report;
}

/** Owner accepts the new provider cost of a pack paused by a cost jump. */
export async function acceptPendingCost(env: Env, productId: string): Promise<ProductRow> {
  const p = must(await db(env).from('products').select('*').eq('id', productId).single(), 'product') as ProductRow;
  return must(
    await db(env).from('products').update({
      cost_basis: p.pending_cost ?? p.cost_basis,
      pending_cost: null,
      paused_reason: p.paused_reason === 'cost_jump' ? null : p.paused_reason,
    }).eq('id', productId).select('*').single(),
    'accept cost',
  ) as ProductRow;
}
