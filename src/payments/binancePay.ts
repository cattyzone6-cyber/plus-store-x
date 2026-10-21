import type { AppCtx, Env } from '../env';
import type { AppSettings } from '../lib/settings';
import type { DepositRow } from '../types';
import type { CheckResult, DepositInstructions, PaymentGateway } from './types';
import { baseUrl, getSecret } from '../lib/settings';
import { b64decode, hmacSha512Hex, randomToken } from '../lib/crypto';
import { getEmojiResolver } from '../lib/emoji';
import { t, raw } from '../lib/i18n';
import { fmtUsd } from '../lib/money';
import { fetchJson, GatewayError, grossAmount, fmtAmount, minutesLeft, patchDeposit, type GatewayInput } from './util';

// Binance Pay MERCHANT API (requires a Binance Pay merchant account).
// Docs: https://developers.binance.com/docs/binance-pay/introduction

const API = 'https://bpay.binanceapi.com';

/** Request signature: uppercase hex HMAC-SHA512(secret, ts + "\n" + nonce + "\n" + body + "\n"). */
export async function binancePaySignature(secret: string, timestamp: string, nonce: string, body: string): Promise<string> {
  return (await hmacSha512Hex(secret, `${timestamp}\n${nonce}\n${body}\n`)).toUpperCase();
}

interface BinanceResponse<T> {
  status: 'SUCCESS' | 'FAIL';
  code: string;
  data?: T;
  errorMessage?: string;
}

async function credentials(env: Env): Promise<{ apiKey: string; secret: string } | null> {
  const [apiKey, secret] = await Promise.all([getSecret(env, 'binance_pay_api_key'), getSecret(env, 'binance_pay_secret_key')]);
  return apiKey && secret ? { apiKey, secret } : null;
}

async function call<T>(env: Env, path: string, payload: unknown): Promise<T> {
  const creds = await credentials(env);
  if (!creds) throw new GatewayError('NOT_CONFIGURED');
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = randomToken(16); // 32 hex chars
  const signature = await binancePaySignature(creds.secret, timestamp, nonce, body);
  const res = await fetchJson<BinanceResponse<T>>(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'BinancePay-Timestamp': timestamp,
      'BinancePay-Nonce': nonce,
      'BinancePay-Certificate-SN': creds.apiKey,
      'BinancePay-Signature': signature,
    },
    body,
  });
  if (res.status !== 'SUCCESS' || !res.data) throw new GatewayError(`Binance Pay ${res.code}: ${res.errorMessage ?? 'failed'}`, undefined, res);
  return res.data;
}

interface CreateOrderData {
  prepayId: string;
  expireTime?: number;
  qrcodeLink?: string;
  qrContent?: string;
  checkoutUrl?: string;
  deeplink?: string;
  universalUrl?: string;
  totalFee?: string;
  currency?: string;
}

async function create(app: AppCtx, s: AppSettings, input: GatewayInput): Promise<DepositInstructions> {
  const { env } = app;
  const d = input.deposit;
  const amount = grossAmount(d);
  const expireMinutes = Math.min(Math.max(s.payments.deposit_expire_minutes, 5), 60); // Binance Pay allows at most 1 hour
  const expireAt = Date.now() + expireMinutes * 60_000;
  const hook = baseUrl(s);
  const payload = {
    env: { terminalType: 'APP' },
    merchantTradeNo: (d.reference ?? d.id.replace(/-/g, '')).replace(/[^A-Za-z0-9]/g, '').slice(0, 32),
    orderAmount: Number(amount.toFixed(2)),
    currency: 'USDT',
    description: `${s.brand.name} wallet top-up`.slice(0, 256),
    goodsDetails: [
      { goodsType: '02', goodsCategory: 'Z000', referenceGoodsId: d.reference ?? d.id, goodsName: `Wallet top-up ${fmtUsd(d.amount_usd)}`.slice(0, 256) },
    ],
    orderExpireTime: expireAt,
    ...(hook ? { webhookUrl: `${hook}/webhook/binance-pay` } : {}),
  };
  const data = await call<CreateOrderData>(env, '/binancepay/openapi/v3/order', payload);
  const payUrl = data.universalUrl || data.checkoutUrl || data.deeplink;

  const deposit = await patchDeposit(env, d.id, {
    pay_amount: amount,
    pay_currency: 'USDT',
    external_id: data.prepayId,
    pay_url: payUrl ?? null,
    qr_url: data.qrcodeLink ?? null,
    expires_at: new Date(expireAt).toISOString(),
    meta: { ...d.meta, merchantTradeNo: payload.merchantTradeNo, checkoutUrl: data.checkoutUrl, deeplink: data.deeplink },
  });

  const em = await getEmojiResolver(env, s);
  const html = t(s, input.lang, 'pay_binance_pay_instructions', {
    credit: fmtUsd(deposit.amount_usd),
    fee_line: raw(Number(deposit.fee_usd) > 0 ? t(s, input.lang, 'pay_fee_line', { fee: fmtUsd(deposit.fee_usd) }, em) : ''),
    amount: fmtAmount(amount),
    minutes: minutesLeft(deposit.expires_at),
    reference: deposit.reference ?? '',
  }, em);

  return { deposit, html, payUrl, imageUrl: data.qrcodeLink, canCheck: true };
}

