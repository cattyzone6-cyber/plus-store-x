import type { AppCtx } from '../env';
import type { OrderRow } from '../types';
import { getSettings } from '../lib/settings';
import { getEmojiResolver } from '../lib/emoji';
import { escapeHtml, t, raw } from '../lib/i18n';
import { fmtUsd } from '../lib/money';
import { button, sendTextDocument } from '../lib/telegram';
import { db, must } from '../lib/db';
import { getUser } from './users';
import { notifyUser } from './notify';

const MAX_INLINE_CHARS = 3000;

function warrantyText(order: OrderRow, lang: 'en' | 'ar'): string {
  if (!order.warranty_days) return lang === 'ar' ? 'بدون ضمان' : 'No warranty';
  return lang === 'ar' ? `${order.warranty_days} يوم` : `${order.warranty_days} days`;
}

/** Message sent to the customer when an order is delivered. Long deliveries are sent as a TXT file. */
export async function sendDeliveryMessage(app: AppCtx, order: OrderRow): Promise<void> {
  const { env } = app;
  const [s, user] = await Promise.all([getSettings(env), getUser(env, order.user_id)]);
  if (!user) return;
  const em = await getEmojiResolver(env, s);
  const lang = user.lang;

  const productNote = order.product_id
    ? (must(await db(env).from('products').select('delivery_note_en,delivery_note_ar').eq('id', order.product_id).maybeSingle(), 'note') as { delivery_note_en: string | null; delivery_note_ar: string | null } | null)
    : null;
  const note = (lang === 'ar' ? productNote?.delivery_note_ar : null) || productNote?.delivery_note_en || '';

  const itemsHtml = order.delivery.map((i) => `${em.html('key')} <code>${escapeHtml(i)}</code>`).join('\n');
  const tooLong = itemsHtml.length > MAX_INLINE_CHARS;

  const html = t(s, lang, order.delivery.length ? 'delivery_message' : 'delivery_message_no_items', {
    product: order.product_name,
    qty: order.delivered_qty,
    total: fmtUsd(order.total),
    code: order.code,
    warranty: warrantyText(order, lang),
    items: raw(tooLong ? t(s, lang, 'delivery_items_in_file', {}, em) : itemsHtml),
    note: raw(note ? `\n${escapeHtml(note)}\n` : ''),
    points: order.points_awarded,
    points_line: raw(order.points_awarded ? t(s, lang, 'delivery_points_line', { points: order.points_awarded }, em) : ''),
  }, em);

  const keyboard = [];
  if (order.delivery.length && s.features.download_txt && !tooLong) {
    keyboard.push([button({ text: t(s, lang, 'btn_download_txt'), emoji: 'download', data: `txt:${order.id}`, style: 'primary' }, em)]);
  }
  keyboard.push([button({ text: t(s, lang, 'btn_my_orders'), emoji: 'orders', data: 'orders:0' }, em), button({ text: t(s, lang, 'btn_home'), emoji: 'home', data: 'home' }, em)]);

  await notifyUser(env, user.id, html, keyboard);
  if (order.delivery.length && tooLong) await sendOrderTxt(app, order);
}

export function orderTxtContent(order: OrderRow): string {
  return [
    `Order: ${order.code}`,
    `Product: ${order.product_name} x ${order.delivered_qty}`,
    `Date: ${order.delivered_at ?? order.created_at}`,
    order.warranty_until ? `Warranty until: ${order.warranty_until}` : '',
    '',
    ...order.delivery,
    '',
  ].filter((l, i) => l !== '' || i > 3).join('\n');
}

export async function sendOrderTxt(app: AppCtx, order: OrderRow): Promise<void> {
  await sendTextDocument(app.env, order.user_id, `${order.code}.txt`, orderTxtContent(order));
}

/**
 * Status updates (processing, manual queue, refunds...). `key` is an i18n key that
 * receives {code, product, qty, total, amount}.
 */
export async function sendOrderStatusMessage(app: AppCtx, order: OrderRow, key: string, vars: Record<string, unknown> = {}): Promise<void> {
  if (order.channel !== 'bot') return;
  const { env } = app;
  const [s, user] = await Promise.all([getSettings(env), getUser(env, order.user_id)]);
  if (!user) return;
  const em = await getEmojiResolver(env, s);
  const html = t(s, user.lang, key, {
    code: order.code,
    product: order.product_name,
    qty: order.quantity,
    total: fmtUsd(order.total),
    amount: fmtUsd((vars.amount as number) ?? order.refunded_amount),
    ...vars,
  }, em);
  await notifyUser(env, user.id, html, [[button({ text: t(s, user.lang, 'btn_home'), emoji: 'home', data: 'home' }, em)]]);
}
