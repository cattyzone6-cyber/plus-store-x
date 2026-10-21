import type { AppCtx, Env } from '../env';
import type { AppSettings } from '../lib/settings';
import type { DepositRow } from '../types';
import type { CheckResult, DepositInstructions, PaymentGateway } from './types';
import { baseUrl, getSecret } from '../lib/settings';
import { hmacSha512Hex, safeEqual } from '../lib/crypto';
import { getEmojiResolver } from '../lib/emoji';
import { raw, t } from '../lib/i18n';
import { fmtUsd } from '../lib/money';
import { fetchJson, GatewayError, grossAmount, fmtAmount, minutesLeft, patchDeposit, type GatewayInput } from './util';

// NOWPayments crypto invoices (USDT BEP20 = pay_currency 'usdtbsc' by default).
// Docs: https://documenter.getpostman.com/view/7907941/2s93JusNJt

function apiBase(s: AppSettings): string {
  return s.payments.nowpayments.sandbox ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';
}

/** Recursively sort object keys (NOWPayments signs the key-sorted JSON). */
export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
}

export async function nowpaymentsSignature(ipnSecret: string, body: unknown): Promise<string> {
  return hmacSha512Hex(ipnSecret, JSON.stringify(sortKeysDeep(body)));
}

/** Verify header x-nowpayments-sig. Also accepts the legacy top-level-keys-only format. */
export async function verifyNowpaymentsSignature(ipnSecret: string, body: Record<string, unknown>, sig: string | null): Promise<boolean> {
  if (!sig) return false;
  const s = sig.trim().toLowerCase();
  if (safeEqual(await nowpaymentsSignature(ipnSecret, body), s)) return true;
  const legacy = await hmacSha512Hex(ipnSecret, JSON.stringify(body, Object.keys(body).sort()));
  return safeEqual(legacy, s);
}

export interface NowPayment {
  payment_id: number | string;
  payment_status: string;
  pay_address?: string;
  payin_extra_id?: string | null;
  price_amount?: number;
  price_currency?: string;
  pay_amount?: number;
  actually_paid?: number;
  pay_currency?: string;
  order_id?: string;
  network?: string;
  expiration_estimate_date?: string;
  outcome_amount?: number;
  outcome_currency?: string;
}

async function apiKey(env: Env): Promise<string> {
  const key = await getSecret(env, 'nowpayments_api_key');
  if (!key) throw new GatewayError('NOT_CONFIGURED');
  return key;
}

const NETWORK_NAMES: Record<string, string> = { bsc: 'BEP20 (BNB Smart Chain)', trx: 'TRC20 (Tron)', eth: 'ERC20 (Ethereum)', ton: 'TON', sol: 'Solana', matic: 'Polygon' };

async function create(app: AppCtx, s: AppSettings, input: GatewayInput): Promise<DepositInstructions> {
  const { env } = app;
  const d = input.deposit;
  const cfg = s.payments.nowpayments;
  const key = await apiKey(env);
  const hook = baseUrl(s);
  const gross = grossAmount(d);

  const p = await fetchJson<NowPayment>(`${apiBase(s)}/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      price_amount: gross,
      price_currency: 'usd',
      pay_currency: cfg.pay_currency || 'usdtbsc',
      order_id: d.reference ?? d.id,
      order_description: `${s.brand.name} wallet top-up ${fmtUsd(d.amount_usd)}`,
      ...(hook ? { ipn_callback_url: `${hook}/webhook/nowpayments` } : {}),
    }),
  });
  if (!p.pay_address || p.pay_amount == null) throw new GatewayError('NOWPayments returned no address', undefined, p);

  const expires = p.expiration_estimate_date ? new Date(p.expiration_estimate_date) : null;
  const deposit = await patchDeposit(env, d.id, {
    external_id: String(p.payment_id),
    pay_address: p.pay_address,
    pay_amount: Number(p.pay_amount),
    pay_currency: (p.pay_currency ?? cfg.pay_currency).toUpperCase(),
    ...(expires && !isNaN(expires.getTime()) && d.expires_at && expires < new Date(d.expires_at) ? { expires_at: expires.toISOString() } : {}),
    meta: { ...d.meta, network: p.network ?? null, payin_extra_id: p.payin_extra_id ?? null },
  });

  const em = await getEmojiResolver(env, s);
  const lang = input.lang;
  const currency = (p.pay_currency ?? cfg.pay_currency).toLowerCase().startsWith('usdt') ? 'USDT' : (p.pay_currency ?? '').toUpperCase();
  const html = t(s, lang, 'pay_nowpayments_instructions', {
    credit: fmtUsd(deposit.amount_usd),
    fee_line: raw(Number(deposit.fee_usd) > 0 ? t(s, lang, 'pay_fee_line', { fee: fmtUsd(deposit.fee_usd) }, em) : ''),
    amount: fmtAmount(p.pay_amount),
    currency,
    address: p.pay_address,
    network: NETWORK_NAMES[p.network ?? ''] ?? (p.network ? p.network.toUpperCase() : 'BEP20 (BNB Smart Chain)'),
    minutes: minutesLeft(deposit.expires_at),
    reference: deposit.reference ?? '',
  }, em);

  return {
    deposit,
    html,
    copyValues: [
      { label: t(s, lang, 'pay_label_address'), value: p.pay_address },
      { label: t(s, lang, 'pay_label_amount'), value: fmtAmount(p.pay_amount) },
    ],
    canCheck: true,
  };
}

/** Map a NOWPayments status to our CheckResult. */
export function mapNowStatus(p: NowPayment, deposit: Pick<DepositRow, 'amount_usd'>): CheckResult {
  const meta = { now_status: p.payment_status, actually_paid: p.actually_paid ?? null, pay_amount: p.pay_amount ?? null, outcome_amount: p.outcome_amount ?? null };
  switch (p.payment_status) {
    case 'finished':
    case 'confirmed':
      return { status: 'paid', creditUsd: Number(deposit.amount_usd), externalId: String(p.payment_id), meta };
    case 'expired':
      return { status: 'expired', meta };
    case 'failed':
    case 'refunded':
      return { status: 'failed', meta };
    case 'partially_paid':
      return { status: 'pending', meta: { ...meta, partial: true } };
    default: // waiting, confirming, sending
      return { status: 'pending', meta };
  }
}

async function check(app: AppCtx, s: AppSettings, deposit: DepositRow): Promise<CheckResult> {
  if (!deposit.external_id) return { status: 'pending' };
  const p = await fetchJson<NowPayment>(`${apiBase(s)}/payment/${encodeURIComponent(deposit.external_id)}`, {
    headers: { 'x-api-key': await apiKey(app.env) },
  });
  return mapNowStatus(p, deposit);
}

export const nowpayments: PaymentGateway = {
  method: 'nowpayments',
  isEnabled: (s) => s.payments.nowpayments.enabled,
  minAmount: (s) => Math.max(s.payments.min_deposit, s.payments.nowpayments.min_amount),
  create: create as PaymentGateway['create'],
  check,
};
