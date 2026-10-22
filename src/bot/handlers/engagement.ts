import type { BotContext } from '../context';
import { answer, plain, setState, show, tr } from '../context';
import { backHomeRow, btn, cb, fmtDate, fmtDateTime, homeRow, isActiveOrderForWarranty, loc, truncate } from '../ui';
import { errorText } from './checkout';
import { showHome } from './home';
import { db, must } from '../../lib/db';
import { escapeHtml, raw } from '../../lib/i18n';
import { fmtUsd } from '../../lib/money';
import { button, type InlineKeyboard } from '../../lib/telegram';
import { getGiveaway, giveawayEntries, hasJoined, joinGiveaway, listActiveGiveaways, prizeText } from '../../services/giveaways';
import { createTicket } from '../../services/tickets';
import { getOrder } from '../../services/orders';
import { setUserLang } from '../../services/users';
import type { FreebieRow, Lang, OrderRow } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Freebies
// ─────────────────────────────────────────────────────────────────────────────

export async function showFreebies(ctx: BotContext): Promise<void> {
  const { env, s, em, user } = ctx.st;
  if (!s.features.freebies) return void (await show(ctx, tr(ctx, 'feature_disabled'), [homeRow(ctx)]));
  const rows = must(await db(env).from('freebies').select('id,title_en,title_ar,sort').eq('is_active', true).order('sort').limit(40), 'freebies') as Pick<FreebieRow, 'id' | 'title_en' | 'title_ar'>[];
  if (!rows.length) return void (await show(ctx, tr(ctx, 'freebies_empty'), [homeRow(ctx)]));
  const kb: InlineKeyboard = rows.map((f) => [button({ text: truncate(loc(f, 'title', user.lang), 60), emoji: 'gift', data: cb('fr', f.id) }, em)]);
  kb.push(homeRow(ctx));
  await show(ctx, tr(ctx, 'freebies_title'), kb);
}

export async function showFreebie(ctx: BotContext, id: string): Promise<void> {
  const { env, user } = ctx.st;
  const f = must(await db(env).from('freebies').select('*').eq('id', id).maybeSingle(), 'freebie') as FreebieRow | null;
  if (!f || !f.is_active) return showFreebies(ctx);
  await db(env).from('freebies').update({ claims: f.claims + 1 }).eq('id', f.id);
  const content = (user.lang === 'ar' && f.content_ar) || f.content_en;
  // freebie content is admin-written HTML-free text; links stay clickable
  await show(ctx, tr(ctx, 'freebie_view', { title: loc(f, 'title', user.lang), content }), [backHomeRow(ctx, 'fr')], { imageUrl: null });
}

// ─────────────────────────────────────────────────────────────────────────────
// Giveaways
// ─────────────────────────────────────────────────────────────────────────────

export async function showGiveaways(ctx: BotContext): Promise<void> {
  const { env, s, em, user } = ctx.st;
  if (!s.features.giveaways) return void (await show(ctx, tr(ctx, 'feature_disabled'), [homeRow(ctx)]));
  const list = await listActiveGiveaways(env);
  if (!list.length) return void (await show(ctx, tr(ctx, 'giveaways_empty'), [backHomeRow(ctx, 'prof')]));
  const kb: InlineKeyboard = list.map((g) => [button({ text: truncate(loc(g, 'title', user.lang), 60), emoji: 'giveaways', data: cb('gw', g.id), style: 'primary' }, em)]);
  kb.push(backHomeRow(ctx, 'prof'));
  await show(ctx, tr(ctx, 'giveaways_title'), kb);
}

export async function showGiveaway(ctx: BotContext, id: string): Promise<void> {
  const { env, user } = ctx.st;
  const g = await getGiveaway(env, id);
  if (!g || g.status !== 'active') return showGiveaways(ctx);
  const [entries, joined] = await Promise.all([giveawayEntries(env, g.id), hasJoined(env, g.id, user.id)]);
  const desc = loc(g, 'description', user.lang);
  const html = tr(ctx, 'giveaway_view', {
    title: loc(g, 'title', user.lang),
    description: raw(desc ? `${escapeHtml(desc)}\n` : ''),
    prize: prizeText(g, user.lang),
    winners: g.winners_count,
    entries,
    ends: fmtDateTime(g.ends_at, user.lang),
    requirement: raw(Number(g.min_spent) > 0 ? tr(ctx, 'giveaway_requirement', { min: fmtUsd(g.min_spent) }) : ''),
    joined: raw(joined ? tr(ctx, 'giveaway_joined_yes') : ''),
  });
  const kb: InlineKeyboard = [];
  if (!joined) kb.push([btn(ctx, 'btn_join_giveaway', cb('gw', 'j', g.id), 'confirm', 'success')]);
  kb.push(backHomeRow(ctx, 'gw'));
  await show(ctx, html, kb);
}

