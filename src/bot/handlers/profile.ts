import type { BotContext } from '../context';
import { answer, plain, setState, show, tr } from '../context';
import { backHomeRow, btn, cb, fmtDate, homeRow, isActiveOrderForWarranty, statusLabel, STATUS_EMOJI, truncate } from '../ui';
import { getOrder, listUserOrders } from '../../services/orders';
import { orderTxtContent, sendOrderTxt } from '../../services/delivery';
import { getUser, userDiscountPercent } from '../../services/users';
import { db, dbErrorCode, must, rpc } from '../../lib/db';
import { fmtUsd } from '../../lib/money';
import { escapeHtml, raw } from '../../lib/i18n';
import { randomToken, sha256Hex } from '../../lib/crypto';
import { baseUrl } from '../../lib/settings';
import { button, type InlineKeyboard } from '../../lib/telegram';
import type { OrderRow, UserRow } from '../../types';

async function freshUser(ctx: BotContext): Promise<UserRow> {
  const u = (await getUser(ctx.st.env, ctx.st.user.id)) ?? ctx.st.user;
  ctx.st.user = { ...ctx.st.user, ...u, state: ctx.st.user.state };
  return u;
}

export function displayName(u: Pick<UserRow, 'first_name' | 'last_name' | 'username'>): string {
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? `@${u.username}` : '—');
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export async function showProfile(ctx: BotContext): Promise<void> {
  const { env, s } = ctx.st;
  await setState(ctx, null);
  const u = await freshUser(ctx);
  const latest = await listUserOrders(env, u.id, 3);
  const discount = userDiscountPercent(u, s.pricing.discount_levels, s.features.discount_levels);

  const html = tr(ctx, 'profile', {
    name: displayName(u),
    id: u.id,
    joined: fmtDate(u.joined_at, u.lang),
    balance: fmtUsd(u.balance),
    points: u.points,
    orders: u.orders_count,
    spent: fmtUsd(u.total_spent),
    deposited: fmtUsd(u.total_deposited),
    referral_block: raw(s.features.referrals ? tr(ctx, 'profile_referral_block', { percent: s.referral.percent, invited: u.referrals_count, earned: fmtUsd(u.referral_earned) }) : ''),
    discount_line: raw(discount > 0 ? tr(ctx, 'profile_discount_line', { percent: discount }) : ''),
    latest: raw(latest.length
      ? latest.map((o) => tr(ctx, 'profile_order_line', { status: STATUS_EMOJI[o.status], code: o.code, product: truncate(o.product_name, 30), total: fmtUsd(o.total) })).join('\n')
      : tr(ctx, 'profile_no_orders')),
  });

  const kb: InlineKeyboard = [[btn(ctx, 'btn_deposit', 'dep', 'deposit', 'primary')]];
  const row2 = [];
  if (s.features.referrals) row2.push(btn(ctx, 'btn_referrals', 'ref', 'referrals', 'primary'));
  if (s.features.discount_levels || s.features.cashback) row2.push(btn(ctx, 'btn_discounts', 'disc', 'discount', 'primary'));
  if (row2.length) kb.push(row2);
  const row3 = [];
  if (s.features.redeem_codes) row3.push(btn(ctx, 'btn_redeem', 'redeem', 'redeem', 'primary'));
  if (s.features.giveaways) row3.push(btn(ctx, 'btn_giveaways', 'gw', 'giveaways', 'primary'));
  if (row3.length) kb.push(row3);
  kb.push([btn(ctx, 'btn_my_orders', 'orders:0', 'orders')]);
  const row4 = [];
  if (s.features.reseller_api) row4.push(btn(ctx, 'btn_api', 'api', 'api'));
  if (s.features.replacements) row4.push(btn(ctx, 'btn_replace', 'rep', 'replace'));
  if (row4.length) kb.push(row4);
  kb.push([btn(ctx, 'btn_language', 'lang', 'language'), ...homeRow(ctx)]);
  await show(ctx, html, kb);
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 8;

export async function showOrders(ctx: BotContext, page: number): Promise<void> {
  const { env } = ctx.st;
  const orders = await listUserOrders(env, ctx.st.user.id, PAGE + 1, page * PAGE);
  const hasMore = orders.length > PAGE;
  const list = orders.slice(0, PAGE);
  if (!list.length && page === 0) {
    await show(ctx, tr(ctx, 'orders_empty'), [[btn(ctx, 'btn_shop', 'shop', 'shop', 'primary')], backHomeRow(ctx, 'prof')]);
    return;
  }
  const kb: InlineKeyboard = list.map((o) => [
    button({ text: truncate(`${STATUS_EMOJI[o.status]} ${o.product_name} · ${fmtUsd(o.total)}`, 60), data: cb('o', o.id) }, ctx.st.em),
  ]);
  const nav = [];
  if (page > 0) nav.push(btn(ctx, 'btn_prev', cb('orders', page - 1), 'back'));
  if (hasMore) nav.push(button({ text: `${tr(ctx, 'btn_next')} ▶️`, data: cb('orders', page + 1) }, ctx.st.em));
  if (nav.length) kb.push(nav);
  kb.push(backHomeRow(ctx, 'prof'));
  await show(ctx, tr(ctx, 'orders_title', { page: page + 1 }), kb);
}

async function ownOrder(ctx: BotContext, id: number): Promise<OrderRow | null> {
  const o = await getOrder(ctx.st.env, id);
  return o && o.user_id === ctx.st.user.id ? o : null;
}

export async function showOrder(ctx: BotContext, id: number): Promise<void> {
  const { s, em } = ctx.st;
  const lang = ctx.st.user.lang;
  const o = await ownOrder(ctx, id);
  if (!o) return void (await answer(ctx, tr(ctx, 'err_ORDER_NOT_FOUND'), true));

  let warranty = '';
  if (o.warranty_until) {
    warranty = new Date(o.warranty_until).getTime() > Date.now()
      ? tr(ctx, 'order_warranty_until', { until: fmtDate(o.warranty_until, lang) })
      : tr(ctx, 'order_warranty_expired');
  }
  let items = '';
  if (o.delivery?.length) {
    const body = o.delivery.map((i) => `${em.html('key')} <code>${escapeHtml(i)}</code>`).join('\n');
    items = body.length > 3000 ? tr(ctx, 'delivery_items_in_file') : body;
  }
  const html = tr(ctx, 'order_detail', {
    code: o.code,
    product: o.product_name,
    qty: o.quantity,
    total: fmtUsd(o.total),
    status: statusLabel(ctx, o.status),
    date: fmtDate(o.created_at, lang),
    warranty_line: raw(warranty ? `\n${warranty}` : ''),
    refunded_line: raw(Number(o.refunded_amount) > 0 ? `\n${tr(ctx, 'order_refunded_line', { amount: fmtUsd(o.refunded_amount) })}` : ''),
    items: raw(items ? `\n\n${tr(ctx, 'order_items_title')}\n${items}` : ''),
  });

  const kb: InlineKeyboard = [];
  if (o.delivery?.length && s.features.download_txt) kb.push([btn(ctx, 'btn_download_txt', cb('txt', o.id), 'download', 'primary')]);
  if (s.features.replacements && isActiveOrderForWarranty(o)) kb.push([btn(ctx, 'btn_request_replacement', cb('rep', o.id), 'replace')]);
  kb.push(backHomeRow(ctx, 'orders:0'));
  await show(ctx, html, kb);
}

export async function onTxt(ctx: BotContext, id: number): Promise<void> {
  const o = await ownOrder(ctx, id);
  if (!o || !o.delivery?.length) return void (await answer(ctx, tr(ctx, 'err_ORDER_NOT_FOUND'), true));
  await answer(ctx);
  try {
    await sendOrderTxt(ctx.st.app, o);
  } catch {
    // fallback through grammY (e.g. tests / different token)
    const { InputFile } = await import('grammy');
    await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(orderTxtContent(o)), `${o.code}.txt`));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Referrals, discounts & points, redeem
// ─────────────────────────────────────────────────────────────────────────────

export function referralLink(botUsername: string, userId: number): string {
  return `https://t.me/${botUsername}?start=ref_${userId}`;
}

export async function showReferrals(ctx: BotContext, botUsername: string): Promise<void> {
  const { s, em } = ctx.st;
  if (!s.features.referrals) return void (await show(ctx, tr(ctx, 'feature_disabled'), [homeRow(ctx)]));
  const u = await freshUser(ctx);
  const link = referralLink(botUsername, u.id);
  const html = tr(ctx, 'referrals', { percent: s.referral.percent, link, invited: u.referrals_count, earned: fmtUsd(u.referral_earned) });
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(s.brand.name)}`;
  await show(ctx, html, [
    [button({ text: tr(ctx, 'btn_copy_link'), emoji: 'link', copy: link, style: 'primary' }, em)],
    [button({ text: tr(ctx, 'btn_share'), emoji: 'referrals', url: share }, em)],
    homeRow(ctx),
  ]);
}

export async function showDiscounts(ctx: BotContext): Promise<void> {
  const { s } = ctx.st;
  const u = await freshUser(ctx);
  const personal = userDiscountPercent(u, s.pricing.discount_levels, s.features.discount_levels);
  let levels = '';
  if (s.features.discount_levels && s.pricing.discount_levels.length) {
    const sorted = [...s.pricing.discount_levels].sort((a, b) => a.min_spent - b.min_spent);
    levels = `\n${tr(ctx, 'discount_levels_title')}\n` + sorted.map((l) => tr(ctx, 'discount_level_line', {
      mark: Number(u.total_spent) >= l.min_spent ? '✅' : '▫️',
      name: (u.lang === 'ar' ? l.name_ar : l.name_en) || '',
      min: fmtUsd(l.min_spent),
      percent: l.percent,
    })).join('\n') + '\n';
  }
  let points = '';
  if (s.features.cashback) {
    points = tr(ctx, 'points_block', {
      points: u.points,
      value: fmtUsd(u.points * s.cashback.usd_per_point),
      per_usd: s.cashback.points_per_usd,
      min: s.cashback.min_redeem_points,
    });
  }
  const html = tr(ctx, 'discounts', { percent: personal, spent: fmtUsd(u.total_spent), levels: raw(levels), points: raw(points) });
  const kb: InlineKeyboard = [];
  if (s.features.cashback && u.points >= s.cashback.min_redeem_points && u.points > 0) {
    kb.push([btn(ctx, 'btn_redeem_points', 'pts', 'points', 'success', { points: u.points })]);
  }
  kb.push(backHomeRow(ctx, 'prof'));
  await show(ctx, html, kb);
}

export async function redeemPoints(ctx: BotContext): Promise<void> {
  const { s } = ctx.st;
  const u = await freshUser(ctx);
  if (!s.features.cashback || u.points < s.cashback.min_redeem_points || u.points <= 0) {
    return void (await answer(ctx, plain(tr(ctx, 'points_not_enough', { min: s.cashback.min_redeem_points })), true));
  }
  try {
    await rpc(ctx.st.env, 'points_redeem', { p_user_id: u.id, p_points: u.points, p_usd_per_point: s.cashback.usd_per_point });
    await answer(ctx, plain(tr(ctx, 'points_redeemed', { points: u.points, amount: fmtUsd(u.points * s.cashback.usd_per_point) })), true);
  } catch (e) {
    await answer(ctx, plain(tr(ctx, `err_${dbErrorCode(e) ?? 'generic'}`)), true);
  }
  await showDiscounts(ctx);
}

export async function askRedeem(ctx: BotContext): Promise<void> {
  if (!ctx.st.s.features.redeem_codes) return void (await show(ctx, tr(ctx, 'feature_disabled'), [homeRow(ctx)]));
  await setState(ctx, { kind: 'await_redeem' });
  await show(ctx, tr(ctx, 'redeem_prompt'), [backHomeRow(ctx, 'prof')]);
}

export async function onRedeemText(ctx: BotContext, text: string): Promise<void> {
  const code = text.trim().split(/\s+/)[0] ?? '';
  try {
    const amount = await rpc<number>(ctx.st.env, 'redeem_code_use', { p_code: code, p_user_id: ctx.st.user.id });
    await setState(ctx, null);
    await ctx.reply(tr(ctx, 'redeem_ok', { amount: fmtUsd(amount) }), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [homeRow(ctx)] } as never });
  } catch (e) {
    const c = dbErrorCode(e);
    await ctx.reply(tr(ctx, c ? `err_${c}` : 'err_generic'), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [backHomeRow(ctx, 'prof')] } as never });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reseller API keys
// ─────────────────────────────────────────────────────────────────────────────

interface ApiKeyRow { id: string; prefix: string; name: string | null; created_at: string; last_used_at: string | null }

export async function showApi(ctx: BotContext): Promise<void> {
  const { env, s, user } = ctx.st;
  if (!s.features.reseller_api) return void (await show(ctx, tr(ctx, 'feature_disabled'), [homeRow(ctx)]));
  const keys = must(await db(env).from('api_keys').select('id,prefix,name,created_at,last_used_at').eq('user_id', user.id).eq('is_active', true).order('created_at'), 'api keys') as ApiKeyRow[];
  const list = keys.length
    ? keys.map((k) => tr(ctx, 'api_key_line', { prefix: k.prefix, date: fmtDate(k.created_at, user.lang) })).join('\n')
    : tr(ctx, 'api_no_keys');
  const kb: InlineKeyboard = [];
  if (keys.length < 3) kb.push([btn(ctx, 'btn_create_key', 'api:new', 'key', 'success')]);
  for (const k of keys) kb.push([btn(ctx, 'btn_revoke_key', cb('api', 'rv', k.id), 'cancel', 'danger', { prefix: k.prefix })]);
  kb.push(backHomeRow(ctx, 'prof'));
  await show(ctx, tr(ctx, 'api_title', { base: `${baseUrl(s)}/api/v1`, keys: raw(list) }), kb);
}

export async function createApiKey(ctx: BotContext): Promise<void> {
  const { env, s, user } = ctx.st;
  if (!s.features.reseller_api) return;
  const { count } = await db(env).from('api_keys').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_active', true);
  if ((count ?? 0) >= 3) return void (await answer(ctx, tr(ctx, 'api_limit'), true));
  const key = `psx_${randomToken(24)}`;
  must(await db(env).from('api_keys').insert({ user_id: user.id, key_hash: await sha256Hex(key), prefix: key.slice(0, 10), name: 'bot' }), 'api key insert');
  await answer(ctx);
  await ctx.reply(tr(ctx, 'api_key_created', { key }), { parse_mode: 'HTML' });
  await showApi(ctx);
}

export async function revokeApiKey(ctx: BotContext, id: string): Promise<void> {
  must(await db(ctx.st.env).from('api_keys').update({ is_active: false }).eq('id', id).eq('user_id', ctx.st.user.id), 'api key revoke');
  await answer(ctx, tr(ctx, 'api_key_revoked'));
  await showApi(ctx);
}
