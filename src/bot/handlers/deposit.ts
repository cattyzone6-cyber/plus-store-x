import type { BotContext } from '../context';
import { answer, plain, setState, show, tr } from '../context';
import { backHomeRow, btn, cb, fmtDate, homeRow } from '../ui';
import { errorText, methodEmoji } from './checkout';
import { enabledGateways, getGateway } from '../../payments';
import { attachProof, cancelDeposit, checkDeposit, createDeposit, getDeposit, listUserDeposits } from '../../services/deposits';
import type { DepositInstructions } from '../../payments/types';
import { getUser } from '../../services/users';
import { fmtUsd, round2 } from '../../lib/money';
import { raw } from '../../lib/i18n';
import { button, grid, type InlineKeyboard } from '../../lib/telegram';
import type { DepositMethod, DepositRow } from '../../types';

const STATUS_ICON: Record<DepositRow['status'], string> = {
  pending: '🕓', confirming: '⏳', paid: '✅', expired: '⌛', rejected: '❌', cancelled: '✖️', failed: '⚠️',
};

export async function showDepositMenu(ctx: BotContext): Promise<void> {
  const { env } = ctx.st;
  await setState(ctx, null);
  const user = (await getUser(env, ctx.st.user.id)) ?? ctx.st.user;
  const deposits = await listUserDeposits(env, user.id, 3).catch(() => [] as DepositRow[]);
  const activity = deposits.length
    ? deposits.map((d) => `${STATUS_ICON[d.status]} +${fmtUsd(d.credited_amount ?? d.amount_usd)} · ${tr(ctx, `method_${d.method}`)} · ${fmtDate(d.created_at, user.lang)}`).join('\n')
    : tr(ctx, 'deposit_no_activity');
  const html = tr(ctx, 'deposit_menu', { balance: fmtUsd(user.balance).replace('$', ''), activity: raw(activity) });
  await show(ctx, html, [
    [btn(ctx, 'btn_deposit_funds', 'dep:f', 'deposit', 'primary')],
    backHomeRow(ctx, 'prof'),
  ]);
}

export async function showMethods(ctx: BotContext): Promise<void> {
  const gws = enabledGateways(ctx.st.s);
  if (!gws.length) {
    await show(ctx, tr(ctx, 'deposit_no_methods'), [backHomeRow(ctx, 'dep')]);
    return;
  }
  const kb: InlineKeyboard = gws.map((g) => [btn(ctx, `method_${g.method}`, cb('dep', 'm', g.method), methodEmoji(g.method))]);
  kb.push(backHomeRow(ctx, 'dep'));
  await show(ctx, tr(ctx, 'deposit_choose_method'), kb);
}

function methodMin(ctx: BotContext, method: DepositMethod): number {
  return Math.max(getGateway(method).minAmount(ctx.st.s), ctx.st.s.payments.min_deposit);
}

export async function showAmounts(ctx: BotContext, method: DepositMethod): Promise<void> {
  const { s, em } = ctx.st;
  let min: number;
  try {
    if (!getGateway(method).isEnabled(s)) throw new Error('disabled');
    min = methodMin(ctx, method);
  } catch {
    await answer(ctx, tr(ctx, 'err_METHOD_DISABLED'), true);
    return;
  }
  const presets = s.payments.deposit_presets.filter((a) => a >= min && a <= s.payments.max_deposit);
  const kb = grid(presets.map((a) => button({ text: fmtUsd(a), data: cb('dep', 'a', method, a) }, em)), 3);
  kb.push([btn(ctx, 'btn_custom_amount', cb('dep', 'c', method), 'quantity')]);
  kb.push(backHomeRow(ctx, 'dep:f'));
  await show(ctx, tr(ctx, 'deposit_choose_amount', { method: tr(ctx, `method_${method}`), min: fmtUsd(min) }), kb);
}

export async function askCustomAmount(ctx: BotContext, method: DepositMethod): Promise<void> {
  await setState(ctx, { kind: 'await_deposit_amount', data: { method } });
  await show(ctx, tr(ctx, 'deposit_custom_prompt', { min: fmtUsd(methodMin(ctx, method)), max: fmtUsd(ctx.st.s.payments.max_deposit) }), [backHomeRow(ctx, cb('dep', 'm', method))]);
}

export async function onDepositAmountText(ctx: BotContext, text: string, data: Record<string, unknown>): Promise<void> {
  const method = String(data.method) as DepositMethod;
  const amount = round2(Number(text.replace(',', '.').replace(/[^0-9.]/g, '')));
  const min = methodMin(ctx, method);
  if (!isFinite(amount) || amount < min || amount > ctx.st.s.payments.max_deposit) {
    await ctx.reply(tr(ctx, 'deposit_amount_invalid', { min: fmtUsd(min), max: fmtUsd(ctx.st.s.payments.max_deposit) }), { parse_mode: 'HTML' });
    return;
  }
  await setState(ctx, null);
  await startDeposit(ctx, method, amount);
}

