import type { AppCtx, Env } from '../env';
import type { AppSettings } from '../lib/settings';
import type { DepositRow } from '../types';
import type { CheckResult, DepositInstructions, PaymentGateway } from './types';
import { getSecret } from '../lib/settings';
import { hmacSha256Hex } from '../lib/crypto';
import { db, must } from '../lib/db';
import { getEmojiResolver } from '../lib/emoji';
import { escapeHtml, raw, t } from '../lib/i18n';
import { fmtUsd, round2 } from '../lib/money';
import { fetchJson, GatewayError, grossAmount, fmtAmount, minutesLeft, patchDeposit, type GatewayInput } from './util';

// Personal Binance Pay ID transfers (no merchant account). The customer sends USDT to
// our Pay ID; we find the transfer in the Pay history with a read-only API key, matched
// by a unique amount (random cents), the reference in the note, or the Order ID the
// customer pastes.

const API = 'https://api.binance.com';

export interface PayTransaction {
  orderType?: string;
  transactionId: string;
  transactionTime: number;
  amount: string;
  currency: string;
  note?: string;
  walletType?: number;
  payerInfo?: { name?: string; binanceId?: number | string; accountId?: number | string };
  fundsDetail?: { currency: string; amount: string }[];
}

async function credentials(env: Env): Promise<{ apiKey: string; secret: string } | null> {
  const [apiKey, secret] = await Promise.all([getSecret(env, 'binance_api_key'), getSecret(env, 'binance_api_secret')]);
  return apiKey && secret ? { apiKey, secret } : null;
}

/** Signed GET /sapi/v1/pay/transactions (Pay trade history, newest first, max 100). */
export async function fetchPayTransactions(env: Env, startTime: number): Promise<PayTransaction[]> {
  const creds = await credentials(env);
  if (!creds) throw new GatewayError('NOT_CONFIGURED');
  const params = new URLSearchParams({
    startTime: String(Math.floor(startTime)),
    limit: '100',
    recvWindow: '10000',
    timestamp: String(Date.now()),
  });
  const signature = await hmacSha256Hex(creds.secret, params.toString());
  params.set('signature', signature);
  const res = await fetchJson<{ code: string; message?: string; data?: PayTransaction[]; success?: boolean }>(
    `${API}/sapi/v1/pay/transactions?${params}`,
    { headers: { 'X-MBX-APIKEY': creds.apiKey } },
  );
  if (res.code !== '000000' && res.success !== true) throw new GatewayError(`Binance pay history: ${res.message ?? res.code}`, undefined, res);
  return res.data ?? [];
}

function txAmountUsdt(tx: PayTransaction): number {
  if (tx.currency?.toUpperCase() === 'USDT') return Number(tx.amount);
  const f = tx.fundsDetail?.find((x) => x.currency?.toUpperCase() === 'USDT');
  return f ? Number(f.amount) : NaN;
}

export type MatchResult =
  | { kind: 'paid'; tx: PayTransaction; received: number }
  | { kind: 'partial'; tx: PayTransaction; received: number }
  | null;

/**
 * Find the transfer for a deposit. Pure (no I/O) so it can be unit tested.
 *  1. explicit transaction / order id pasted by the customer (proof_text)
 *  2. reference code in the transfer note
 *  3. exact amount (only trusted when unique amounts are enabled)
 * Transactions in `usedIds` (credited to another deposit) are ignored.
 */
export function matchTransaction(
  deposit: Pick<DepositRow, 'pay_amount' | 'reference' | 'proof_text' | 'created_at'>,
  txs: PayTransaction[],
  usedIds: Set<string>,
  opts: { trustAmount: boolean },
): MatchResult {
  const since = new Date(deposit.created_at).getTime() - 5 * 60_000;
  const expected = Number(deposit.pay_amount ?? 0);
  const candidates = txs.filter((tx) => {
    const amt = txAmountUsdt(tx);
    return !usedIds.has(String(tx.transactionId)) && isFinite(amt) && amt > 0 && Number(tx.transactionTime) >= since;
  });
  const result = (tx: PayTransaction): MatchResult => {
    const received = txAmountUsdt(tx);
    return received + 1e-6 >= expected ? { kind: 'paid', tx, received } : { kind: 'partial', tx, received };
  };

  const proof = deposit.proof_text?.replace(/\s+/g, '');
  if (proof) {
    const tx = candidates.find((x) => String(x.transactionId) === proof);
    if (tx) return result(tx);
  }
  if (deposit.reference) {
    const ref = deposit.reference.toUpperCase();
    const tx = candidates.find((x) => (x.note ?? '').toUpperCase().includes(ref));
    if (tx) return result(tx);
  }
  if (opts.trustAmount && expected > 0) {
    const tx = candidates.find((x) => Math.abs(txAmountUsdt(x) - expected) < 1e-6);
    if (tx) return { kind: 'paid', tx, received: txAmountUsdt(tx) };
  }
  return null;
}

