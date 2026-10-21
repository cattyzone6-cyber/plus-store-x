import type { AppSettings, MenuButton } from '../lib/settings';
import type { EmojiResolver } from '../lib/emoji';
import type { Lang, OrderRow, OrderStatus } from '../types';
import { t } from '../lib/i18n';
import { fmtUsd } from '../lib/money';
import { button, type InlineButton, type InlineKeyboard } from '../lib/telegram';
import type { BotContext } from './context';
import { tr } from './context';

/** Telegram limits callback_data to 64 bytes. */
export const MAX_CALLBACK_BYTES = 64;
export function cb(...parts: (string | number)[]): string {
  const data = parts.join(':');
  if (new TextEncoder().encode(data).length > MAX_CALLBACK_BYTES) throw new Error(`callback_data too long: ${data}`);
  return data;
}

/** Callback data opened by each main menu button (url buttons have none). */
export const MENU_CALLBACK: Partial<Record<MenuButton['id'], string>> = {
  shop: 'shop',
  freebies: 'fr',
  deposit: 'dep',
  profile: 'prof',
  orders: 'orders:0',
  support: 'sup',
  referrals: 'ref',
  giveaways: 'gw',
  redeem: 'redeem',
  language: 'lang',
};

/** Is a main-menu entry available with the current settings? */
export function menuItemAvailable(s: AppSettings, id: MenuButton['id']): boolean {
  switch (id) {
    case 'freebies': return s.features.freebies;
    case 'referrals': return s.features.referrals;
    case 'giveaways': return s.features.giveaways;
    case 'redeem': return s.features.redeem_codes;
    case 'website': return !!s.brand.website_url;
    case 'channel': return !!s.brand.channel_url;
    default: return true;
  }
}

export function visibleMenu(s: AppSettings): MenuButton[] {
  return s.bot.main_menu.filter((m) => m.enabled && menuItemAvailable(s, m.id));
}

/** Main menu keyboard: buttons with the same `row` number are placed side by side. */
export function buildMainMenu(s: AppSettings, em: EmojiResolver | undefined, lang: Lang): InlineKeyboard {
  const rows = new Map<number, InlineButton[]>();
  for (const m of visibleMenu(s)) {
    const text = t(s, lang, `btn_${m.id}`);
    const b =
      m.id === 'website' ? button({ text, emoji: 'website', style: m.style, url: s.brand.website_url }, em)
      : m.id === 'channel' ? button({ text, emoji: 'channel', style: m.style, url: s.brand.channel_url }, em)
      : button({ text, emoji: m.id, style: m.style, data: MENU_CALLBACK[m.id] }, em);
    const list = rows.get(m.row) ?? [];
    list.push(b);
    rows.set(m.row, list);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

export function homeRow(ctx: BotContext): InlineButton[] {
  return [button({ text: tr(ctx, 'btn_home'), emoji: 'home', data: 'home', style: ctx.st.s.bot.nav_style }, ctx.st.em)];
}

export function backHomeRow(ctx: BotContext, backData: string): InlineButton[] {
  const style = ctx.st.s.bot.nav_style;
  return [
    button({ text: tr(ctx, 'btn_back'), emoji: 'back', data: backData, style }, ctx.st.em),
    button({ text: tr(ctx, 'btn_home'), emoji: 'home', data: 'home', style }, ctx.st.em),
  ];
}

export function btn(ctx: BotContext, key: string, data: string, emoji?: string, style?: InlineButton['style'] | 'default', vars: Record<string, unknown> = {}): InlineButton {
  return button({ text: tr(ctx, key, vars), emoji, data, style: style ?? null }, ctx.st.em);
}

/** "<s>$13.50</s> <b>$12.83</b>" when discounted, "<b>$12.83</b>" otherwise. */
export function priceHtml(price: number, original?: number | null): string {
  if (original != null && original - price > 0.004) return `<s>${fmtUsd(original)}</s> <b>${fmtUsd(price)}</b>`;
  return `<b>${fmtUsd(price)}</b>`;
}

/** Plain button text price: "$2.00 → $1.90" or "$2.00" */
export function priceText(price: number, original?: number | null): string {
  if (original != null && original - price > 0.004) return `${fmtUsd(original)} → ${fmtUsd(price)}`;
  return fmtUsd(price);
}

export function discountPercent(price: number, original?: number | null): number {
  if (original == null || original <= 0 || original - price <= 0.004) return 0;
  return Math.round((1 - price / original) * 100);
}

export const STATUS_EMOJI: Record<OrderStatus, string> = {
  pending_payment: '🕓',
  paid: '💳',
  processing: '⏳',
  awaiting_provider: '⏳',
  manual_pending: '🧑‍💻',
  delivered: '✅',
  partially_delivered: '🟡',
  failed: '⚠️',
  refunded: '↩️',
  partially_refunded: '↩️',
  cancelled: '✖️',
};

export function statusLabel(ctx: BotContext, status: OrderStatus): string {
  return `${STATUS_EMOJI[status]} ${tr(ctx, `status_${status}`)}`;
}

export function fmtDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

/** Localized column: loc(row, 'name', 'ar') → row.name_ar || row.name_en (accepts interfaces). */
export function loc(row: object, field: string, lang: Lang): string {
  const r = row as Record<string, unknown>;
  const v = r[`${field}_${lang}`];
  if (typeof v === 'string' && v.trim()) return v;
  const e = r[`${field}_en`];
  return typeof e === 'string' ? e : '';
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function isActiveOrderForWarranty(o: OrderRow): boolean {
  return (o.status === 'delivered' || o.status === 'partially_delivered') && !!o.warranty_until && new Date(o.warranty_until).getTime() > Date.now();
}

/** Split long HTML text into chunks on line boundaries. */
export function chunkLines(lines: string[], max = 3800): string[] {
  const out: string[] = [];
  let cur = '';
  for (const l of lines) {
    if (cur.length + l.length + 1 > max && cur) {
      out.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) out.push(cur);
  return out;
}
