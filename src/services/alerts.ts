import type { AppCtx, Env } from '../env';
import type { Lang, ProductRow, UserRow } from '../types';
import { getSettings, type AppSettings } from '../lib/settings';
import { db, must } from '../lib/db';
import { getEmojiResolver, customEmojiHtml, type EmojiResolver } from '../lib/emoji';
import { t, raw } from '../lib/i18n';
import { fmtUsd } from '../lib/money';
import { enqueue } from '../lib/jobs';
import { sendMessage, tg, TelegramError, type InlineKeyboard } from '../lib/telegram';
import { viewProducts, type ProductView } from './catalog';
import { markBlocked } from './users';

// Customer announcements. Sync and stock uploads only mark products (restocked_at);
// this cron step decides what to announce, so every source of stock behaves the same:
//  - new product   : active, in stock, created ≥ new_delay_minutes ago, never announced
//  - back in stock : restocked_at newer than the last restock announcement, outside the cooldown
//  - notify me     : personal message to everyone who asked for a sold-out product
// Announcements go out as an automatic broadcast to customers with alerts_opt_in (batched,
// so Telegram limits are respected) and, when enabled, to the store channel.

const MAX_PER_DIGEST = 10;
const MAX_NOTIFY_PER_TICK = 30;

/** Called when products may have come back in stock (provider sync, stock upload). */
export async function markRestocked(env: Env, productIds: string[]): Promise<void> {
  if (!productIds.length) return;
  await db(env).from('products').update({ restocked_at: new Date().toISOString() }).in('id', productIds);
}

/** Cron step. */
export async function runAlerts(app: AppCtx): Promise<void> {
  const s = await getSettings(app.env);
  const announcedNow = await announceNew(app, s);
  await announceRestocks(app, s, announcedNow);
  await sendNotifyMe(app, s);
}

function inStock(v: ProductView): boolean {
  return v.product.is_active && !v.pricing.soldOut && v.pricing.unitPrice != null;
}

async function announceNew(app: AppCtx, s: AppSettings): Promise<Set<string>> {
  const { env } = app;
  const cutoff = new Date(Date.now() - s.alerts.new_delay_minutes * 60_000).toISOString();
  const rows = must(
    await db(env).from('products').select('*').is('announced_at', null).eq('is_active', true).lt('created_at', cutoff).order('created_at').limit(40),
    'alerts new',
  ) as ProductRow[];
  if (!rows.length) return new Set();

  const ready = (await viewProducts(env, s, rows, null)).filter(inStock);
  // feature off → mark everything seen, so turning it on later does not flood customers
  const mark = s.alerts.new_products ? ready.slice(0, MAX_PER_DIGEST).map((v) => v.product.id) : rows.map((r) => r.id);
  if (mark.length) await db(env).from('products').update({ announced_at: new Date().toISOString() }).in('id', mark);
  if (!s.alerts.new_products || !ready.length) return new Set(mark);

  await publish(app, s, 'new', ready.slice(0, MAX_PER_DIGEST));
  return new Set(mark);
}

async function announceRestocks(app: AppCtx, s: AppSettings, skip: Set<string>): Promise<void> {
  const { env } = app;
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const rows = must(
    await db(env).from('products').select('*').not('restocked_at', 'is', null).gt('restocked_at', weekAgo).eq('is_active', true).limit(50),
    'alerts restock',
  ) as ProductRow[];
  const cooldownMs = s.alerts.restock_cooldown_hours * 3600_000;
  const due = rows.filter((p) => {
    if (skip.has(p.id) || !p.announced_at) return false; // never announced as new yet → the "new" path handles it
    const last = p.last_restock_alert_at ? new Date(p.last_restock_alert_at).getTime() : 0;
    return new Date(p.restocked_at!).getTime() > last && Date.now() - last >= cooldownMs;
  });
  if (!due.length) return;

  const ready = (await viewProducts(env, s, due, null)).filter(inStock).slice(0, MAX_PER_DIGEST);
  // close the restock mark either way (sold out again → nothing to announce)
  await db(env).from('products').update({ last_restock_alert_at: new Date().toISOString() }).in('id', due.map((p) => p.id));
  if (s.alerts.restock && ready.length) await publish(app, s, 'restock', ready);
}

async function botUsername(env: Env, s: AppSettings): Promise<string> {
  if (s.brand.bot_username) return s.brand.bot_username;
  const me = await tg<{ username: string }>(env, 'getMe').catch(() => null);
  return me?.username ?? '';
}

function digestHtml(s: AppSettings, lang: Lang, kind: 'new' | 'restock', views: ProductView[], em: EmojiResolver): string {
  const lines = views.map((v) => t(s, lang, 'alert_line', {
    emoji: raw(customEmojiHtml(em.premium, v.product.custom_emoji_id, v.product.emoji) || em.html('product')),
    name: (lang === 'ar' && v.product.name_ar) || v.product.name_en,
    price: fmtUsd(v.pricing.unitPrice),
  }, em));
  return t(s, lang, kind === 'new' ? 'alert_new_products' : 'alert_back_in_stock', { lines: raw(lines.join('\n')) }, em);
}

