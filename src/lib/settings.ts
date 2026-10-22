import type { Env } from '../env';
import type { ButtonStyle, Lang } from '../types';
import type { Rounding } from './money';
import { db, must } from './db';
import { decrypt, encrypt } from './crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Settings are stored one row per top-level key in `settings`, merged over these
// defaults. Everything a store owner may want to change lives here so each client
// branch needs no code edits for branding / features / payments.
// ─────────────────────────────────────────────────────────────────────────────

export interface MenuButton {
  id: 'shop' | 'freebies' | 'deposit' | 'profile' | 'orders' | 'support' | 'referrals' | 'giveaways' | 'redeem' | 'language' | 'website' | 'channel';
  enabled: boolean;
  style: ButtonStyle;
  /** buttons sharing the same row number are placed side by side */
  row: number;
}

export interface ForceJoinChat {
  /** @username or numeric chat id (the bot must be an admin there) */
  chat_id: string;
  title: string;
  url: string;
}

export interface DiscountLevel {
  min_spent: number;
  percent: number;
  name_en?: string;
  name_ar?: string;
}

export interface AppSettings {
  brand: {
    name: string;
    tagline_en: string;
    tagline_ar: string;
    logo_url: string;
    bot_username: string; // without @
    channel_url: string;
    group_url: string;
    support_username: string; // without @
    website_url: string;
    order_prefix: string;
  };
  bot: {
    /** The BotFather owner of this bot has Telegram Premium → custom emoji allowed. */
    premium_emoji: boolean;
    default_lang: Lang;
    ask_lang_on_start: boolean;
    welcome_image_url: string;
    main_menu: MenuButton[];
    show_sold_out: boolean;
    category_columns: 1 | 2 | 3;
    qty_presets: number[];
    maintenance_mode: boolean;
    /** colors used for product buttons */
    in_stock_style: ButtonStyle;
    sold_out_style: ButtonStyle;
    nav_style: ButtonStyle;
    buy_style: ButtonStyle;
  };
  force_join: {
    enabled: boolean;
    chats: ForceJoinChat[];
  };
  features: {
    freebies: boolean;
    referrals: boolean;
    cashback: boolean;
    giveaways: boolean;
    discount_levels: boolean;
    redeem_codes: boolean;
    promo_codes: boolean;
    reseller_api: boolean;
    replacements: boolean;
    stock_channel_posts: boolean;
    download_txt: boolean;
  };
  pricing: {
    default_markup_percent: number;
    default_markup_fixed: number;
    rounding: Rounding;
    /** never route an order to a source whose cost is above what the customer paid */
    block_loss: boolean;
    discount_levels: DiscountLevel[];
    /** default when a product has on_failure = null */
    default_on_failure: 'next_source' | 'refund' | 'manual';
    /** what happens when every source failed */
    all_failed_action: 'refund' | 'manual';
  };
  payments: {
    min_deposit: number;
    max_deposit: number;
    deposit_presets: number[];
    deposit_expire_minutes: number;
    binance_pay: { enabled: boolean; fee_percent: number };
    binance_id: {
      enabled: boolean;
      pay_id: string;
      receiver_name: string;
      fee_percent: number;
      /** 'manual' = customer sends proof, an admin approves (no API key needed); 'auto' = matched with a read-only Binance API key */
      verify: 'manual' | 'auto';
      /** add random cents so transfers can be matched by amount */
      unique_amount: boolean;
      instructions_en: string;
      instructions_ar: string;
    };
    nowpayments: {
      enabled: boolean;
      pay_currency: string; // e.g. 'usdtbsc' (USDT BEP20)
      min_amount: number;
      fee_percent: number;
      sandbox: boolean;
    };
    shamcash: {
      enabled: boolean;
      account_name: string;
      account_number: string;
      qr_image_url: string;
      currency: 'USD' | 'SYP';
      syp_per_usd: number;
      min_amount: number;
      fee_percent: number;
      instructions_en: string;
      instructions_ar: string;
    };
  };
  referral: { percent: number };
  /** customer announcements (new products, back in stock, "notify me") */
  alerts: {
    new_products: boolean;
    restock: boolean;
    notify_me: boolean;
    /** wait this long after a product is created before announcing it (time to edit it) */
    new_delay_minutes: number;
    /** do not announce the same product as back in stock more often than this */
    restock_cooldown_hours: number;
  };
  cashback: { points_per_usd: number; usd_per_point: number; min_redeem_points: number };
  warranty: {
    auto_replace_from_stock: boolean;
    default_resolution: 'replace' | 'refund';
    allow_refund_requests: boolean;
  };
  notifications: {
    /** Telegram chat id (group or user) that receives admin alerts */
    chat_id: string;
    /** channel for "new stock" posts */
    stock_channel_id: string;
    low_stock_threshold: number;
    events: {
      new_order: boolean;
      order_failed: boolean;
      manual_order: boolean;
      deposit_paid: boolean;
      deposit_review: boolean;
      ticket: boolean;
      low_provider_balance: boolean;
      low_stock: boolean;
      catalog_changes: boolean;
      new_user: boolean;
    };
  };
  system: {
    /** 'paid' enables the Cloudflare Queue (binding JOBS must exist) and bigger batches */
    plan: 'free' | 'paid';
    public_base_url: string;
    sync_enabled: boolean;
    broadcast_batch_free: number;
    broadcast_batch_paid: number;
  };
  support: {
    hours_en: string;
    hours_ar: string;
  };
  landing: {
    enabled: boolean;
    title_en: string;
    title_ar: string;
    subtitle_en: string;
    subtitle_ar: string;
    cta_en: string;
    cta_ar: string;
    hero_image_url: string;
    accent_color: string;
    show_products: boolean;
    features: { icon: string; title_en: string; title_ar: string; text_en: string; text_ar: string }[];
    faq: { q_en: string; q_ar: string; a_en: string; a_ar: string }[];
    footer_en: string;
    footer_ar: string;
    seo_description: string;
  };
  /** text overrides: key → { en, ar } (see src/lib/i18n) */
  texts: Record<string, { en?: string; ar?: string }>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  brand: {
    name: 'Plus Store X',
    tagline_en: 'Digital Subscription Store',
    tagline_ar: 'متجر الاشتراكات الرقمية',
    logo_url: '/assets/logo.jpg',
    bot_username: '',
    channel_url: '',
    group_url: '',
    support_username: '',
    website_url: '',
    order_prefix: 'PSX',
  },
  bot: {
    premium_emoji: false,
    default_lang: 'en',
    ask_lang_on_start: true,
    welcome_image_url: '',
    main_menu: [
      { id: 'shop', enabled: true, style: 'primary', row: 1 },
      { id: 'freebies', enabled: true, style: 'primary', row: 2 },
      { id: 'deposit', enabled: true, style: 'primary', row: 3 },
      { id: 'profile', enabled: true, style: 'primary', row: 3 },
      { id: 'orders', enabled: true, style: 'default', row: 4 },
      { id: 'giveaways', enabled: true, style: 'default', row: 4 },
      { id: 'support', enabled: true, style: 'success', row: 5 },
      { id: 'referrals', enabled: true, style: 'default', row: 6 },
      { id: 'language', enabled: true, style: 'default', row: 6 },
    ],
    show_sold_out: true,
    category_columns: 2,
    qty_presets: [1, 2, 3, 5, 10, 15, 20, 25],
    maintenance_mode: false,
    in_stock_style: 'success',
    sold_out_style: 'danger',
    nav_style: 'default',
    buy_style: 'success',
  },
  force_join: { enabled: false, chats: [] },
  features: {
    freebies: true,
    referrals: true,
    cashback: true,
    giveaways: true,
    discount_levels: true,
    redeem_codes: true,
    promo_codes: true,
    reseller_api: false,
    replacements: true,
    stock_channel_posts: false,
    download_txt: true,
  },
  pricing: {
    default_markup_percent: 20,
    default_markup_fixed: 0,
    rounding: '0.01',
    block_loss: true,
    discount_levels: [],
    default_on_failure: 'next_source',
    all_failed_action: 'refund',
  },
  payments: {
    min_deposit: 1,
    max_deposit: 5000,
    deposit_presets: [5, 10, 25, 50, 100],
    deposit_expire_minutes: 60,
    binance_pay: { enabled: false, fee_percent: 0 },
    binance_id: {
      enabled: false,
      pay_id: '',
      receiver_name: '',
      fee_percent: 0,
      verify: 'manual',
      unique_amount: true,
      instructions_en: '',
      instructions_ar: '',
    },
    nowpayments: { enabled: false, pay_currency: 'usdtbsc', min_amount: 5, fee_percent: 0, sandbox: false },
    shamcash: {
      enabled: false,
      account_name: '',
      account_number: '',
      qr_image_url: '',
      currency: 'USD',
      syp_per_usd: 0,
      min_amount: 1,
      fee_percent: 0,
      instructions_en: '',
      instructions_ar: '',
    },
  },
  referral: { percent: 5 },
  alerts: { new_products: true, restock: true, notify_me: true, new_delay_minutes: 10, restock_cooldown_hours: 12 },
  cashback: { points_per_usd: 10, usd_per_point: 0.01, min_redeem_points: 100 },
  warranty: { auto_replace_from_stock: false, default_resolution: 'replace', allow_refund_requests: true },
  notifications: {
    chat_id: '',
    stock_channel_id: '',
    low_stock_threshold: 3,
    events: {
      new_order: true,
      order_failed: true,
      manual_order: true,
      deposit_paid: true,
      deposit_review: true,
      ticket: true,
      low_provider_balance: true,
      low_stock: true,
      catalog_changes: true,
      new_user: false,
    },
  },
  system: {
    plan: 'free',
    public_base_url: '',
    sync_enabled: true,
    broadcast_batch_free: 25,
    broadcast_batch_paid: 400,
  },
  support: { hours_en: '', hours_ar: '' },
  landing: {
    enabled: true,
    title_en: 'Premium digital subscriptions, delivered instantly',
    title_ar: 'اشتراكات رقمية مميزة، تسليم فوري',
    subtitle_en: 'AI tools, streaming, design, VPN and more — at the best prices, straight in Telegram.',
    subtitle_ar: 'أدوات الذكاء الاصطناعي، البث، التصميم، VPN والمزيد — بأفضل الأسعار وداخل تيليجرام.',
    cta_en: 'Open the store',
    cta_ar: 'افتح المتجر',
    hero_image_url: '',
    accent_color: '#F5B301',
    show_products: true,
    features: [
      { icon: '⚡', title_en: 'Instant delivery', title_ar: 'تسليم فوري', text_en: 'Most products are delivered automatically seconds after payment.', text_ar: 'معظم المنتجات تُسلَّم تلقائياً خلال ثوانٍ من الدفع.' },
      { icon: '🛡️', title_en: 'Warranty', title_ar: 'ضمان', text_en: 'Replacement or refund during the warranty period.', text_ar: 'استبدال أو استرداد خلال فترة الضمان.' },
      { icon: '💳', title_en: 'Easy payments', title_ar: 'دفع سهل', text_en: 'Binance, USDT (BEP20) and ShamCash.', text_ar: 'بينانس، USDT (BEP20) وشام كاش.' },
      { icon: '💬', title_en: 'Real support', title_ar: 'دعم حقيقي', text_en: 'Talk to a human whenever you need help.', text_ar: 'تواصل مع فريق الدعم متى احتجت.' },
    ],
    faq: [
      { q_en: 'How do I buy?', q_ar: 'كيف أشتري؟', a_en: 'Open the bot, top up your wallet and pick a product.', a_ar: 'افتح البوت، اشحن محفظتك واختر المنتج.' },
    ],
    footer_en: '',
    footer_ar: '',
    seo_description: 'Digital subscription store on Telegram',
  },
  texts: {},
};

