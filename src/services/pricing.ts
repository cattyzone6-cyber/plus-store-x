import type { AppSettings } from '../lib/settings';
import type { ProductRow, ProductSourceRow, ProviderProductRow, ProviderRow, RequirementField, UserRow } from '../types';
import { applyRounding, round2, round4 } from '../lib/money';
import { userDiscountPercent } from './users';

// Pure pricing / routing logic (no I/O) so it can be unit tested.

export interface SourceOption {
  source: ProductSourceRow;
  providerProduct: ProviderProductRow | null;
  provider: ProviderRow | null;
  /** units available from this source; null = unlimited / unknown */
  available: number | null;
  /** cost per unit in USD (null = unknown) */
  unitCost: number | null;
  /** enabled, provider enabled, product present, and has stock */
  usable: boolean;
  /** why not usable (for admin display) */
  reason?: string;
}

export interface ProductPricing {
  /** price per unit the customer pays (before qty discount / promo) */
  unitPrice: number | null;
  /** "was" price for strike-through (>= unitPrice) */
  originalUnitPrice: number | null;
  salePercent: number;
  userDiscountPercent: number;
  /** reference cost used for markup */
  referenceCost: number | null;
  /** minimum margin % applied to this pack */
  minMarginPercent: number;
  /** paused by a price guard (cost jump waiting for review, manual price below margin) */
  paused: ProductRow['paused_reason'];
  /** null = unlimited, 0 = sold out */
  available: number | null;
  soldOut: boolean;
  /** usable options in routing order (first = tried first) */
  route: SourceOption[];
  /** all options including unusable ones */
  options: SourceOption[];
}

export function buildOption(
  source: ProductSourceRow,
  pp: ProviderProductRow | null,
  provider: ProviderRow | null,
  stockCount: number,
  product: ProductRow,
): SourceOption {
  if (!source.is_enabled) return { source, providerProduct: pp, provider, available: 0, unitCost: null, usable: false, reason: 'disabled' };
  if (source.kind === 'stock') {
    return { source, providerProduct: null, provider: null, available: stockCount, unitCost: product.base_cost ?? null, usable: stockCount > 0, reason: stockCount > 0 ? undefined : 'no stock' };
  }
  if (source.kind === 'manual') {
    return { source, providerProduct: null, provider: null, available: null, unitCost: product.base_cost ?? null, usable: true };
  }
  if (!pp || !provider) return { source, providerProduct: pp, provider, available: 0, unitCost: null, usable: false, reason: 'missing provider product' };
  const unitCost = pp.cost == null ? null : Number(pp.cost);
  if (!provider.enabled) return { source, providerProduct: pp, provider, available: 0, unitCost, usable: false, reason: 'provider disabled' };
  if (provider.rate_limited_until && new Date(provider.rate_limited_until).getTime() > Date.now()) {
    return { source, providerProduct: pp, provider, available: 0, unitCost, usable: false, reason: 'provider rate limited' };
  }
  if (pp.is_removed) return { source, providerProduct: pp, provider, available: 0, unitCost, usable: false, reason: 'removed by provider' };
  if (!pp.is_available || (pp.stock != null && pp.stock <= 0)) return { source, providerProduct: pp, provider, available: 0, unitCost, usable: false, reason: 'out of stock' };
  return { source, providerProduct: pp, provider, available: pp.stock == null ? null : Number(pp.stock), unitCost, usable: true };
}

export function orderRoute(options: SourceOption[], routing: ProductRow['routing']): SourceOption[] {
  const usable = options.filter((o) => o.usable);
  return usable.sort((a, b) => {
    if (routing === 'cheapest') {
      const ca = a.unitCost ?? Number.MAX_SAFE_INTEGER;
      const cb = b.unitCost ?? Number.MAX_SAFE_INTEGER;
      if (ca !== cb) return ca - cb;
    }
    return a.source.priority - b.source.priority;
  });
}

