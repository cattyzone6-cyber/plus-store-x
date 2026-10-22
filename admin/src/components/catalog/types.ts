// Catalog v2: Category → Product (product_groups) → Packs (products rows, full names).

export interface CatalogCategory {
  id: string; parent_id: string | null; name_en: string; name_ar: string | null; emoji: string | null;
  image_url: string | null; button_style: string; sort: number; is_active: boolean;
  products: { total: number; active: number };
}

export interface Group {
  id: string; category_id: string | null; name_en: string; name_ar: string | null;
  description_en: string | null; description_ar: string | null; emoji: string | null; custom_emoji_id: string | null;
  image_url: string | null; button_style: string | null; sort: number; is_active: boolean; is_featured: boolean;
  /** counts from GET /groups */
  packs?: number; active_packs?: number; in_stock?: number; paused?: number; from_price?: number | null;
}

export interface Pack {
  id: string; name_en: string; name_ar: string | null; emoji: string | null; category_id: string | null;
  group_id: string | null; group_name: string | null; is_active: boolean; is_featured: boolean; pinned: boolean; sort: number;
  fulfillment: string; pricing_mode: string; paused_reason: 'cost_jump' | 'below_margin' | null; pending_cost: number | null;
  cost_basis: number | null; price: number | null; original_price: number | null; reference_cost: number | null;
  available: number | null; sold_out: boolean; sold_count: number;
  sources: { kind: string; usable: boolean; provider: string | null }[];
}

/** Query prefixes refreshed after any catalog change. */
export const CATALOG_INVALIDATE = ['/groups', '/products', '/categories', '/dashboard'];
