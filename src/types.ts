// Row types mirroring supabase/migrations/*.sql. Numeric columns arrive as numbers from PostgREST.

export type Lang = 'en' | 'ar';
export type ButtonStyle = 'default' | 'primary' | 'success' | 'danger';

export interface UserRow {
  id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  lang: Lang;
  lang_chosen: boolean;
  balance: number;
  points: number;
  referrer_id: number | null;
  referral_earned: number;
  referrals_count: number;
  discount_percent: number;
  total_spent: number;
  total_deposited: number;
  orders_count: number;
  is_banned: boolean;
  ban_reason: string | null;
  blocked_bot: boolean;
  joined_verified: boolean;
  alerts_opt_in: boolean;
  state: UserState | null;
  note: string | null;
  joined_at: string;
  last_seen_at: string;
}

/** Conversation state stored on the user row (what the bot is waiting for). */
export interface UserState {
  kind: string; // e.g. 'await_qty', 'await_input', 'await_promo', 'await_deposit_amount', 'await_proof', ...
  data?: Record<string, unknown>;
  at?: number; // epoch ms
}

export interface AdminRow {
  user_id: string;
  email: string;
  role: 'owner' | 'support';
  telegram_id: number | null;
  display_name: string | null;
  created_at: string;
}

export interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  credentials_enc: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_sync_stats: Record<string, unknown> | null;
  balance: number | null;
  balance_currency: string | null;
  balance_checked_at: string | null;
  low_balance_threshold: number | null;
  low_balance_notified: boolean;
  rate_limited_until: string | null;
  sort: number;
  created_at: string;
}

export type DeliveryKind = 'instant' | 'async' | 'activation';

export interface RequirementField {
  key: 'email' | 'account' | 'identifier' | 'months' | string;
  per_unit?: boolean;
  required?: boolean;
  options?: (number | string)[];
  label_en?: string;
  label_ar?: string;
  /** when set, the customer is not asked: this value is always sent (e.g. months = 3) */
  fixed?: string | number;
}

export interface Requirements {
  fields?: RequirementField[];
  quantity_fixed?: number;
}

export interface ProviderProductRow {
  id: string;
  provider_id: string;
  external_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  emoji: string | null;
  delivery_kind: DeliveryKind;
  raw_type: string | null;
  cost: number | null;
  cost_original: number | null;
  cost_currency: string;
  stock: number | null;
  sold: number | null;
  warranty_days: number | null;
  requirements: Requirements;
  price_tiers: { min_qty: number; max_qty?: number | null; price: number }[] | null;
  promotions: unknown[] | null;
  raw: unknown;
  content_hash: string | null;
  is_available: boolean;
  is_removed: boolean;
  is_new: boolean;
  first_seen_at: string;
  last_seen_at: string;
  last_changed_at: string;
  removed_at: string | null;
}

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name_en: string;
  name_ar: string | null;
  description_en: string | null;
  description_ar: string | null;
  emoji: string | null;
  custom_emoji_id: string | null;
  image_url: string | null;
  button_style: ButtonStyle;
  sort: number;
  is_active: boolean;
  created_at: string;
}

