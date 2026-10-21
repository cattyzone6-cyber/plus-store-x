import { Hono } from 'hono';
import type { AppCtx, Env } from '../env';
import type { DepositRow } from '../types';
import { getSecret } from '../lib/settings';
import { db, must } from '../lib/db';
import { verifyNowpaymentsSignature, mapNowStatus, type NowPayment } from '../payments/nowpayments';
import { verifyBinancePayWebhook, parseBinancePayWebhook, type BinancePayWebhook } from '../payments/binancePay';
import { checkDeposit, creditDeposit } from '../services/deposits';

// Payment gateway callbacks, mounted at /webhook.
export const paymentWebhooks = new Hono<{ Bindings: Env }>();

function appCtx(c: { env: Env; executionCtx: { waitUntil(p: Promise<unknown>): void } }): AppCtx {
  return { env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) };
}

// ── NOWPayments IPN ──────────────────────────────────────────────────────────
paymentWebhooks.post('/nowpayments', async (c) => {
  const raw = await c.req.text();
  let body: NowPayment & Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ ok: false }, 400);
  }
  const secret = await getSecret(c.env, 'nowpayments_ipn_secret');
  if (!secret || !(await verifyNowpaymentsSignature(secret, body, c.req.header('x-nowpayments-sig') ?? null))) {
    return c.json({ ok: false, error: 'bad signature' }, 401);
  }

  const app = appCtx(c);
  const byExternal = must(
    await db(c.env).from('deposits').select('*').eq('method', 'nowpayments').eq('external_id', String(body.payment_id)).maybeSingle(),
    'np deposit',
  ) as DepositRow | null;
  const deposit = byExternal ?? (body.order_id
    ? (must(await db(c.env).from('deposits').select('*').eq('method', 'nowpayments').eq('reference', body.order_id).maybeSingle(), 'np deposit ref') as DepositRow | null)
    : null);
  if (!deposit) return c.json({ ok: true, ignored: true });

  const res = mapNowStatus(body, deposit);
  if (res.status === 'paid' && deposit.status !== 'paid') {
    // credit even if the deposit expired on our side: the money arrived
    app.waitUntil(creditDeposit(app, deposit.id, res.creditUsd ?? Number(deposit.amount_usd), { externalId: String(body.payment_id), meta: res.meta }).catch((e) => console.error('np credit failed', e)));
  } else if (deposit.status === 'pending' || deposit.status === 'confirming') {
    // let the regular check path handle partial / expired / failed
    app.waitUntil(checkDeposit(app, deposit.id).then(() => undefined).catch((e) => console.error('np check failed', e)));
  }
  return c.json({ ok: true });
});

// ── Binance Pay (merchant) ───────────────────────────────────────────────────
paymentWebhooks.post('/binance-pay', async (c) => {
  const raw = await c.req.text();
  const ok = await verifyBinancePayWebhook(c.env, c.req.raw.headers, raw).catch((e) => {
    console.error('binance pay verify error', e);
    return false;
  });
  if (!ok) return c.json({ returnCode: 'FAIL', returnMessage: 'bad signature' }, 401);

  let body: BinancePayWebhook;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ returnCode: 'FAIL', returnMessage: 'bad body' }, 400);
  }
  const info = parseBinancePayWebhook(body);
  const app = appCtx(c);

  let deposit: DepositRow | null = null;
  if (info.prepayId) {
    deposit = must(await db(c.env).from('deposits').select('*').eq('method', 'binance_pay').eq('external_id', info.prepayId).maybeSingle(), 'bp deposit') as DepositRow | null;
  }
  if (!deposit && info.merchantTradeNo) {
    deposit = must(await db(c.env).from('deposits').select('*').eq('method', 'binance_pay').eq('reference', info.merchantTradeNo).maybeSingle(), 'bp deposit ref') as DepositRow | null;
  }

  if (deposit && info.paid && deposit.status !== 'paid') {
    app.waitUntil(creditDeposit(app, deposit.id, Number(deposit.amount_usd), {
      externalId: deposit.external_id ?? info.prepayId,
      meta: { transactionId: info.transactionId, binance_biz_status: body.bizStatus },
    }).then(() => undefined).catch((e) => console.error('bp credit failed', e)));
  } else if (deposit && info.closed && deposit.status === 'pending') {
    app.waitUntil(checkDeposit(app, deposit.id).then(() => undefined).catch((e) => console.error('bp check failed', e)));
  }
  return c.json({ returnCode: 'SUCCESS', returnMessage: null });
});
