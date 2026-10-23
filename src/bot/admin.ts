import type { Message, MessageEntity } from 'grammy/types';
import type { AdminInfo, BotContext } from './context';
import { answer, getAdmin, setState } from './context';
import { db, must } from '../lib/db';
import { DEFAULT_EMOJIS, invalidateEmojis } from '../lib/emoji';
import { escapeHtml } from '../lib/i18n';
import { baseUrl } from '../lib/settings';
import { tg } from '../lib/telegram';
import { deliverManual, getOrder, refundOrder } from '../services/orders';
import { approveManualDeposit, rejectDeposit } from '../services/deposits';
import { resolveTicket } from '../services/tickets';
import { fmtUsd } from '../lib/money';
import { onAdminInput, showAdminHome } from './adminHome';

// Admin actions inside Telegram. Admin texts are English (admins share one language).

const ADMIN_STATES = ['await_admin_delivery', 'await_admin_replacement', 'await_admin_answer', 'await_emoji', 'await_setemoji', 'await_admin_lookup', 'await_admin_balance', 'await_admin_message'];
export function isAdminState(kind: string | undefined): boolean {
  return !!kind && ADMIN_STATES.includes(kind);
}

function adminLabel(a: AdminInfo): string {
  return a.email.split('@')[0];
}

/** Append a "handled by" line to the alert message and remove its buttons. */
async function markHandled(ctx: BotContext, note: string, src?: { chat: number | string; msg: number }): Promise<void> {
  const m = ctx.callbackQuery?.message as Message | undefined;
  const chat = src?.chat ?? m?.chat.id;
  const msgId = src?.msg ?? m?.message_id;
  if (chat == null || msgId == null) return;
  const empty = { inline_keyboard: [] } as never;
  try {
    if (!src && m && typeof m.caption === 'string') {
      await ctx.api.editMessageCaption(chat, msgId, { caption: `${m.caption}\n\n${note}`, caption_entities: m.caption_entities, reply_markup: empty });
    } else if (!src && m && typeof m.text === 'string') {
      await ctx.api.editMessageText(chat, msgId, `${m.text}\n\n${note}`, { entities: m.entities, reply_markup: empty, link_preview_options: { is_disabled: true } });
    } else {
      await ctx.api.editMessageReplyMarkup(chat, msgId, { reply_markup: empty });
      await ctx.api.sendMessage(chat, note, { reply_parameters: { message_id: msgId, allow_sending_without_reply: true } });
    }
  } catch {
    // message too old / already edited — not important
  }
}

/** Send a prompt to the admin's private chat (callbacks may come from the alerts group). */
async function promptPrivately(ctx: BotContext, html: string): Promise<boolean> {
  try {
    await ctx.api.sendMessage(ctx.from!.id, html, { parse_mode: 'HTML' });
    return true;
  } catch {
    await answer(ctx, 'Open a private chat with the bot first (/start), then tap again.', true);
    return false;
  }
}

function srcOf(ctx: BotContext): { srcChat: number; srcMsg: number } | Record<string, never> {
  const m = ctx.callbackQuery?.message;
  return m ? { srcChat: m.chat.id, srcMsg: m.message_id } : {};
}