export type SettingsKey = keyof AppSettings;
export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge: objects merge recursively, arrays and scalars from `over` replace `base`. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    const b = (base as Record<string, unknown>)[k];
    out[k] = isPlainObject(b) && isPlainObject(v) ? deepMerge(b, v) : v;
  }
  return out as T;
}

// Per-isolate cache. Admin writes call invalidateSettings(); other isolates refresh within TTL.
let cached: { at: number; value: AppSettings } | null = null;
const TTL_MS = 20_000;

export async function getSettings(env: Env, fresh = false): Promise<AppSettings> {
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const rows = must(await db(env).from('settings').select('key,value'), 'settings') as { key: string; value: unknown }[];
  let value: AppSettings = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    if (r.key in value) {
      (value as unknown as Record<string, unknown>)[r.key] = deepMerge((value as unknown as Record<string, unknown>)[r.key], r.value);
    }
  }
  cached = { at: Date.now(), value };
  return value;
}

export function invalidateSettings(): void {
  cached = null;
}

/** Replace one top-level settings section (merged over defaults when read). */
export async function saveSettingsSection<K extends SettingsKey>(env: Env, key: K, value: Partial<AppSettings[K]>): Promise<void> {
  must(await db(env).from('settings').upsert({ key, value, updated_at: new Date().toISOString() }), 'settings upsert');
  invalidateSettings();
}