export interface ProductRow {
  id: string;
  category_id: string | null;
  name_en: string;
  name_ar: string | null;
  description_en: string | null;
  description_ar: string | null;
  emoji: string | null;
  custom_emoji_id: string | null;
  image_url: string | null;
  duration_en: string | null;
  duration_ar: string | null;
  warranty_days: number;
  fulfillment: 'auto' | 'manual';
  pricing_mode: 'markup' | 'manual';
  markup_percent: number | null;
  markup_fixed: number | null;
  manual_price: number | null;
  base_cost: number | null;
  compare_at_price: number | null;
  sale_percent: number;
  qty_discounts: { min_qty: number; percent: number }[];
  routing: 'priority' | 'cheapest';
  on_failure: 'next_source' | 'refund' | 'manual' | null;
  input_fields: RequirementField[];
  min_qty: number;
  max_qty: number;
  qty_presets: number[] | null;
  button_style: ButtonStyle | null;
  is_active: boolean;
  is_featured: boolean;
  sort: number;
  auto_sync_info: boolean;
  locked_fields: string[];
  sold_count: number;
  delivery_note_en: string | null;
  delivery_note_ar: string | null;
  announced_at: string | null;
  restocked_at: string | null;
  last_restock_alert_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductSourceRow {
  id: string;
  product_id: string;
  kind: 'provider' | 'stock' | 'manual';
  provider_product_id: string | null;
  priority: number;
  is_enabled: boolean;
  created_at: string;
}

export interface StockItemRow {
  id: string;
  product_id: string;
  content: string;
  status: 'available' | 'sold' | 'reserved' | 'invalid';
  order_id: number | null;
  batch: string | null;
  created_by: string | null;
  created_at: string;
  sold_at: string | null;
}

export type OrderStatus =
  | 'pending_payment' | 'paid' | 'processing' | 'awaiting_provider' | 'manual_pending'
  | 'delivered' | 'partially_delivered' | 'failed' | 'refunded' | 'partially_refunded' | 'cancelled';

export interface OrderRow {
  id: number;
  code: string;
  user_id: number;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  original_unit_price: number;
  subtotal: number;
  discount_amount: number;
  total: number;
  promo_code_id: string | null;
  promo_code: string | null;
  user_discount_percent: number;
  status: OrderStatus;
  payment_method: string | null;
  inputs: Record<string, unknown>;
  source_id: string | null;
  provider_id: string | null;
  provider_product_id: string | null;
  provider_order_ref: string | null;
  provider_status: string | null;
  cost_total: number | null;
  delivery: string[];
  delivered_qty: number;
  refunded_amount: number;
  points_awarded: number;
  warranty_days: number;
  warranty_until: string | null;
  idempotency_key: string | null;
  channel: 'bot' | 'api';
  attempts: number;
  next_check_at: string | null;
  error: string | null;
  admin_note: string | null;
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
  updated_at: string;
}

export type DepositMethod = 'binance_pay' | 'binance_id' | 'nowpayments' | 'shamcash' | 'admin';
export type DepositStatus = 'pending' | 'confirming' | 'paid' | 'expired' | 'rejected' | 'cancelled' | 'failed';

export interface DepositRow {
  id: string;
  user_id: number;
  method: DepositMethod;
  amount_usd: number;
  fee_usd: number;
  pay_amount: number | null;
  pay_currency: string | null;
  credited_amount: number | null;
  status: DepositStatus;
  external_id: string | null;
  reference: string | null;
  pay_address: string | null;
  pay_url: string | null;
  qr_url: string | null;
  proof_file_id: string | null;
  proof_text: string | null;
  order_id: number | null;
  meta: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
  paid_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
}

export interface PromoCodeRow {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  scope: 'all' | 'category' | 'product';
  target_ids: string[];
  min_order: number;
  max_uses: number | null;
  per_user_limit: number;
  uses: number;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string;
}

export interface TicketRow {
  id: number;
  user_id: number;
  order_id: number | null;
  kind: 'replacement' | 'refund' | 'support';
  message: string | null;
  attachment_id: string | null;
  status: 'open' | 'approved' | 'rejected' | 'resolved';
  resolution: 'replaced' | 'refunded' | 'rejected' | 'answered' | null;
  resolution_note: string | null;
  refund_amount: number | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface EmojiRow {
  key: string;
  custom_emoji_id: string | null;
  fallback: string;
  label: string | null;
  updated_at: string;
}

export interface GiveawayRow {
  id: string;
  title_en: string;
  title_ar: string | null;
  description_en: string | null;
  description_ar: string | null;
  prize_type: 'balance' | 'text';
  prize_amount: number | null;
  prize_text: string | null;
  winners_count: number;
  min_spent: number;
  ends_at: string;
  status: 'active' | 'ended' | 'cancelled';
  created_at: string;
}

export interface FreebieRow {
  id: string;
  title_en: string;
  title_ar: string | null;
  content_en: string;
  content_ar: string | null;
  is_active: boolean;
  sort: number;
  claims: number;
  created_at: string;
}

export interface BroadcastRow {
  id: string;
  text_en: string;
  text_ar: string | null;
  image_url: string | null;
  buttons: { text: string; url: string }[];
  target: 'all' | 'lang_en' | 'lang_ar' | 'buyers' | 'non_buyers' | 'alerts';
  auto: boolean;
  status: 'draft' | 'queued' | 'sending' | 'done' | 'cancelled';
  cursor_id: number;
  sent: number;
  failed: number;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