/** Callback queries starting with "adm:". */
export async function onAdminCallback(ctx: BotContext, data: string): Promise<void> {
  const admin = await getAdmin(ctx);
  if (!admin) return void (await answer(ctx, 'Admins only.', true));
  const [, action, idStr] = data.split(':');
  const { app } = ctx.st;
  // money leaves the store only on the owner's decision
  if (['refund', 'refund_ok', 'tk_ref'].includes(action) && admin.role !== 'owner') {
    return void (await answer(ctx, 'Only the owner can refund.', true));
  }

  try {
    switch (action) {
      case 'deliver': {
        const order = await getOrder(ctx.st.env, Number(idStr));
        if (!order) return void (await answer(ctx, 'Order not found', true));
        if (['delivered', 'refunded', 'cancelled'].includes(order.status)) return void (await answer(ctx, `Order is already ${order.status}`, true));
        const inputs = Object.entries(order.inputs ?? {}).map(([k, v]) => `${k}: <code>${escapeHtml(Array.isArray(v) ? v.join(', ') : String(v))}</code>`).join('\n');
        const ok = await promptPrivately(ctx,
          `📦 <b>Deliver order ${order.code}</b>\n${escapeHtml(order.product_name)} × ${order.quantity}${inputs ? `\n${inputs}` : ''}\n\n` +
          `Send the item(s) now — <b>one per line</b> (${order.quantity} expected), or upload a .txt file.\nSend /cancel to abort.`);
        if (!ok) return;
        await setState(ctx, { kind: 'await_admin_delivery', data: { orderId: order.id, ...srcOf(ctx) } });
        return void (await answer(ctx, 'Check your private chat with the bot'));
      }
      case 'refund': {
        const order = await getOrder(ctx.st.env, Number(idStr));
        if (!order) return void (await answer(ctx, 'Order not found', true));
        const left = Number(order.total) - Number(order.refunded_amount);
        await answer(ctx);
        await ctx.reply(`↩️ Refund <b>${fmtUsd(left)}</b> for order <code>${order.code}</code> to the customer's wallet?`, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[
            { text: '✅ Yes, refund', callback_data: `adm:refund_ok:${order.id}`, style: 'danger' },
            { text: '✖️ No', callback_data: 'adm:noop:0' },
          ]] } as never,
        });
        return;
      }
      case 'refund_ok': {
        const order = await refundOrder(app, Number(idStr), null, `Refund by ${adminLabel(admin)}`, admin.user_id);
        await answer(ctx, 'Refunded');
        await markHandled(ctx, `↩️ Refunded ${fmtUsd(order.refunded_amount)} by ${adminLabel(admin)}`);
        return;
      }
      case 'dep_ok': {
        const d = await approveManualDeposit(app, idStr, admin.user_id);
        await answer(ctx, d.status === 'paid' ? 'Approved ✅' : `Deposit is ${d.status}`);
        await markHandled(ctx, `✅ Approved by ${adminLabel(admin)} (${fmtUsd(d.credited_amount ?? d.amount_usd)})`);
        return;
      }
      case 'dep_no': {
        const d = await rejectDeposit(app, idStr, admin.user_id);
        await answer(ctx, `Deposit ${d.status}`);
        await markHandled(ctx, `❌ Rejected by ${adminLabel(admin)}`);
        return;
      }
      case 'tk_rep': {
        const ok = await promptPrivately(ctx, `🔄 <b>Replacement for ticket #${idStr}</b>\nSend the replacement item(s), one per line (or a .txt file). Send /cancel to abort.`);
        if (!ok) return;
        await setState(ctx, { kind: 'await_admin_replacement', data: { ticketId: Number(idStr), ...srcOf(ctx) } });
        return void (await answer(ctx, 'Check your private chat with the bot'));
      }
      case 'tk_ans': {
        const ok = await promptPrivately(ctx, `💬 <b>Reply to ticket #${idStr}</b>\nSend your answer as one message. Send /cancel to abort.`);
        if (!ok) return;
        await setState(ctx, { kind: 'await_admin_answer', data: { ticketId: Number(idStr), ...srcOf(ctx) } });
        return void (await answer(ctx, 'Check your private chat with the bot'));
      }
      case 'tk_ref': {
        const t = await resolveTicket(app, Number(idStr), 'refunded', { adminId: admin.user_id });
        await answer(ctx, 'Refunded');
        await markHandled(ctx, `↩️ Refunded ${fmtUsd(t.refund_amount ?? 0)} by ${adminLabel(admin)}`);
        return;
      }
      case 'tk_no': {
        await resolveTicket(app, Number(idStr), 'rejected', { adminId: admin.user_id });
        await answer(ctx, 'Closed');
        await markHandled(ctx, `✖️ Closed by ${adminLabel(admin)}`);
        return;
      }
      default:
        await answer(ctx);
    }
  } catch (e) {
    console.error('admin action failed', data, e);
    await answer(ctx, `Failed: ${(e as Error).message}`.slice(0, 190), true);
  }
}