export function priceProduct(
  product: ProductRow,
  options: SourceOption[],
  s: AppSettings,
  user: Pick<UserRow, 'discount_percent' | 'total_spent'> | null,
): ProductPricing {
  const route = orderRoute(options, product.routing);

  // reference cost: first source in route, else any known cost (so sold-out items still show a price), else base_cost
  const referenceCost =
    route.find((o) => o.unitCost != null)?.unitCost ??
    options.filter((o) => o.unitCost != null).sort((a, b) => a.source.priority - b.source.priority)[0]?.unitCost ??
    product.base_cost ??
    null;

  // provider import defaults apply when the pack has no own value
  const primaryProvider = route.find((o) => o.provider)?.provider ?? options.find((o) => o.provider)?.provider ?? null;
  const minMarginPercent = Number(product.min_margin_percent ?? primaryProvider?.import_min_margin_percent ?? s.pricing.min_margin_percent ?? 0);

  // the price follows cost increases; drops only when follow_drops is on (cost_basis keeps the old cost)
  const pricingCost = referenceCost == null
    ? null
    : !s.pricing.follow_drops && product.cost_basis != null ? Math.max(referenceCost, Number(product.cost_basis)) : referenceCost;

  let base: number | null = null;
  if (product.pricing_mode === 'manual') {
    base = product.manual_price != null ? Number(product.manual_price) : null;
  } else if (pricingCost != null) {
    const pct = product.markup_percent ?? primaryProvider?.import_markup_percent ?? s.pricing.default_markup_percent;
    const fixed = product.markup_fixed ?? primaryProvider?.import_markup_fixed ?? s.pricing.default_markup_fixed;
    const marked = pricingCost * (1 + Number(pct) / 100) + Number(fixed);
    // margin guard: never below cost × (1 + minimum margin)
    base = applyRounding(Math.max(marked, pricingCost * (1 + minMarginPercent / 100)), s.pricing.rounding);
  }

  const salePercent = Math.min(Math.max(Number(product.sale_percent) || 0, 0), 95);
  const udp = userDiscountPercent(user, s.pricing.discount_levels, s.features.discount_levels);

  let unitPrice: number | null = null;
  let originalUnitPrice: number | null = null;
  if (base != null) {
    unitPrice = round2(base * (1 - salePercent / 100) * (1 - udp / 100));
    const compare = product.compare_at_price != null ? Number(product.compare_at_price) : 0;
    originalUnitPrice = Math.max(base, compare);
  }

  let available: number | null = 0;
  if (product.fulfillment === 'manual') {
    available = null;
  } else {
    for (const o of route) {
      if (o.available == null) { available = null; break; }
      available = (available ?? 0) + o.available;
    }
  }

  return {
    unitPrice,
    originalUnitPrice,
    salePercent,
    userDiscountPercent: udp,
    referenceCost,
    minMarginPercent,
    paused: product.paused_reason ?? null,
    available,
    soldOut: available === 0 || unitPrice == null || !!product.paused_reason,
    route,
    options,
  };
}

/** Quantity discount percent for a given quantity. */
export function qtyDiscountPercent(product: ProductRow, qty: number): number {
  let p = 0;
  for (const d of product.qty_discounts ?? []) if (qty >= d.min_qty) p = Math.max(p, d.percent);
  return Math.min(p, 90);
}

export interface Quote {
  quantity: number;
  unitPrice: number;
  originalUnitPrice: number;
  qtyDiscountPercent: number;
  subtotal: number;
  promoDiscount: number;
  total: number;
}

export function quote(pricing: ProductPricing, product: ProductRow, qty: number, promoDiscount = 0): Quote | null {
  if (pricing.unitPrice == null || pricing.originalUnitPrice == null) return null;
  const qd = qtyDiscountPercent(product, qty);
  const unit = round2(pricing.unitPrice * (1 - qd / 100));
  const subtotal = round2(unit * qty);
  const promo = Math.min(round2(promoDiscount), subtotal);
  return {
    quantity: qty,
    unitPrice: unit,
    originalUnitPrice: pricing.originalUnitPrice,
    qtyDiscountPercent: qd,
    subtotal,
    promoDiscount: promo,
    total: round4(Math.max(subtotal - promo, 0)),
  };
}

/**
 * Inputs the customer must provide: product.input_fields + the requirements of every
 * usable provider source (deduplicated by key). Fixed fields are not asked.
 */
export function requiredInputs(product: ProductRow, route: SourceOption[]): { ask: RequirementField[]; fixed: Record<string, string | number> } {
  const byKey = new Map<string, RequirementField>();
  const fixed: Record<string, string | number> = {};
  for (const f of product.input_fields ?? []) {
    if (f.fixed != null) fixed[f.key] = f.fixed;
    else byKey.set(f.key, f);
  }
  for (const o of route) {
    for (const f of o.providerProduct?.requirements?.fields ?? []) {
      if (f.key in fixed) continue;
      const cur = byKey.get(f.key);
      byKey.set(f.key, cur ? { ...f, ...cur, per_unit: cur.per_unit || f.per_unit } : f);
    }
  }
  return { ask: [...byKey.values()].filter((f) => f.required !== false), fixed };
}

/** Quantity constraint forced by sources (e.g. slot products allow only 1). */
export function fixedQuantity(route: SourceOption[]): number | null {
  for (const o of route) {
    const q = o.providerProduct?.requirements?.quantity_fixed;
    if (q) return q;
  }
  return null;
}
