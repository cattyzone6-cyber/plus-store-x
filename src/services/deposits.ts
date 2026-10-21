import type { AppCtx, Env } from '../env';
import type { DepositMethod, DepositRow, Lang } from '../types';
import type { CheckResult, CreateDepositInput, DepositInstructions } from '../payments/types';
import { getSettings, type AppSettings } from '../lib/settings';
import { db, must, rpc } from '../lib/db';
import { randomCode } from '../lib/crypto';
import { fmtUsd, round2 } from '../lib/money';
import { enqueue } from '../lib/jobs';
import { getEmojiResolver, type EmojiResolver } from '../lib/emoji';
import { escapeHtml, t } from '../lib/i18n';
import { button, sendMessage, sendPhoto, type InlineKeyboard } from '../lib/telegram';
import { AUTO_METHODS, getGateway } from '../payments';
import { fetchPayTransactions, checkWithHistory } from '../payments/binanceId';
import { GatewayError, fmtAmount, patchDeposit } from '../payments/util';
import { audit, notifyAdmins, notifyUser } from './notify';
import { cancelPendingOrder, getOrder, payOrderWithWallet } from './orders';
import { getUser } from './users';

export type DepositErrorCode = 'METHOD_DISABLED' | 'BELOW_MIN' | 'ABOVE_MAX' | 'NOT_CONFIGURED' | 'GATEWAY_ERROR' | 'NOT_FOUND';

export class DepositError extends Error {
  constructor(public readonly code: DepositErrorCode, public readonly vars: Record<string, unknown> = {}, message?: string) {
    super(message ?? code);
  }
}

const ERROR_TEXT: Record<DepositErrorCode, string> = {
  METHOD_DISABLED: 'pay_method_disabled',
  BELOW_MIN: 'pay_below_min',
  ABOVE_MAX: 'pay_above_max',
  NOT_CONFIGURED: 'pay_not_configured',
  GATEWAY_ERROR: 'pay_gateway_error',
  NOT_FOUND: 'pay_method_disabled',
};

/** Customer-facing text for a DepositError. */
export function depositErrorText(s: AppSettings, lang: Lang, err: DepositError, em?: EmojiResolver): string {
  return t(s, lang, ERROR_TEXT[err.code], err.vars, em);
}

function feePercent(s: AppSettings, method: DepositMethod): number {
  switch (method) {
    case 'binance_pay': return s.payments.binance_pay.fee_percent;
    case 'binance_id': return s.payments.binance_id.fee_percent;
    case 'nowpayments': return s.payments.nowpayments.fee_percent;
    case 'shamcash': return s.payments.shamcash.fee_percent;
    default: return 0;
  }
}