/** Read the items an admin sent: text lines or an uploaded .txt document. */
async function readItems(ctx: BotContext): Promise<string[]> {
  const msg = ctx.message;
  if (!msg) return [];
  if (msg.document) {
    const file = await tg<{ file_path?: string }>(ctx.st.env, 'getFile', { file_id: msg.document.file_id });
    if (!file.file_path) return [];
    const res = await fetch(`https://api.telegram.org/file/bot${ctx.st.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
    const text = await res.text();
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  const text = msg.text ?? msg.caption ?? '';
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

async function say(ctx: BotContext, text: string): Promise<true> {
  await ctx.reply(text);
  return true;
}

/** Messages while an admin state is active. Returns true when handled. */
export async function onAdminMessage(ctx: BotContext): Promise<boolean> {
  const st = ctx.st.user.state;
  if (!st || !isAdminState(st.kind)) return false;
  const admin = await getAdmin(ctx);
  if (!admin) {
    await setState(ctx, null);
    return false;
  }
  const data = (st.data ?? {}) as Record<string, unknown>;
  const src = data.srcChat != null ? { chat: data.srcChat as number, msg: data.srcMsg as number } : undefined;
  const { app } = ctx.st;

  try {
    switch (st.kind) {
      case 'await_admin_lookup':
      case 'await_admin_balance':
      case 'await_admin_message':
        return await onAdminInput(ctx, st.kind, data);
      case 'await_admin_delivery': {
        const items = await readItems(ctx);
        if (!items.length) return say(ctx, 'Send at least one item.');
        const order = await deliverManual(app, Number(data.orderId), items, admin.user_id);
        await setState(ctx, null);
        await ctx.reply(`✅ Order <code>${order.code}</code> delivered (${items.length} item(s)).`, { parse_mode: 'HTML' });
        await markHandled(ctx, `📦 Delivered by ${adminLabel(admin)}`, src);
        return true;
      }
      case 'await_admin_replacement': {
        const items = await readItems(ctx);
        if (!items.length) return say(ctx, 'Send at least one item.');
        await resolveTicket(app, Number(data.ticketId), 'replaced', { adminId: admin.user_id, replacementItems: items });
        await setState(ctx, null);
        await ctx.reply(`✅ Replacement sent for ticket #${data.ticketId}.`);
        await markHandled(ctx, `🔄 Replaced by ${adminLabel(admin)}`, src);
        return true;
      }
      case 'await_admin_answer': {
        const text = ctx.message?.text ?? ctx.message?.caption ?? '';
        if (!text.trim()) return say(ctx, 'Send the answer as text.');
        await resolveTicket(app, Number(data.ticketId), 'answered', { adminId: admin.user_id, note: text });
        await setState(ctx, null);
        await ctx.reply(`✅ Answer sent for ticket #${data.ticketId}.`);
        await markHandled(ctx, `💬 Answered by ${adminLabel(admin)}`, src);
        return true;
      }
      case 'await_emoji': {
        const found = await captureEmojis(ctx);
        if (!found) await ctx.reply('No custom emoji found. Send a message containing Telegram Premium custom emoji, or /cancel.');
        return true;
      }
      case 'await_setemoji': {
        const found = customEmojis(ctx.message);
        if (!found.length) return say(ctx, 'Send exactly one custom emoji, or /cancel.');
        const key = String(data.key);
        const [first] = found;
        must(await db(ctx.st.env).from('emojis').upsert({ key, custom_emoji_id: first.id, fallback: first.fallback || DEFAULT_EMOJIS[key] || '⭐', updated_at: new Date().toISOString() }), 'emoji upsert');
        invalidateEmojis();
        await setState(ctx, null);
        await ctx.reply(`✅ Emoji <b>${escapeHtml(key)}</b> set to <tg-emoji emoji-id="${first.id}">${first.fallback || '⭐'}</tg-emoji> (<code>${first.id}</code>).` +
          (ctx.st.s.bot.premium_emoji ? '' : '\n⚠️ Premium emoji are disabled in Settings → Bot, so the plain fallback is shown to customers.'), { parse_mode: 'HTML' });
        return true;
      }
    }
  } catch (e) {
    await ctx.reply(`❌ Failed: ${escapeHtml((e as Error).message)}`, { parse_mode: 'HTML' });
    return true;
  }
  return false;
}

interface FoundEmoji { id: string; fallback: string }

