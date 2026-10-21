import type { AppCtx } from '../env';
import type { OrderRow, TicketRow, UserRow } from '../types';
import { getSettings } from '../lib/settings';
import { getEmojiResolver } from '../lib/emoji';
import { db, must } from '../lib/db';
import { escapeHtml, raw, t } from '../lib/i18n';
import { round4 } from '../lib/money';
import { button } from '../lib/telegram';
import { notifyAdmins, notifyUser } from './notify';
import { getOrder, refundOrder } from './orders';
import { getUser } from './users';

export class TicketError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface CreateTicketInput {
  user: UserRow;
  kind: TicketRow['kind'];
  orderId?: number | null;
  message?: string | null;
  attachmentId?: string | null;
}

/** Insert a ticket and alert the admins (with action buttons). */
export async function createTicket(app: AppCtx, input: CreateTicketInput): Promise<TicketRow> {
  const { env } = app;
  let order: OrderRow | null = null;
  if (input.orderId) {
    order = await getOrder(env, input.orderId);
    if (!order || order.user_id !== input.user.id) throw new TicketError('ORDER_NOT_FOUND');
    const { count } = await db(env).from('tickets').select('id', { count: 'exact', head: true })
      .eq('order_id', order.id).eq('status', 'open');
    if ((count ?? 0) > 0) throw new TicketError('TICKET_EXISTS');
  }
  const ticket = must(await db(env).from('tickets').insert({
    user_id: input.user.id,
    order_id: order?.id ?? null,
    kind: input.kind,
    message: input.message?.slice(0, 3500) ?? null,
    attachment_id: input.attachmentId ?? null,
  }).select('*').single(), 'ticket insert') as TicketRow;

  const who = input.user.username ? `@${escapeHtml(input.user.username)}` : escapeHtml(input.user.first_name ?? '');
  const lines = [
    `🎫 <b>Ticket #${ticket.id}</b> — ${ticket.kind}`,
    `User: ${who} <code>${input.user.id}</code>`,
  ];
  if (order) {
    lines.push(`Order: <code>${order.code}</code> — ${escapeHtml(order.product_name)} × ${order.quantity} ($${Number(order.total).toFixed(2)})`);
    if (order.warranty_until) lines.push(`Warranty until: ${order.warranty_until.slice(0, 10)}`);
  }
  if (ticket.message) lines.push('', `<blockquote>${escapeHtml(ticket.message)}</blockquote>`);
  if (ticket.attachment_id) lines.push('<i>📎 Attachment: see below</i>');

  const kb = ticket.kind === 'support'
    ? [[{ text: '💬 Reply', callback_data: `adm:tk_ans:${ticket.id}`, style: 'primary' as const }, { text: '✖️ Close', callback_data: `adm:tk_no:${ticket.id}`, style: 'danger' as const }]]
    : [
        [{ text: '🔄 Replace', callback_data: `adm:tk_rep:${ticket.id}`, style: 'success' as const }, { text: '↩️ Refund', callback_data: `adm:tk_ref:${ticket.id}`, style: 'primary' as const }],
        [{ text: '💬 Reply', callback_data: `adm:tk_ans:${ticket.id}` }, { text: '❌ Reject', callback_data: `adm:tk_no:${ticket.id}`, style: 'danger' as const }],
      ];
  await notifyAdmins(env, 'ticket', lines.join('\n'), kb);
  if (ticket.attachment_id) await forwardAttachmentToAdmins(app, ticket);
  return ticket;
}

async function forwardAttachmentToAdmins(app: AppCtx, ticket: TicketRow): Promise<void> {
  const { env } = app;
  const s = await getSettings(env);
  const targets: (string | number)[] = [];
  if (s.notifications.chat_id) targets.push(s.notifications.chat_id);
  else {
    const admins = must(await db(env).from('admins').select('telegram_id').not('telegram_id', 'is', null), 'admins') as { telegram_id: number }[];
    targets.push(...admins.map((a) => a.telegram_id));
  }
  const { tg } = await import('../lib/telegram');
  await Promise.all(targets.map((chat) =>
    tg(env, 'sendPhoto', { chat_id: chat, photo: ticket.attachment_id, caption: `Ticket #${ticket.id}` })
      .catch(() => tg(env, 'sendDocument', { chat_id: chat, document: ticket.attachment_id, caption: `Ticket #${ticket.id}` }))
      .catch((e) => console.error('ticket attachment forward failed', e)),
  ));
}