// ─────────────────────────────────────────────────────────────────────────────
// Encrypted secrets (payment gateway keys etc.)
// ─────────────────────────────────────────────────────────────────────────────

export const SECRET_KEYS = [
  'binance_pay_api_key',
  'binance_pay_secret_key',
  'binance_api_key',
  'binance_api_secret',
  'nowpayments_api_key',
  'nowpayments_ipn_secret',
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

const secretCache = new Map<string, { at: number; value: string | null }>();

export async function getSecret(env: Env, key: SecretKey): Promise<string | null> {
  const c = secretCache.get(key);
  if (c && Date.now() - c.at < TTL_MS) return c.value;
  const row = must(await db(env).from('secrets').select('value_enc').eq('key', key).maybeSingle(), 'secret') as { value_enc: string } | null;
  const value = row ? await decrypt(row.value_enc, env.ENCRYPTION_KEY) : null;
  secretCache.set(key, { at: Date.now(), value });
  return value;
}

export async function setSecret(env: Env, key: SecretKey, value: string | null): Promise<void> {
  if (!value) {
    must(await db(env).from('secrets').delete().eq('key', key), 'secret delete');
  } else {
    const value_enc = await encrypt(value, env.ENCRYPTION_KEY);
    must(await db(env).from('secrets').upsert({ key, value_enc, updated_at: new Date().toISOString() }), 'secret upsert');
  }
  secretCache.delete(key);
}

/** Base URL of this deployment (for webhooks / links). */
export function baseUrl(s: AppSettings, req?: Request): string {
  if (s.system.public_base_url) return s.system.public_base_url.replace(/\/+$/, '');
  if (req) return new URL(req.url).origin;
  return '';
}