export async function getDeposit(env: Env, id: string): Promise<DepositRow | null> {
  return must(await db(env).from('deposits').select('*').eq('id', id).maybeSingle(), 'deposit') as DepositRow | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

/** Validate limits, insert the deposit and ask the gateway for payment instructions. */
export async function createDeposit(app: AppCtx, method: DepositMethod, input: CreateDepositInput): Promise<DepositInstructions> {
  const { env } = app;
  const s = await getSettings(env);
  const gw = getGateway(method);
  if (!gw.isEnabled(s)) throw new DepositError('METHOD_DISABLED');

  const amount = round2(input.amountUsd);
  const min = gw.minAmount(s);
  if (!(amount >= min)) throw new DepositError('BELOW_MIN', { min: fmtUsd(min) });
  if (amount > s.payments.max_deposit) throw new DepositError('ABOVE_MAX', { max: fmtUsd(s.payments.max_deposit) });

  const fee = round2((amount * Math.max(0, feePercent(s, method))) / 100);
  const deposit = must(
    await db(env).from('deposits').insert({
      user_id: input.user.id,
      method,
      amount_usd: amount,
      fee_usd: fee,
      status: 'pending',
      reference: `D${randomCode(9)}`,
      order_id: input.orderId ?? null,
      expires_at: new Date(Date.now() + s.payments.deposit_expire_minutes * 60_000).toISOString(),
    }).select('*').single(),
    'deposit insert',
  ) as DepositRow;

  try {
    return await gw.create(app, s, { ...input, deposit } as CreateDepositInput);
  } catch (e) {
    const notConfigured = e instanceof GatewayError && e.message === 'NOT_CONFIGURED';
    await patchDeposit(env, deposit.id, { status: 'failed', meta: { ...deposit.meta, error: (e as Error).message.slice(0, 500) } });
    if (!notConfigured) console.error('deposit create failed', method, e);
    throw new DepositError(notConfigured ? 'NOT_CONFIGURED' : 'GATEWAY_ERROR', {}, (e as Error).message);
  }
}

/** Customer cancels a pending deposit (and its linked pending order). */
export async function cancelDeposit(env: Env, depositId: string, userId?: number): Promise<boolean> {
  let q = db(env).from('deposits').update({ status: 'cancelled' }).eq('id', depositId).eq('status', 'pending');
  if (userId) q = q.eq('user_id', userId);
  const rows = must(await q.select('*'), 'deposit cancel') as DepositRow[];
  if (!rows.length) return false;
  if (rows[0].order_id) await cancelPendingOrder(env, rows[0].order_id);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit
// ─────────────────────────────────────────────────────────────────────────────

/** Credit a deposit exactly once (SQL deposit_credit is idempotent). Returns true when credited now. */
export async function creditDeposit(
  app: AppCtx,
  depositId: string,
  creditUsd: number,
  opts: { externalId?: string | null; meta?: Record<string, unknown>; reviewedBy?: string | null } = {},
): Promise<boolean> {
  const s = await getSettings(app.env);
  let res: { credited: boolean };
  try {
    res = await rpc<{ credited: boolean }>(app.env, 'deposit_credit', {
      p_deposit_id: depositId,
      p_credit: round2(creditUsd),
      p_external_id: opts.externalId ?? null,
      p_meta: opts.meta ?? {},
      p_ref_percent: s.features.referrals ? s.referral.percent : 0,
      p_reviewed_by: opts.reviewedBy ?? null,
    });
  } catch (e) {
    // unique (method, external_id): this transaction was already used for another deposit
    if (/duplicate key|deposits_external_idx/i.test((e as Error).message)) {
      console.error('deposit external id reused', depositId, opts.externalId);
      return false;
    }
    throw e;
  }
  if (res.credited) await enqueue(app, { type: 'deposit_credited', depositId });
  return res.credited;
}

/** Job after a deposit was credited: messages + auto-pay the linked order. */
export async function onDepositCredited(app: AppCtx, depositId: string): Promise<void> {
  const { env } = app;
  const d = await getDeposit(env, depositId);
  if (!d || d.status !== 'paid') return;
  const [s, user] = await Promise.all([getSettings(env), getUser(env, d.user_id)]);
  if (!user) return;
  const em = await getEmojiResolver(env, s);
  const home = (lang: Lang): InlineKeyboard => [[button({ text: t(s, lang, 'btn_home'), emoji: 'home', data: 'home' }, em)]];

  await notifyUser(env, user.id, t(s, user.lang, 'pay_deposit_credited', {
    amount: fmtUsd(d.credited_amount ?? d.amount_usd),
    balance: fmtUsd(user.balance),
  }, em), home(user.lang));

  // referral bonus message
  const bonus = must(
    await db(env).from('wallet_ledger').select('user_id,amount').eq('type', 'referral').eq('ref_type', 'deposit').eq('ref_id', d.id).maybeSingle(),
    'referral ledger',
  ) as { user_id: number; amount: number } | null;
  if (bonus) {
    const ref = await getUser(env, bonus.user_id);
    if (ref) await notifyUser(env, ref.id, t(s, ref.lang, 'pay_referral_bonus', { amount: fmtUsd(bonus.amount) }, em));
  }

  await notifyAdmins(env, 'deposit_paid',
    `💰 <b>Deposit ${fmtUsd(d.credited_amount ?? d.amount_usd)}</b> via ${methodLabel(d.method)}\n` +
    `User: <code>${user.id}</code>${user.username ? ` @${escapeHtml(user.username)}` : ''}\nRef: <code>${d.reference ?? ''}</code>` +
    (bonus ? `\nReferral bonus: ${fmtUsd(bonus.amount)} → <code>${bonus.user_id}</code>` : ''));

  if (d.order_id) {
    const order = await getOrder(env, d.order_id);
    if (!order) return;
    const res = await payOrderWithWallet(app, d.order_id);
    if (res.ok) {
      await notifyUser(env, user.id, t(s, user.lang, 'pay_order_paid_after_deposit', { code: order.code }, em));
    } else if (res.code === 'INSUFFICIENT_BALANCE') {
      await notifyUser(env, user.id, t(s, user.lang, 'pay_order_still_insufficient', { code: order.code, missing: fmtUsd(res.missing ?? 0) }, em), home(user.lang));
    } else if (res.code === 'ORDER_NOT_PENDING') {
      if (order.status === 'cancelled') await notifyUser(env, user.id, t(s, user.lang, 'pay_order_not_pending', { code: order.code }, em), home(user.lang));
    } else {
      console.error('auto-pay after deposit failed', d.id, res.code);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check / poll / expire
// ─────────────────────────────────────────────────────────────────────────────

async function applyCheckResult(app: AppCtx, s: AppSettings, d: DepositRow, res: CheckResult): Promise<DepositRow> {
  const { env } = app;
  switch (res.status) {
    case 'paid':
      await creditDeposit(app, d.id, res.creditUsd ?? Number(d.amount_usd), { externalId: res.externalId ?? null, meta: res.meta ?? {} });
      break;
    case 'expired':
      if (d.status === 'pending') await expireOne(app, s, d);
      break;
    case 'failed':
      await db(env).from('deposits').update({ status: 'failed', meta: { ...d.meta, ...(res.meta ?? {}) } }).eq('id', d.id).in('status', ['pending', 'confirming']);
      if (d.order_id) await cancelPendingOrder(env, d.order_id);
      break;
    case 'pending':
      if (res.meta?.partial && !d.meta?.partial) {
        await patchDeposit(env, d.id, { status: 'confirming', meta: { ...d.meta, ...res.meta } });
        const user = await getUser(env, d.user_id);
        const em = await getEmojiResolver(env, s);
        if (user) await notifyUser(env, user.id, t(s, user.lang, 'pay_partial_review', { reference: d.reference ?? '' }, em));
        await notifyAdmins(env, 'deposit_review',
          `⚠️ <b>Partial payment</b> — ${methodLabel(d.method)}\nRef <code>${d.reference}</code>, expected ${fmtAmount(d.pay_amount)} ${d.pay_currency ?? ''}, received ${fmtAmount(Number(res.meta.received ?? res.meta.actually_paid ?? 0))}\n` +
          `User: <code>${d.user_id}</code>\nApprove with a custom amount in the admin panel → Deposits.`,
          reviewKeyboard(d.id));
      }
      break;
  }
  return (await getDeposit(env, d.id)) ?? d;
}

/** Verify a pending deposit now ("I've paid" button). Returns the latest row. */
export async function checkDeposit(app: AppCtx, depositId: string): Promise<DepositRow> {
  const d = await getDeposit(app.env, depositId);
  if (!d) throw new DepositError('NOT_FOUND');
  if (!['pending', 'confirming'].includes(d.status)) return d;
  const gw = getGateway(d.method);
  if (!gw.check) return d;
  const s = await getSettings(app.env);
  let res: CheckResult;
  try {
    res = await gw.check(app, s, d);
  } catch (e) {
    console.error('deposit check failed', d.id, (e as Error).message);
    return d;
  }
  return applyCheckResult(app, s, d, res);
}

/** Cron: verify open auto-method deposits from the last 24h. */
export async function pollPendingDeposits(app: AppCtx): Promise<void> {
  const { env } = app;
  const s = await getSettings(env);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = (must(
    await db(env).from('deposits').select('*').in('status', ['pending', 'confirming']).in('method', AUTO_METHODS)
      .gte('created_at', since).order('created_at', { ascending: true }).limit(40),
    'pending deposits',
  ) as DepositRow[]).filter((d) => !d.meta?.partial);

  // Binance Pay ID: one history call shared by every open deposit
  const bid = rows.filter((d) => d.method === 'binance_id');
  if (bid.length && s.payments.binance_id.enabled) {
    try {
      const start = Math.min(...bid.map((d) => new Date(d.created_at).getTime())) - 5 * 60_000;
      const txs = await fetchPayTransactions(env, start);
      for (const d of bid) await applyCheckResult(app, s, d, await checkWithHistory(env, s, d, txs));
    } catch (e) {
      if (!(e instanceof GatewayError && e.message === 'NOT_CONFIGURED')) console.error('binance_id poll failed', (e as Error).message);
    }
  }

  for (const d of rows.filter((x) => x.method !== 'binance_id').slice(0, 10)) {
    await checkDeposit(app, d.id);
  }
}

async function expireOne(app: AppCtx, s: AppSettings, d: DepositRow): Promise<void> {
  const { env } = app;
  const rows = must(await db(env).from('deposits').update({ status: 'expired' }).eq('id', d.id).eq('status', 'pending').select('id'), 'expire') as { id: string }[];
  if (!rows.length) return;
  if (d.order_id) await cancelPendingOrder(env, d.order_id);
  const user = await getUser(env, d.user_id);
  if (user) {
    const em = await getEmojiResolver(env, s);
    await notifyUser(env, user.id, t(s, user.lang, 'pay_deposit_expired', { reference: d.reference ?? '', amount: fmtUsd(d.amount_usd) }, em));
  }
}

/** Cron: expire unpaid deposits (10 min grace after expires_at; deposits under review are kept). */
export async function expireDeposits(app: AppCtx): Promise<void> {
  const { env } = app;
  const s = await getSettings(env);
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const rows = must(
    await db(env).from('deposits').select('*').eq('status', 'pending').lt('expires_at', cutoff).limit(50),
    'expired deposits',
  ) as DepositRow[];
  for (const d of rows) await expireOne(app, s, d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual review (ShamCash / unmatched Binance transfers)
// ─────────────────────────────────────────────────────────────────────────────

function methodLabel(m: DepositMethod): string {
  return { binance_pay: 'Binance Pay', binance_id: 'Binance Pay ID', nowpayments: 'USDT (NOWPayments)', shamcash: 'ShamCash', admin: 'Admin' }[m] ?? m;
}

function reviewKeyboard(depositId: string): InlineKeyboard {
  return [[
    { text: '✅ Approve', callback_data: `adm:dep_ok:${depositId}`, style: 'success' },
    { text: '❌ Reject', callback_data: `adm:dep_no:${depositId}`, style: 'danger' },
  ]];
}

async function adminTargets(env: Env, s: AppSettings): Promise<(string | number)[]> {
  if (s.notifications.chat_id) return [s.notifications.chat_id];
  const admins = must(await db(env).from('admins').select('telegram_id').not('telegram_id', 'is', null), 'admins') as { telegram_id: number }[];
  return admins.map((a) => a.telegram_id);
}

/** Customer sends a screenshot / transaction id. Moves the deposit to review and alerts admins. */
export async function attachProof(app: AppCtx, depositId: string, proof: { fileId?: string | null; text?: string | null }): Promise<DepositRow> {
  const { env } = app;
  let d = await getDeposit(env, depositId);
  if (!d) throw new DepositError('NOT_FOUND');
  if (!['pending', 'confirming'].includes(d.status)) return d;

  d = await patchDeposit(env, d.id, {
    proof_file_id: proof.fileId ?? d.proof_file_id,
    proof_text: proof.text?.trim().slice(0, 500) || d.proof_text,
  });

  // Binance Pay ID: a pasted Order ID may match automatically
  if (d.method === 'binance_id' && proof.text) {
    d = await checkDeposit(app, d.id);
    if (d.status === 'paid') return d;
  }

  const s = await getSettings(env);
  d = await patchDeposit(env, d.id, { status: 'confirming' });
  const user = await getUser(env, d.user_id);

  if (s.notifications.events.deposit_review) {
    const caption =
      `💳 <b>Deposit review</b> — ${methodLabel(d.method)}\n` +
      `Credit: <b>${fmtUsd(d.amount_usd)}</b>${Number(d.fee_usd) > 0 ? ` (+fee ${fmtUsd(d.fee_usd)})` : ''}\n` +
      `Customer must send: <b>${fmtAmount(d.pay_amount)} ${d.pay_currency ?? ''}</b>\n` +
      `Ref: <code>${d.reference ?? ''}</code>\n` +
      `User: <code>${d.user_id}</code>${user?.username ? ` @${escapeHtml(user.username)}` : ''}${user?.first_name ? ` (${escapeHtml(user.first_name)})` : ''}` +
      (d.proof_text ? `\nProof: <code>${escapeHtml(d.proof_text)}</code>` : '');
    const kb = reviewKeyboard(d.id);
    for (const chat of await adminTargets(env, s)) {
      try {
        if (d.proof_file_id) await sendPhoto(env, chat, d.proof_file_id, caption, { keyboard: kb });
        else await sendMessage(env, chat, caption, { keyboard: kb });
      } catch (e) {
        // proof may be a document rather than a photo: fall back to text
        await sendMessage(env, chat, `${caption}\n<i>(proof attached as file in the bot chat)</i>`, { keyboard: kb }).catch((err) => console.error('review notify failed', chat, err));
      }
    }
  }

  if (user) {
    const em = await getEmojiResolver(env, s);
    await notifyUser(env, user.id, t(s, user.lang, 'pay_proof_received', { reference: d.reference ?? '' }, em));
  }
  return d;
}

/** Admin approves a manual deposit (optionally with a different credit amount). */
export async function approveManualDeposit(app: AppCtx, depositId: string, adminId: string | null, creditUsd?: number): Promise<DepositRow> {
  const d = await getDeposit(app.env, depositId);
  if (!d) throw new DepositError('NOT_FOUND');
  if (d.status === 'paid') return d;
  const credit = creditUsd != null && creditUsd > 0 ? creditUsd : Number(d.amount_usd);
  await creditDeposit(app, d.id, credit, { reviewedBy: adminId, meta: { approved_manually: true } });
  await audit(app.env, { admin_id: adminId, action: 'deposit.approve', entity: 'deposit', entity_id: d.id, data: { credit } });
  return (await getDeposit(app.env, d.id)) ?? d;
}

/** Admin rejects a deposit; the customer is told and a linked pending order is cancelled. */
export async function rejectDeposit(app: AppCtx, depositId: string, adminId: string | null, note?: string): Promise<DepositRow> {
  const { env } = app;
  const rows = must(
    await db(env).from('deposits').update({ status: 'rejected', reviewed_by: adminId, review_note: note ?? null })
      .eq('id', depositId).in('status', ['pending', 'confirming']).select('*'),
    'deposit reject',
  ) as DepositRow[];
  const d = rows[0] ?? (await getDeposit(env, depositId));
  if (!d) throw new DepositError('NOT_FOUND');
  if (!rows.length) return d;

  if (d.order_id) await cancelPendingOrder(env, d.order_id);
  await audit(env, { admin_id: adminId, action: 'deposit.reject', entity: 'deposit', entity_id: d.id, data: { note } });
  const [s, user] = await Promise.all([getSettings(env), getUser(env, d.user_id)]);
  if (user) {
    const em = await getEmojiResolver(env, s);
    await notifyUser(env, user.id, t(s, user.lang, 'pay_deposit_rejected', {
      reference: d.reference ?? '',
      amount: fmtUsd(d.amount_usd),
      note: note ? `\n${note}` : '',
    }, em));
  }
  return d;
}

export async function listUserDeposits(env: Env, userId: number, limit = 10): Promise<DepositRow[]> {
  return must(
    await db(env).from('deposits').select('*').eq('user_id', userId).neq('status', 'failed')
      .order('created_at', { ascending: false }).limit(limit),
    'user deposits',
  ) as DepositRow[];
}
