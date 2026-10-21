import type { BotContext } from '../context';
import { answer, plain, setState, show, tr } from '../context';
import { btn, cb, discountPercent, homeRow, loc, priceHtml } from '../ui';
import { productEmojiHtml, showProduct, showQuantity, warrantyText } from './shop';
import { renderDepositInstructions } from './deposit';
import { getProductView } from '../../services/catalog';
import { requiredInputs } from '../../services/pricing';
import { cancelPendingOrder, createOrder, getOrder, OrderError, payOrderWithWallet } from '../../services/orders';
import { getUser } from '../../services/users';
import { enabledGateways, getGateway } from '../../payments';
import { createDeposit, DepositError, depositErrorText } from '../../services/deposits';
import { TicketError } from '../../services/tickets';
import { fmtUsd, round2 } from '../../lib/money';
import { escapeHtml, raw } from '../../lib/i18n';
import { button, type InlineKeyboard } from '../../lib/telegram';
import type { DepositMethod, OrderRow, RequirementField } from '../../types';

/** Friendly text for an error code thrown by createOrder / payments. */
export function errorText(ctx: BotContext, e: unknown): string {
  if (e instanceof DepositError) return depositErrorText(ctx.st.s, ctx.st.user.lang, e, ctx.st.em);
  const code =
    e instanceof OrderError || e instanceof TicketError ? e.code
    : e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message
    : null;
  if (code) {
    const key = `err_${code}`;
    const txt = tr(ctx, key);
    if (txt !== key) return txt;
  }
  console.error('bot error', e);
  return tr(ctx, 'err_generic');
}

// ─────────────────────────────────────────────────────────────────────────────
// Buy → quantity → inputs → order
// ─────────────────────────────────────────────────────────────────────────────

export async function startBuy(ctx: BotContext, productId: string): Promise<void> {
  const res = await showQuantity(ctx, productId);
  if (res !== 'shown') await chooseQuantity(ctx, productId, res);
}

interface InputState {
  productId: string;
  qty: number;
  idx: number;
  values: Record<string, unknown>;
  promo?: string | null;
}

export function fieldLabel(ctx: BotContext, f: RequirementField): string {
  const custom = ctx.st.user.lang === 'ar' ? f.label_ar || f.label_en : f.label_en;
  if (custom) return custom;
  const key = `input_label_${f.key}`;
  const txt = tr(ctx, key);
  return txt === key ? f.key : txt;
}

async function getAsk(ctx: BotContext, productId: string): Promise<RequirementField[] | null> {
  const v = await getProductView(ctx.st.env, ctx.st.s, productId, ctx.st.user);
  if (!v) return null;
  return requiredInputs(v.product, v.pricing.route).ask;
}

export async function chooseQuantity(ctx: BotContext, productId: string, qty: number): Promise<void> {
  const ask = await getAsk(ctx, productId);
  if (!ask) {
    await showProduct(ctx, productId);
    return;
  }
  if (ask.length) {
    await askInput(ctx, { productId, qty, idx: 0, values: {} }, ask);
    return;
  }
  await placeOrder(ctx, { productId, qty, values: {} });
}

async function askInput(ctx: BotContext, st: InputState, ask: RequirementField[]): Promise<void> {
  const f = ask[st.idx];
  await setState(ctx, { kind: 'await_input', data: st as unknown as Record<string, unknown> });
  const hint = f.options?.length
    ? tr(ctx, 'input_hint_options')
    : f.per_unit && st.qty > 1
      ? tr(ctx, 'input_hint_per_unit', { n: st.qty })
      : tr(ctx, 'input_hint_single');
  const kb: InlineKeyboard = [];
  if (f.options?.length) {
    kb.push(f.options.slice(0, 8).map((o, i) => button({ text: String(o), data: cb('inp', i) }, ctx.st.em)));
  }
  kb.push([btn(ctx, 'btn_cancel', cb('p', st.productId), 'cancel', 'danger')]);
  await show(ctx, tr(ctx, 'input_prompt', { label: fieldLabel(ctx, f), hint, step: st.idx + 1, steps: ask.length }), kb, { forceNew: !ctx.callbackQuery });
}

/** Text answer for the current input field. */
export async function onInputText(ctx: BotContext, text: string, data: Record<string, unknown>): Promise<void> {
  await acceptInput(ctx, data as unknown as InputState, text, null);
}

/** Option button for the current input field (inp:<optionIndex>). */
export async function onInputOption(ctx: BotContext, optionIdx: number): Promise<void> {
  const st = ctx.st.user.state;
  if (st?.kind !== 'await_input' || !st.data) {
    await answer(ctx, tr(ctx, 'err_expired'), true);
    return;
  }
  await acceptInput(ctx, st.data as unknown as InputState, null, optionIdx);
}