export async function onJoinGiveaway(ctx: BotContext, id: string): Promise<void> {
  const res = await joinGiveaway(ctx.st.env, id, ctx.st.user);
  const g = res === 'min_spent' ? await getGiveaway(ctx.st.env, id) : null;
  const key = res === 'ok' ? 'giveaway_join_ok' : res === 'already' ? 'giveaway_join_already' : res === 'min_spent' ? 'giveaway_join_min' : 'giveaway_ended';
  await answer(ctx, plain(tr(ctx, key, { min: fmtUsd(g?.min_spent ?? 0) })), res !== 'ok');
  await showGiveaway(ctx, id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Support & tickets
// ─────────────────────────────────────────────────────────────────────────────

export async function showSupport(ctx: BotContext): Promise<void> {
  const { s, em, user } = ctx.st;
  await setState(ctx, null);
  const hours = user.lang === 'ar' ? s.support.hours_ar || s.support.hours_en : s.support.hours_en;
  const kb: InlineKeyboard = [];
  if (s.brand.support_username) {
    kb.push([button({ text: tr(ctx, 'btn_contact_admin'), emoji: 'support', url: `https://t.me/${s.brand.support_username.replace(/^@/, '')}`, style: 'success' }, em)]);
  }
  kb.push([btn(ctx, 'btn_open_ticket', 'sup:t', 'ticket', 'primary')]);
  if (s.features.replacements) kb.push([btn(ctx, 'btn_replace', 'rep', 'replace')]);
  kb.push(homeRow(ctx));
  await show(ctx, tr(ctx, 'support', { hours: raw(hours ? tr(ctx, 'support_hours_line', { hours }) : '') }), kb);
}

export async function askTicket(ctx: BotContext): Promise<void> {
  await setState(ctx, { kind: 'await_ticket' });
  await show(ctx, tr(ctx, 'ticket_prompt'), [backHomeRow(ctx, 'sup')]);
}

/** Text or photo received while waiting for a support ticket / replacement description. */
export async function onTicketMessage(ctx: BotContext, kind: 'support' | 'replacement' | 'refund', data: Record<string, unknown> | undefined, msg: { text?: string; fileId?: string }): Promise<void> {
  try {
    const ticket = await createTicket(ctx.st.app, {
      user: ctx.st.user,
      kind,
      orderId: data?.orderId ? Number(data.orderId) : null,
      message: msg.text ?? null,
      attachmentId: msg.fileId ?? null,
    });
    await setState(ctx, null);
    await ctx.reply(tr(ctx, kind === 'support' ? 'ticket_created' : 'replace_sent', { id: ticket.id }), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [homeRow(ctx)] } as never,
    });
  } catch (e) {
    await setState(ctx, null);
    await ctx.reply(errorText(ctx, e), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [homeRow(ctx)] } as never });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Warranty replacement / refund requests
// ─────────────────────────────────────────────────────────────────────────────

export async function showReplaceList(ctx: BotContext): Promise<void> {
  const { env, s, em, user } = ctx.st;
  if (!s.features.replacements) return void (await show(ctx, tr(ctx, 'feature_disabled'), [homeRow(ctx)]));
  const orders = must(
    await db(env).from('orders').select('*').eq('user_id', user.id).in('status', ['delivered', 'partially_delivered'])
      .gt('warranty_until', new Date().toISOString()).order('created_at', { ascending: false }).limit(20),
    'warranty orders',
  ) as OrderRow[];
  if (!orders.length) return void (await show(ctx, tr(ctx, 'replace_none'), [backHomeRow(ctx, 'prof')]));
  const kb: InlineKeyboard = orders.map((o) => [
    button({ text: truncate(`${o.product_name} · ${o.code} · ${fmtDate(o.created_at, user.lang)}`, 60), emoji: 'replace', data: cb('rep', o.id) }, em),
  ]);
  kb.push(backHomeRow(ctx, 'prof'));
  await show(ctx, tr(ctx, 'replace_choose'), kb);
}

async function eligibleOrder(ctx: BotContext, id: number): Promise<OrderRow | null> {
  const o = await getOrder(ctx.st.env, id);
  if (!o || o.user_id !== ctx.st.user.id || !isActiveOrderForWarranty(o)) return null;
  return o;
}

/** rep:<orderId> — choose replacement or refund. */
export async function showReplaceOrder(ctx: BotContext, id: number): Promise<void> {
  const { s } = ctx.st;
  const o = await eligibleOrder(ctx, id);
  if (!o) return void (await answer(ctx, plain(tr(ctx, 'replace_not_eligible')), true));
  if (!s.warranty.allow_refund_requests) return askReplaceDescription(ctx, id, 'replacement');
  await show(ctx, tr(ctx, 'replace_mode', { code: o.code, product: o.product_name }), [
    [btn(ctx, 'btn_request_replacement', cb('rep', 'r', o.id), 'replace', 'primary')],
    [btn(ctx, 'btn_request_refund', cb('rep', 'f', o.id), 'refund')],
    backHomeRow(ctx, cb('o', o.id)),
  ]);
}

export async function askReplaceDescription(ctx: BotContext, id: number, kind: 'replacement' | 'refund'): Promise<void> {
  const o = await eligibleOrder(ctx, id);
  if (!o) return void (await answer(ctx, plain(tr(ctx, 'replace_not_eligible')), true));
  if (kind === 'refund' && !ctx.st.s.warranty.allow_refund_requests) kind = 'replacement';
  await setState(ctx, { kind: 'await_replace_desc', data: { orderId: id, kind } });
  await show(ctx, tr(ctx, 'replace_describe', { code: o.code }), [backHomeRow(ctx, cb('o', o.id))]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Language
// ─────────────────────────────────────────────────────────────────────────────

export async function onSetLanguage(ctx: BotContext, lang: Lang, then?: () => Promise<void>): Promise<void> {
  await setUserLang(ctx.st.env, ctx.st.user.id, lang);
  ctx.st.user.lang = lang;
  ctx.st.user.lang_chosen = true;
  await answer(ctx, plain(tr(ctx, 'lang_changed')));
  await (then ? then() : showHome(ctx));
}
