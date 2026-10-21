import type { Env } from '../env';
import type { AppSettings } from './settings';
import type { EmojiRow } from '../types';
import { db, must } from './db';

/**
 * Emoji library. Every emoji used by the bot has a key and a plain fallback.
 * When settings.bot.premium_emoji is on (the bot's BotFather owner has Telegram Premium,
 * Bot API 9.4+), the admin can attach a custom_emoji_id to any key; it is then rendered
 * as <tg-emoji> in messages and as icon_custom_emoji_id on buttons.
 */
export const DEFAULT_EMOJIS: Record<string, string> = {
  logo: '👑',
  welcome: '👋',
  shop: '🛍️',
  category: '📂',
  product: '📦',
  freebies: '🎁',
  deposit: '💰',
  wallet: '👛',
  profile: '👤',
  orders: '📋',
  support: '✉️',
  referrals: '⭐',
  giveaways: '🎉',
  redeem: '🎟️',
  promo: '🏷️',
  language: '🌐',
  website: '🌍',
  channel: '📢',
  back: '◀️',
  home: '🏠',
  cancel: '❌',
  confirm: '✅',
  success: '✅',
  error: '⚠️',
  warning: '⚠️',
  info: 'ℹ️',
  price: '💵',
  sale: '🔥',
  duration: '🗓️',
  warranty: '🛡️',
  stock: '📊',
  sold: '📈',
  sold_out: '❌',
  delivery: '⚡',
  manual: '🧑‍💻',
  type: '🏷️',
  quantity: '🔢',
  balance: '💲',
  total: '🧾',
  binance: '🟡',
  usdt: '💎',
  shamcash: '🏦',
  key: '🔑',
  account: '📧',
  download: '📥',
  replace: '🔄',
  refund: '↩️',
  ticket: '🎫',
  points: '🪙',
  discount: '🏷️',
  link: '🔗',
  api: '🔌',
  clock: '⏳',
  join: '🌐',
  stats: '📊',
  bell: '🔔',
  gift: '🎁',
  crown: '👑',
  fire: '🔥',
  star: '⭐',
  admin: '🛠️',
};

export interface EmojiResolver {
  /** plain fallback char */
  char(key: string): string;
  /** HTML for messages (tg-emoji when premium + custom id) */
  html(key: string): string;
  /** custom emoji id for button icons, or undefined */
  iconId(key: string): string | undefined;
  premium: boolean;
}

let cache: { at: number; rows: Map<string, EmojiRow> } | null = null;
const TTL = 30_000;

export function invalidateEmojis(): void {
  cache = null;
}

async function loadRows(env: Env): Promise<Map<string, EmojiRow>> {
  if (cache && Date.now() - cache.at < TTL) return cache.rows;
  const rows = must(await db(env).from('emojis').select('*'), 'emojis') as EmojiRow[];
  const map = new Map(rows.map((r) => [r.key, r]));
  cache = { at: Date.now(), rows: map };
  return map;
}

export async function getEmojiResolver(env: Env, s: AppSettings): Promise<EmojiResolver> {
  const rows = await loadRows(env);
  const premium = !!s.bot.premium_emoji;
  const char = (key: string) => rows.get(key)?.fallback || DEFAULT_EMOJIS[key] || '';
  const id = (key: string) => (premium ? rows.get(key)?.custom_emoji_id || undefined : undefined);
  return {
    premium,
    char,
    iconId: id,
    html(key) {
      const c = char(key);
      const cid = id(key);
      return cid ? `<tg-emoji emoji-id="${cid}">${c || '⭐'}</tg-emoji>` : c;
    },
  };
}

/** Render an arbitrary custom emoji id (e.g. product.custom_emoji_id) with a fallback. */
export function customEmojiHtml(premium: boolean, customId: string | null | undefined, fallback: string | null | undefined): string {
  if (premium && customId) return `<tg-emoji emoji-id="${customId}">${fallback || '⭐'}</tg-emoji>`;
  return fallback || '';
}