async function acceptInput(ctx: BotContext, st: InputState, text: string | null, optionIdx: number | null): Promise<void> {
  const ask = await getAsk(ctx, st.productId);
  if (!ask || !ask[st.idx]) {
    await setState(ctx, null);
    await placeOrder(ctx, st);
    return;
  }
  const f = ask[st.idx];
  let value: unknown;
  if (optionIdx != null && f.options?.length) {
    value = f.options[optionIdx];
  } else if (text != null) {
    if (f.per_unit && st.qty > 1) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length !== st.qty) {
        await ctx.reply(tr(ctx, 'input_wrong_count', { n: st.qty }), { parse_mode: 'HTML' });
        return;
      }
      if (new Set(lines).size !== lines.length) {
        await ctx.reply(tr(ctx, 'err_INPUT_DUPLICATE'), { parse_mode: 'HTML' });
        return;
      }
      value = lines;
    } else {
      const v = text.trim();
      if (f.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        await ctx.reply(tr(ctx, 'input_invalid_email'), { parse_mode: 'HTML' });
        return;
      }
      if (f.options?.length && !f.options.map(String).includes(v)) {
        await ctx.reply(tr(ctx, 'err_INPUT_INVALID'), { parse_mode: 'HTML' });
        return;
      }
      value = f.per_unit ? [v] : v;
    }
  } else return;

  const next: InputState = { ...st, idx: st.idx + 1, values: { ...st.values, [f.key]: value } };
  if (next.idx < ask.length) {
    await askInput(ctx, next, ask);
    return;
  }
  await setState(ctx, null);
  await placeOrder(ctx, next);
}