export interface ResolveOptions {
  adminId?: string | null;
  note?: string | null;
  replacementItems?: string[];
  refundAmount?: number;
}

/**
 * Close a ticket and tell the customer.
 *  - replaced : sends `replacementItems` to the customer (and appends them to the order's delivery)
 *  - refunded : refunds `refundAmount` (default: price of one unit, capped by what is left) to the wallet
 *  - rejected / answered : sends the note
 */
export async function resolveTicket(
  app: AppCtx,
  ticketId: number,
  resolution: 'replaced' | 'refunded' | 'rejected' | 'answered',
  opts: ResolveOptions = {},
): Promise<TicketRow> {
  const { env } = app;
  const ticket = must(await db(env).from('tickets').select('*').eq('id', ticketId).maybeSingle(), 'ticket') as TicketRow | null;
  if (!ticket) throw new TicketError('TICKET_NOT_FOUND');
  if (ticket.status !== 'open') throw new TicketError('TICKET_CLOSED');

  const [s, user] = await Promise.all([getSettings(env), getUser(env, ticket.user_id)]);
  const em = await getEmojiResolver(env, s);
  const lang = user?.lang ?? s.bot.default_lang;
  const order = ticket.order_id ? await getOrder(env, ticket.order_id) : null;
  const note = opts.note?.trim() || '';
  const noteHtml = note ? `\n\n<blockquote>${escapeHtml(note)}</blockquote>` : '';
  let refundAmount: number | null = null;

  if (resolution === 'replaced') {
    const items = (opts.replacementItems ?? []).map((i) => i.trim()).filter(Boolean);
    if (!items.length) throw new TicketError('ITEMS_REQUIRED');
    if (order) {
      await db(env).from('orders').update({
        delivery: [...(order.delivery ?? []), ...items],
        admin_note: `${order.admin_note ? `${order.admin_note}\n` : ''}Replacement (ticket #${ticket.id})`,
      }).eq('id', order.id);
    }
    const itemsHtml = items.map((i) => `${em.html('key')} <code>${escapeHtml(i)}</code>`).join('\n');
    await notifyUser(env, ticket.user_id, t(s, lang, 'ticket_replaced', { id: ticket.id, code: order?.code ?? '', items: raw(itemsHtml), note: raw(noteHtml) }, em),
      [[button({ text: t(s, lang, 'btn_home'), emoji: 'home', data: 'home' }, em)]]);
  } else if (resolution === 'refunded') {
    if (!order) throw new TicketError('ORDER_NOT_FOUND');
    const remaining = round4(Number(order.total) - Number(order.refunded_amount));
    const perUnit = round4(Number(order.total) / order.quantity);
    refundAmount = Math.min(opts.refundAmount ?? perUnit, remaining);
    if (refundAmount <= 0) throw new TicketError('NOTHING_TO_REFUND');
    // refundOrder messages the customer itself
    await refundOrder(app, order.id, refundAmount, note || `Ticket #${ticket.id}`, opts.adminId ?? null);
  } else {
    const key = resolution === 'rejected' ? 'ticket_rejected' : 'ticket_answered';
    await notifyUser(env, ticket.user_id, t(s, lang, key, { id: ticket.id, note: raw(noteHtml) }, em),
      [[button({ text: t(s, lang, 'btn_support'), emoji: 'support', data: 'sup' }, em), button({ text: t(s, lang, 'btn_home'), emoji: 'home', data: 'home' }, em)]]);
  }

  return must(await db(env).from('tickets').update({
    status: resolution === 'rejected' ? 'rejected' : 'resolved',
    resolution,
    resolution_note: note || (opts.replacementItems?.length ? `${opts.replacementItems.length} item(s) sent` : null),
    refund_amount: refundAmount,
    resolved_at: new Date().toISOString(),
    resolved_by: opts.adminId ?? null,
  }).eq('id', ticket.id).select('*').single(), 'ticket resolve') as TicketRow;
}