export async function startDeposit(ctx: BotContext, method: DepositMethod, amount: number): Promise<void> {
  const { s } = ctx.st;
  const min = methodMin(ctx, method);
  if (amount < min || amount > s.payments.max_deposit) {
    await answer(ctx, plain(tr(ctx, 'deposit_amount_invalid', { min: fmtUsd(min), max: fmtUsd(s.payments.max_deposit) })), true);
    return;
  }
  try {
    const user = (await getUser(ctx.st.env, ctx.st.user.id)) ?? ctx.st.user;
    const ins = await createDeposit(ctx.st.app, method, { user, amountUsd: amount, orderId: null, lang: user.lang });
    await answer(ctx);
    await renderDepositInstructions(ctx, ins);
  } catch (e) {
    const msg = errorText(ctx, e);
    if (ctx.callbackQuery) await answer(ctx, plain(msg), true);
    else await ctx.reply(msg, { parse_mode: 'HTML' });
  }
}

/** Payment instructions screen for a freshly created deposit. */
export async function renderDepositInstructions(ctx: BotContext, ins: DepositInstructions, opts: { amountNote?: string } = {}): Promise<void> {
  const { em } = ctx.st;
  const d = ins.deposit;
  const kb: InlineKeyboard = [];
  if (ins.payUrl) kb.push([button({ text: tr(ctx, 'btn_open_payment'), emoji: 'link', url: ins.payUrl, style: 'primary' }, em)]);
  for (const c of ins.copyValues ?? []) {
    kb.push([button({ text: tr(ctx, 'btn_copy', { label: c.label }), emoji: 'key', copy: c.value }, em)]);
  }
  if (ins.needsProof) kb.push([btn(ctx, 'btn_send_proof', cb('dep', 'proof', d.id), 'download', 'success')]);
  if (ins.canCheck) kb.push([btn(ctx, 'btn_check_payment', cb('dep', 'check', d.id), 'confirm', 'success')]);
  kb.push([btn(ctx, 'btn_cancel_deposit', cb('dep', 'x', d.id), 'cancel', 'danger')]);
  const html = (opts.amountNote ? `${opts.amountNote}\n\n` : '') + ins.html;
  await show(ctx, html, kb, { imageUrl: ins.imageUrl ?? null });
}

async function ownDeposit(ctx: BotContext, id: string): Promise<DepositRow | null> {
  const d = await getDeposit(ctx.st.env, id);
  return d && d.user_id === ctx.st.user.id ? d : null;
}

/** dep:check:<id> — "I've paid". */
export async function onCheckDeposit(ctx: BotContext, id: string): Promise<void> {
  const d = await ownDeposit(ctx, id);
  if (!d) return void (await answer(ctx, tr(ctx, 'err_generic'), true));
  if (d.status === 'paid') return void (await answer(ctx, plain(tr(ctx, 'deposit_check_paid')), true));
  try {
    const res = await checkDeposit(ctx.st.app, id);
    if (res.status === 'paid') {
      await answer(ctx, plain(tr(ctx, 'deposit_check_paid')), true);
      await show(ctx, tr(ctx, 'deposit_paid_screen', { amount: fmtUsd(res.credited_amount ?? res.amount_usd) }), [homeRow(ctx)]);
    } else if (res.status === 'expired' || res.status === 'cancelled' || res.status === 'failed' || res.status === 'rejected') {
      await answer(ctx, plain(tr(ctx, 'deposit_expired')), true);
    } else {
      await answer(ctx, plain(tr(ctx, 'deposit_check_pending')), true);
    }
  } catch (e) {
    await answer(ctx, plain(errorText(ctx, e)), true);
  }
}

/** dep:x:<id> — cancel a pending deposit. */
export async function onCancelDeposit(ctx: BotContext, id: string): Promise<void> {
  await cancelDeposit(ctx.st.env, id, ctx.st.user.id);
  await setState(ctx, null);
  await answer(ctx, tr(ctx, 'deposit_cancelled'));
  await showDepositMenu(ctx);
}

/** dep:proof:<id> — ask for a screenshot / transaction id. */
export async function askProof(ctx: BotContext, id: string): Promise<void> {
  const d = await ownDeposit(ctx, id);
  if (!d || d.status !== 'pending') return void (await answer(ctx, tr(ctx, 'deposit_expired'), true));
  await setState(ctx, { kind: 'await_proof', data: { depositId: id } });
  await answer(ctx);
  await ctx.reply(tr(ctx, 'deposit_proof_prompt'), {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[btn(ctx, 'btn_cancel_deposit', cb('dep', 'x', id), 'cancel', 'danger')]] } as never,
  });
}

/** Photo / document / text received while waiting for a proof. */
export async function onProof(ctx: BotContext, data: Record<string, unknown>, proof: { fileId?: string; text?: string }): Promise<void> {
  const id = String(data.depositId);
  try {
    // attachProof tells the customer itself (pay_proof_received) or credits right away (Binance order id)
    const d = await attachProof(ctx.st.app, id, proof);
    await setState(ctx, null);
    if (d.status === 'paid') await ctx.reply(tr(ctx, 'deposit_paid_screen', { amount: fmtUsd(d.credited_amount ?? d.amount_usd) }), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [homeRow(ctx)] } as never });
  } catch (e) {
    await ctx.reply(errorText(ctx, e), { parse_mode: 'HTML' });
  }
}