/** Create the order and show the checkout. */
export async function placeOrder(ctx: BotContext, st: { productId: string; qty: number; values: Record<string, unknown>; promo?: string | null }): Promise<void> {
  try {
    const order = await createOrder(ctx.st.app, {
      user: ctx.st.user,
      productId: st.productId,
      quantity: st.qty,
      inputs: st.values,
      promoCode: st.promo ?? null,
    });
    await showCheckout(ctx, order);
  } catch (e) {
    const msg = errorText(ctx, e);
    if (ctx.callbackQuery) await answer(ctx, plain(msg), true);
    else await ctx.reply(msg, { parse_mode: 'HTML' });
    if (!(e instanceof OrderError && e.code.startsWith('PROMO'))) await showProduct(ctx, st.productId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout
// ─────────────────────────────────────────────────────────────────────────────

export async function showCheckout(ctx: BotContext, order: OrderRow): Promise<void> {
  const { env, s, em } = ctx.st;
  const user = (await getUser(env, ctx.st.user.id)) ?? ctx.st.user;
  ctx.st.user.balance = user.balance;
  const view = order.product_id ? await getProductView(env, s, order.product_id, user) : null;
  const product = view?.product;

  const lines: string[] = [];
  lines.push(`${product ? productEmojiHtml(ctx, product) : em.html('product')} <b>${escapeHtml(product ? loc(product, 'name', user.lang) : order.product_name)}</b> × ${order.quantity}`);
  if (order.warranty_days > 0) lines.push(tr(ctx, 'checkout_warranty_line', { warranty: warrantyText(ctx, order.warranty_days) }));
  const origSubtotal = round2(Number(order.original_unit_price) * order.quantity);
  const pct = discountPercent(Number(order.subtotal), origSubtotal);
  if (pct > 0) {
    const label = Number(order.user_discount_percent) > 0 ? tr(ctx, 'label_special') : tr(ctx, 'label_sale');
    lines.push(tr(ctx, 'checkout_discount_line', { label, p: pct, saved: fmtUsd(origSubtotal - Number(order.subtotal)) }));
  }
  if (order.promo_code && Number(order.discount_amount) > 0) {
    lines.push(tr(ctx, 'checkout_promo_line', { code: order.promo_code, amount: fmtUsd(order.discount_amount) }));
  }
  const totalHtml = priceHtml(Number(order.total), origSubtotal > Number(order.total) ? origSubtotal : null);
  lines.push(tr(ctx, 'checkout_total_line', { total: raw(totalHtml) }));

  const balance = Number(user.balance);
  const missing = round2(Math.max(0, Number(order.total) - balance));
  const html = tr(ctx, 'checkout', {
    summary: raw(lines.join('\n')),
    balance: fmtUsd(balance),
    balance_line: raw(missing > 0 ? tr(ctx, 'checkout_missing', { missing: fmtUsd(missing) }) : tr(ctx, 'checkout_enough')),
  });

  const kb: InlineKeyboard = [];
  if (missing <= 0) {
    kb.push([btn(ctx, 'btn_pay_wallet', cb('buy', order.id), 'wallet', 'success', { amount: fmtUsd(order.total) })]);
  } else {
    const gws = enabledGateways(s);
    if (gws.length) {
      kb.push([button({ text: tr(ctx, 'btn_add_to_wallet', { amount: fmtUsd(missing) }), emoji: 'deposit', data: cb('dep', 'o', order.id), style: 'primary' }, em)]);
      for (const g of gws) kb.push([btn(ctx, `pay_with_${g.method}`, cb('pay', order.id, g.method), methodEmoji(g.method))]);
    } else {
      kb.push([btn(ctx, 'btn_deposit', 'dep', 'deposit', 'primary')]);
    }
  }
  if (s.features.promo_codes && !order.promo_code) kb.push([btn(ctx, 'btn_promo', cb('promo', order.id), 'promo')]);
  kb.push([
    btn(ctx, 'btn_back', cb('bk', order.id), 'back', s.bot.nav_style),
    btn(ctx, 'btn_cancel', cb('cancel', order.id), 'cancel', 'danger'),
  ]);
  await show(ctx, html, kb);
}

export function methodEmoji(m: DepositMethod): string {
  return m === 'binance_pay' || m === 'binance_id' ? 'binance' : m === 'nowpayments' ? 'usdt' : m === 'shamcash' ? 'shamcash' : 'deposit';
}

async function ownPendingOrder(ctx: BotContext, orderId: number): Promise<OrderRow | null> {
  const order = await getOrder(ctx.st.env, orderId);
  if (!order || order.user_id !== ctx.st.user.id) return null;
  return order;
}

/** buy:<orderId> — pay from the wallet. */
export async function payWithWallet(ctx: BotContext, orderId: number): Promise<void> {
  const order = await ownPendingOrder(ctx, orderId);
  if (!order) return void (await answer(ctx, tr(ctx, 'err_ORDER_NOT_FOUND'), true));
  if (order.status !== 'pending_payment') return void (await answer(ctx, tr(ctx, 'err_ORDER_NOT_PENDING'), true));
  const res = await payOrderWithWallet(ctx.st.app, orderId);
  if (res.ok) {
    await answer(ctx);
    await show(ctx, tr(ctx, 'pay_processing', { code: res.order.code, product: res.order.product_name }), [homeRow(ctx)]);
    return;
  }
  if (res.code === 'INSUFFICIENT_BALANCE') {
    await answer(ctx, plain(tr(ctx, 'err_INSUFFICIENT_BALANCE')), true);
    if (res.order) await showCheckout(ctx, res.order);
    return;
  }
  await answer(ctx, plain(errorText(ctx, new Error(res.code))), true);
}

/** pay:<orderId>:<method> and dep:o:<orderId> — top up the missing amount for an order. */
export async function payWithGateway(ctx: BotContext, orderId: number, method: DepositMethod | null): Promise<void> {
  const { s } = ctx.st;
  const order = await ownPendingOrder(ctx, orderId);
  if (!order || order.status !== 'pending_payment') return void (await answer(ctx, tr(ctx, 'err_ORDER_NOT_PENDING'), true));
  const user = (await getUser(ctx.st.env, ctx.st.user.id)) ?? ctx.st.user;
  const missing = round2(Math.max(0, Number(order.total) - Number(user.balance)));
  if (missing <= 0) return payWithWallet(ctx, orderId);

  if (!method) {
    // list methods for this order
    const kb: InlineKeyboard = enabledGateways(s).map((g) => [btn(ctx, `pay_with_${g.method}`, cb('pay', order.id, g.method), methodEmoji(g.method))]);
    kb.push([btn(ctx, 'btn_back', cb('ck', order.id), 'back', s.bot.nav_style)]);
    await show(ctx, tr(ctx, 'deposit_choose_method_order', { amount: fmtUsd(missing), code: order.code }), kb);
    return;
  }

  let gw;
  try {
    gw = getGateway(method);
  } catch {
    gw = null;
  }
  if (!gw || !gw.isEnabled(s)) return void (await answer(ctx, tr(ctx, 'err_METHOD_DISABLED'), true));
  const amount = round2(Math.max(missing, gw.minAmount(s), s.payments.min_deposit));
  try {
    const ins = await createDeposit(ctx.st.app, method, { user, amountUsd: amount, orderId: order.id, lang: user.lang });
    await answer(ctx);
    await renderDepositInstructions(ctx, ins, { amountNote: amount > missing ? tr(ctx, 'deposit_min_note', { amount: fmtUsd(amount), missing: fmtUsd(missing) }) : '' });
  } catch (e) {
    await answer(ctx, plain(errorText(ctx, e)), true);
  }
}

/** promo:<orderId> — ask for a promo code. */
export async function askPromo(ctx: BotContext, orderId: number): Promise<void> {
  const order = await ownPendingOrder(ctx, orderId);
  if (!order || order.status !== 'pending_payment') return void (await answer(ctx, tr(ctx, 'err_ORDER_NOT_PENDING'), true));
  await setState(ctx, { kind: 'await_promo', data: { orderId } });
  await show(ctx, tr(ctx, 'promo_prompt'), [[btn(ctx, 'btn_back', cb('ck', orderId), 'back', ctx.st.s.bot.nav_style)]]);
}

export async function onPromoText(ctx: BotContext, text: string, data: Record<string, unknown>): Promise<void> {
  const orderId = Number(data.orderId);
  const order = await ownPendingOrder(ctx, orderId);
  await setState(ctx, null);
  if (!order || order.status !== 'pending_payment' || !order.product_id) {
    await ctx.reply(tr(ctx, 'err_ORDER_NOT_PENDING'), { parse_mode: 'HTML' });
    return;
  }
  try {
    const next = await createOrder(ctx.st.app, {
      user: ctx.st.user,
      productId: order.product_id,
      quantity: order.quantity,
      inputs: order.inputs,
      promoCode: text.trim(),
    });
    await cancelPendingOrder(ctx.st.env, order.id, ctx.st.user.id);
    await ctx.reply(tr(ctx, 'promo_applied', { code: next.promo_code ?? text.trim(), amount: fmtUsd(next.discount_amount) }), { parse_mode: 'HTML' });
    await showCheckout(ctx, next);
  } catch (e) {
    await ctx.reply(errorText(ctx, e), { parse_mode: 'HTML' });
    await showCheckout(ctx, order);
  }
}

/** ck:<orderId> — re-open the checkout. */
export async function reopenCheckout(ctx: BotContext, orderId: number): Promise<void> {
  await setState(ctx, null);
  const order = await ownPendingOrder(ctx, orderId);
  if (!order || order.status !== 'pending_payment') return void (await answer(ctx, tr(ctx, 'err_ORDER_NOT_PENDING'), true));
  await showCheckout(ctx, order);
}

/** cancel:<orderId> (→ home) and bk:<orderId> (→ product). */
export async function cancelCheckout(ctx: BotContext, orderId: number, backToProduct: boolean): Promise<void> {
  const order = await ownPendingOrder(ctx, orderId);
  if (order?.status === 'pending_payment') await cancelPendingOrder(ctx.st.env, orderId, ctx.st.user.id);
  if (backToProduct && order?.product_id) {
    await showProduct(ctx, order.product_id);
    return;
  }
  await answer(ctx, tr(ctx, 'order_cancelled'));
  const { showHome } = await import('./home');
  await showHome(ctx);
}

/** Custom quantity text. */
export async function onQtyText(ctx: BotContext, text: string, data: Record<string, unknown>): Promise<void> {
  const productId = String(data.productId);
  const v = await getProductView(ctx.st.env, ctx.st.s, productId, ctx.st.user);
  if (!v) {
    await setState(ctx, null);
    return;
  }
  const max = Math.min(v.product.max_qty, v.pricing.available ?? Number.MAX_SAFE_INTEGER);
  const qty = Number(text.trim());
  if (!Number.isInteger(qty) || qty < v.product.min_qty || qty > max) {
    await ctx.reply(tr(ctx, 'qty_invalid', { min: v.product.min_qty, max }), { parse_mode: 'HTML' });
    return;
  }
  await setState(ctx, null);
  await chooseQuantity(ctx, productId, qty);
}

/** qc:<productId> — ask for a custom quantity. */
export async function askCustomQty(ctx: BotContext, productId: string): Promise<void> {
  const v = await getProductView(ctx.st.env, ctx.st.s, productId, ctx.st.user);
  if (!v) return;
  const max = Math.min(v.product.max_qty, v.pricing.available ?? Number.MAX_SAFE_INTEGER);
  await setState(ctx, { kind: 'await_qty', data: { productId } });
  await show(ctx, tr(ctx, 'qty_custom_prompt', { min: v.product.min_qty, max }), [[btn(ctx, 'btn_back_to_product', cb('p', productId), 'back', ctx.st.s.bot.nav_style)]]);
}