interface QueryOrderData {
  merchantTradeNo: string;
  prepayId: string;
  transactionId?: string;
  status: 'INITIAL' | 'PENDING' | 'PAID' | 'CANCELED' | 'ERROR' | 'REFUNDING' | 'REFUNDED' | 'EXPIRED';
  currency?: string;
  orderAmount?: string;
  transactTime?: number;
}

async function check(app: AppCtx, _s: AppSettings, deposit: DepositRow): Promise<CheckResult> {
  const merchantTradeNo = (deposit.meta?.merchantTradeNo as string | undefined) ?? deposit.reference ?? undefined;
  const data = await call<QueryOrderData>(app.env, '/binancepay/openapi/v2/order/query', deposit.external_id ? { prepayId: deposit.external_id } : { merchantTradeNo });
  switch (data.status) {
    case 'PAID':
      return { status: 'paid', creditUsd: Number(deposit.amount_usd), externalId: deposit.external_id ?? data.prepayId, meta: { transactionId: data.transactionId, binance_status: data.status } };
    case 'EXPIRED':
    case 'CANCELED':
      return { status: 'expired' };
    case 'ERROR':
      return { status: 'failed' };
    default:
      return { status: 'pending' };
  }
}

export const binancePay: PaymentGateway = {
  method: 'binance_pay',
  isEnabled: (s) => s.payments.binance_pay.enabled,
  minAmount: (s) => s.payments.min_deposit,
  create: create as PaymentGateway['create'],
  check,
};

// ─────────────────────────────────────────────────────────────────────────────
// Webhook verification
// ─────────────────────────────────────────────────────────────────────────────

let certCache: { at: number; certs: Map<string, CryptoKey> } | null = null;
const CERT_TTL = 6 * 3600_000;

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  return b64decode(b64);
}

async function binanceCerts(env: Env, refresh = false): Promise<Map<string, CryptoKey>> {
  if (!refresh && certCache && Date.now() - certCache.at < CERT_TTL) return certCache.certs;
  const list = await call<{ certSerial: string; certPublic: string }[]>(env, '/binancepay/openapi/certificates', {});
  const certs = new Map<string, CryptoKey>();
  for (const c of list) {
    const key = await crypto.subtle.importKey('spki', pemToDer(c.certPublic), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    certs.set(c.certSerial, key);
  }
  certCache = { at: Date.now(), certs };
  return certs;
}

/** Verify a Binance Pay webhook: base64 RSA-SHA256 over ts + "\n" + nonce + "\n" + rawBody + "\n". */
export async function verifyBinancePayWebhook(env: Env, headers: Headers, rawBody: string): Promise<boolean> {
  const ts = headers.get('BinancePay-Timestamp');
  const nonce = headers.get('BinancePay-Nonce');
  const sig = headers.get('BinancePay-Signature');
  const serial = headers.get('BinancePay-Certificate-SN');
  if (!ts || !nonce || !sig) return false;
  let certs = await binanceCerts(env);
  let key = serial ? certs.get(serial) : [...certs.values()][0];
  if (!key) {
    certs = await binanceCerts(env, true);
    key = serial ? certs.get(serial) : [...certs.values()][0];
  }
  if (!key) return false;
  const data = new TextEncoder().encode(`${ts}\n${nonce}\n${rawBody}\n`);
  try {
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64decode(sig), data);
  } catch {
    return false;
  }
}

export interface BinancePayWebhook {
  bizType: string;
  bizId?: number | string;
  bizIdStr?: string;
  bizStatus: string;
  /** JSON string */
  data: string | Record<string, unknown>;
}

/** Extract merchantTradeNo / prepayId from the webhook payload. */
export function parseBinancePayWebhook(body: BinancePayWebhook): { paid: boolean; closed: boolean; merchantTradeNo: string | null; prepayId: string | null; transactionId: string | null } {
  let data: Record<string, unknown> = {};
  try {
    data = typeof body.data === 'string' ? (JSON.parse(body.data) as Record<string, unknown>) : (body.data ?? {});
  } catch {
    data = {};
  }
  const prepayId = (data.prepayId as string | undefined) ?? (body.bizIdStr ?? (body.bizId != null ? String(body.bizId) : null));
  return {
    paid: body.bizType === 'PAY' && body.bizStatus === 'PAY_SUCCESS',
    closed: body.bizType === 'PAY' && body.bizStatus === 'PAY_CLOSED',
    merchantTradeNo: (data.merchantTradeNo as string | undefined) ?? null,
    prepayId: prepayId ?? null,
    transactionId: (data.transactionId as string | undefined) ?? null,
  };
}