/** Transaction ids already credited to binance_id deposits. */
export async function usedTransactionIds(env: Env, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = must(await db(env).from('deposits').select('external_id').eq('method', 'binance_id').in('external_id', ids), 'used tx') as { external_id: string }[];
  return new Set(rows.map((r) => r.external_id));
}

/** Pick a pay amount whose cents make it unique among open binance_id deposits. */
async function uniqueAmount(env: Env, gross: number): Promise<number> {
  const open = must(
    await db(env).from('deposits').select('pay_amount').eq('method', 'binance_id').in('status', ['pending', 'confirming']),
    'open binance deposits',
  ) as { pay_amount: number | null }[];
  const taken = new Set(open.map((r) => Number(r.pay_amount).toFixed(2)));
  const base = Math.floor(gross * 100) / 100;
  for (let i = 0; i < 30; i++) {
    const cents = 1 + Math.floor(Math.random() * 99);
    const v = round2(base + cents / 100);
    if (!taken.has(v.toFixed(2))) return v;
  }
  // very busy: widen to 3 decimals
  for (let i = 0; i < 50; i++) {
    const v = Math.round((base + (1 + Math.floor(Math.random() * 999)) / 1000) * 1000) / 1000;
    if (!taken.has(v.toFixed(2))) return v;
  }
  return round2(base + 0.99);
}

async function create(app: AppCtx, s: AppSettings, input: GatewayInput): Promise<DepositInstructions> {
  const { env } = app;
  const cfg = s.payments.binance_id;
  if (!cfg.pay_id) throw new GatewayError('NOT_CONFIGURED');
  const d = input.deposit;
  const gross = grossAmount(d);
  const payAmount = cfg.unique_amount ? await uniqueAmount(env, gross) : gross;

  const deposit = await patchDeposit(env, d.id, { pay_amount: payAmount, pay_currency: 'USDT' });

  const em = await getEmojiResolver(env, s);
  const lang = input.lang;
  const instr = (lang === 'ar' ? cfg.instructions_ar : cfg.instructions_en) || cfg.instructions_en;
  const html = t(s, lang, 'pay_binance_id_instructions', {
    credit: fmtUsd(deposit.amount_usd),
    fee_line: raw(Number(deposit.fee_usd) > 0 ? t(s, lang, 'pay_fee_line', { fee: fmtUsd(deposit.fee_usd) }, em) : ''),
    amount: fmtAmount(payAmount),
    pay_id: cfg.pay_id,
    receiver_line: raw(cfg.receiver_name ? t(s, lang, 'pay_receiver_line', { name: cfg.receiver_name }, em) : ''),
    reference: deposit.reference ?? '',
    instructions: raw(instr ? `${escapeHtml(instr)}\n` : ''),
    minutes: minutesLeft(deposit.expires_at),
  }, em);

  return {
    deposit,
    html,
    copyValues: [
      { label: t(s, lang, 'pay_label_pay_id'), value: cfg.pay_id },
      { label: t(s, lang, 'pay_label_amount'), value: fmtAmount(payAmount) },
      { label: t(s, lang, 'pay_label_reference'), value: deposit.reference ?? '' },
    ],
    canCheck: true,
  };
}

/** Check one deposit against a freshly fetched history (also used by the cron with a shared history). */
export async function checkWithHistory(env: Env, s: AppSettings, deposit: DepositRow, txs: PayTransaction[]): Promise<CheckResult> {
  const used = await usedTransactionIds(env, txs.map((x) => String(x.transactionId)));
  const m = matchTransaction(deposit, txs, used, { trustAmount: s.payments.binance_id.unique_amount });
  if (!m) {
    if (deposit.expires_at && new Date(deposit.expires_at).getTime() + 10 * 60_000 < Date.now() && deposit.status === 'pending') return { status: 'expired' };
    return { status: 'pending' };
  }
  const meta = { transactionId: m.tx.transactionId, received: m.received, payer: m.tx.payerInfo ?? null, note: m.tx.note ?? null };
  if (m.kind === 'partial') return { status: 'pending', externalId: String(m.tx.transactionId), meta: { ...meta, partial: true } };
  return { status: 'paid', creditUsd: Number(deposit.amount_usd), externalId: String(m.tx.transactionId), meta };
}

async function check(app: AppCtx, s: AppSettings, deposit: DepositRow): Promise<CheckResult> {
  const txs = await fetchPayTransactions(app.env, new Date(deposit.created_at).getTime() - 5 * 60_000);
  return checkWithHistory(app.env, s, deposit, txs);
}

export const binanceId: PaymentGateway = {
  method: 'binance_id',
  isEnabled: (s) => s.payments.binance_id.enabled && !!s.payments.binance_id.pay_id,
  minAmount: (s) => s.payments.min_deposit,
  create: create as PaymentGateway['create'],
  check,
};