function digestButtons(views: ProductView[], username: string, s: AppSettings): { text: string; url: string }[] {
  if (!username) return [];
  if (views.length <= 3) {
    return views.map((v) => ({ text: `🛒 ${v.product.name_en.slice(0, 50)}`, url: `https://t.me/${username}?start=p_${v.product.id}` }));
  }
  // one broadcast serves both languages, so the shared button is bilingual
  return [{ text: `🛒 ${t(s, 'en', 'btn_open_shop')} · ${t(s, 'ar', 'btn_open_shop')}`, url: `https://t.me/${username}` }];
}

/** Queue the announcement for opted-in customers and post it to the channel. */
async function publish(app: AppCtx, s: AppSettings, kind: 'new' | 'restock', views: ProductView[]): Promise<void> {
  const { env } = app;
  const em = await getEmojiResolver(env, s);
  const username = await botUsername(env, s);
  const textEn = digestHtml(s, 'en', kind, views, em);
  const textAr = digestHtml(s, 'ar', kind, views, em);

  const row = must(await db(env).from('broadcasts').insert({
    text_en: textEn,
    text_ar: textAr,
    buttons: digestButtons(views, username, s),
    target: 'alerts',
    status: 'queued',
    auto: true,
    started_at: new Date().toISOString(),
  }).select('id').single(), 'alert broadcast') as { id: string };
  if (s.system.plan === 'paid' && env.JOBS) await enqueue(app, { type: 'broadcast', broadcastId: row.id });
  // free plan: continueBroadcasts() picks it up on the next cron tick

  if (s.features.stock_channel_posts && s.notifications.stock_channel_id) {
    const keyboard: InlineKeyboard = digestButtons(views, username, s).map((b) => [{ ...b, style: 'success' as const }]);
    await sendMessage(env, s.notifications.stock_channel_id, `${textEn}\n\n${textAr}`, { keyboard }).catch((e) => console.error('channel alert failed', e));
  }
}

/** Personal "it's back" messages for customers who tapped "Notify me". */
async function sendNotifyMe(app: AppCtx, s: AppSettings): Promise<void> {
  if (!s.alerts.notify_me) return;
  const { env } = app;
  const pending = must(await db(env).from('stock_alerts').select('product_id').order('created_at').limit(200), 'stock alerts') as { product_id: string }[];
  const ids = [...new Set(pending.map((p) => p.product_id))].slice(0, 10);
  if (!ids.length) return;
  const products = must(await db(env).from('products').select('*').in('id', ids), 'alert products') as ProductRow[];
  const ready = (await viewProducts(env, s, products, null)).filter(inStock);
  if (!ready.length) return;
  const em = await getEmojiResolver(env, s);

  let budget = MAX_NOTIFY_PER_TICK;
  for (const v of ready) {
    if (budget <= 0) break;
    const subs = must(
      await db(env).from('stock_alerts').select('user_id, users!inner(id,lang,blocked_bot,is_banned)').eq('product_id', v.product.id).limit(budget),
      'alert subscribers',
    ) as unknown as { user_id: number; users: Pick<UserRow, 'id' | 'lang' | 'blocked_bot' | 'is_banned'> }[];
    const done: number[] = [];
    for (const sub of subs) {
      done.push(sub.user_id);
      if (sub.users.blocked_bot || sub.users.is_banned) continue;
      const lang = sub.users.lang;
      const html = t(s, lang, 'alert_notify_me', {
        emoji: raw(customEmojiHtml(em.premium, v.product.custom_emoji_id, v.product.emoji) || em.html('product')),
        name: (lang === 'ar' && v.product.name_ar) || v.product.name_en,
        price: fmtUsd(v.pricing.unitPrice),
      }, em);
      const keyboard: InlineKeyboard = [[{ text: t(s, lang, 'btn_buy_now'), callback_data: `p:${v.product.id}`, style: 'success' }]];
      try {
        await sendMessage(env, sub.user_id, html, { keyboard });
      } catch (e) {
        if (e instanceof TelegramError && e.isUnreachable) await markBlocked(env, sub.user_id);
      }
      budget--;
    }
    if (done.length) await db(env).from('stock_alerts').delete().eq('product_id', v.product.id).in('user_id', done);
  }
}

// ── used by the bot ──────────────────────────────────────────────────────────

export async function hasStockAlert(env: Env, userId: number, productId: string): Promise<boolean> {
  const { count } = await db(env).from('stock_alerts').select('user_id', { count: 'exact', head: true }).eq('user_id', userId).eq('product_id', productId);
  return (count ?? 0) > 0;
}

/** Toggle "notify me" for a product. Returns the new state. */
export async function toggleStockAlert(env: Env, userId: number, productId: string): Promise<boolean> {
  if (await hasStockAlert(env, userId, productId)) {
    await db(env).from('stock_alerts').delete().eq('user_id', userId).eq('product_id', productId);
    return false;
  }
  must(await db(env).from('stock_alerts').upsert({ user_id: userId, product_id: productId }), 'stock alert add');
  return true;
}

export async function setAlertsOptIn(env: Env, userId: number, on: boolean): Promise<void> {
  must(await db(env).from('users').update({ alerts_opt_in: on }).eq('id', userId), 'alerts opt-in');
}