export function customEmojis(msg: { text?: string; caption?: string; entities?: MessageEntity[]; caption_entities?: MessageEntity[] } | undefined): FoundEmoji[] {
  if (!msg) return [];
  const text = msg.text ?? msg.caption ?? '';
  const entities = msg.entities ?? msg.caption_entities ?? [];
  const out: FoundEmoji[] = [];
  const seen = new Set<string>();
  for (const e of entities) {
    if (e.type !== 'custom_emoji' || seen.has(e.custom_emoji_id)) continue;
    seen.add(e.custom_emoji_id);
    out.push({ id: e.custom_emoji_id, fallback: text.slice(e.offset, e.offset + e.length) });
  }
  return out;
}

async function captureEmojis(ctx: BotContext): Promise<boolean> {
  const found = customEmojis(ctx.message);
  if (!found.length) return false;
  must(await db(ctx.st.env).from('emoji_inbox').upsert(found.map((f) => ({ custom_emoji_id: f.id, fallback: f.fallback, captured_by: ctx.from!.id }))), 'emoji inbox');
  const lines = found.map((f) => `<tg-emoji emoji-id="${f.id}">${f.fallback || '⭐'}</tg-emoji> <code>${f.id}</code>`);
  await ctx.reply(`✅ Saved ${found.length} custom emoji to the admin panel inbox (Emojis page):\n\n${lines.join('\n')}\n\nAssign them in the panel, or use <code>/setemoji key</code> here.`, { parse_mode: 'HTML' });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin commands
// ─────────────────────────────────────────────────────────────────────────────

export async function cmdAdmin(ctx: BotContext): Promise<void> {
  const admin = await getAdmin(ctx);
  if (!admin) return void (await ctx.reply(`Your Telegram ID: <code>${ctx.from!.id}</code>`, { parse_mode: 'HTML' }));
  if (ctx.chat?.type === 'private') return showAdminHome(ctx, { forceNew: true });
  const url = `${baseUrl(ctx.st.s)}/admin/`;
  await ctx.reply(
    `🛠️ <b>Admin</b> — ${escapeHtml(admin.email)} (${admin.role})\n\n` +
    `• Alerts with buttons arrive in the admin chat: deliver manual orders, approve deposits, handle tickets.\n` +
    `• <code>/emoji</code> — capture custom emoji ids (Telegram Premium)\n` +
    `• <code>/setemoji key</code> — set the emoji for a key (e.g. shop, deposit, back)\n` +
    `• <code>/myid</code> — your Telegram ID\n` +
    `• <code>/cancel</code> — cancel the current action\n\n` +
    `Panel: ${url}`,
    { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
  );
}

export async function cmdEmoji(ctx: BotContext): Promise<void> {
  const admin = await getAdmin(ctx);
  if (!admin) return;
  // the command message itself may already contain emoji
  if (await captureEmojis(ctx)) return;
  await setState(ctx, { kind: 'await_emoji' });
  const keys = Object.keys(DEFAULT_EMOJIS).map((k) => `<code>${k}</code>`).join(' ');
  await ctx.reply(
    `🎨 <b>Custom emoji capture</b>\nSend a message with one or more Telegram Premium custom emoji — their ids are saved to the panel inbox.\n\n` +
    `To set one directly: <code>/setemoji key</code>, then send the emoji.\nKeys: ${keys}\n\n` +
    `Note: customers only see custom emoji when the bot's BotFather owner has Telegram Premium and “Premium emoji” is enabled in Settings → Bot.`,
    { parse_mode: 'HTML' },
  );
}

export async function cmdSetEmoji(ctx: BotContext, arg: string): Promise<void> {
  const admin = await getAdmin(ctx);
  if (!admin) return;
  const key = arg.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!/^[a-z0-9_]{1,40}$/.test(key)) return void (await ctx.reply('Usage: /setemoji key  (e.g. /setemoji shop)'));
  // emoji sent in the same message?
  const found = customEmojis(ctx.message);
  if (found.length) {
    const [first] = found;
    must(await db(ctx.st.env).from('emojis').upsert({ key, custom_emoji_id: first.id, fallback: first.fallback || DEFAULT_EMOJIS[key] || '⭐', updated_at: new Date().toISOString() }), 'emoji upsert');
    invalidateEmojis();
    return void (await ctx.reply(`✅ Emoji ${key} set.`));
  }
  await setState(ctx, { kind: 'await_setemoji', data: { key } });
  await ctx.reply(`Send the custom emoji for <b>${escapeHtml(key)}</b>.`, { parse_mode: 'HTML' });
}
