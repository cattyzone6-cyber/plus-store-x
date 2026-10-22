import type { Env } from '../env';
import type { AppSettings } from '../lib/settings';
import type { DepositMethod } from '../types';
import { getSecret } from '../lib/settings';
import { binancePayRequest } from './binancePay';
import { fetchPayTransactions } from './binanceId';
import { fetchJson, GatewayError } from './util';

// "Test keys" for the admin panel: one harmless, read-only call per gateway that tells
// whether the provider accepts the saved keys from this Worker.

export interface KeyTestResult {
  ok: boolean;
  message: string;
}

const BINANCE_PAY_HINTS: Record<string, string> = {
  '400002': 'Signature rejected — the Secret Key does not match the API Key (re-paste both).',
  '400004': 'Binance does not accept this API Key from Cloudflare. Use a Binance Pay MERCHANT API key (merchant.binance.com → Developers → API Keys), not a normal Binance account key, and remove any IP whitelist on it (Cloudflare has no fixed IP).',
  '400003': 'Timestamp rejected — try again.',
};

function binanceCode(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  return /"code":"(\d+)"/.exec(msg)?.[1] ?? /Binance Pay (\d+)/.exec(msg)?.[1] ?? null;
}

export async function testGatewayKeys(env: Env, s: AppSettings, method: DepositMethod): Promise<KeyTestResult> {
  try {
    if (method === 'binance_pay') {
      // querying an order that cannot exist: valid keys get "order not found", invalid keys get 4000xx
      try {
        await binancePayRequest(env, '/binancepay/openapi/v2/order/query', { merchantTradeNo: `KEYTEST${Date.now()}` });
        return { ok: true, message: 'Binance Pay accepted the keys.' };
      } catch (e) {
        if (e instanceof GatewayError && e.message === 'NOT_CONFIGURED') return { ok: false, message: 'API Key and Secret Key are not saved yet.' };
        const code = binanceCode(e);
        if (code && BINANCE_PAY_HINTS[code]) return { ok: false, message: `${code}: ${BINANCE_PAY_HINTS[code]}` };
        if (code) return { ok: true, message: `Keys accepted (Binance answered ${code} for the test order, as expected).` };
        return { ok: false, message: (e as Error).message.slice(0, 300) };
      }
    }
    if (method === 'binance_id') {
      const txs = await fetchPayTransactions(env, Date.now() - 24 * 3600_000);
      return { ok: true, message: `Read-only key works — ${txs.length} Pay transfer(s) in the last 24h.` };
    }
    if (method === 'nowpayments') {
      const key = await getSecret(env, 'nowpayments_api_key');
      if (!key) return { ok: false, message: 'API key is not saved yet.' };
      const base = s.payments.nowpayments.sandbox ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';
      const r = await fetchJson<{ selectedCurrencies?: string[] }>(`${base}/merchant/coins`, { headers: { 'x-api-key': key } });
      const coins = r.selectedCurrencies ?? [];
      const want = s.payments.nowpayments.pay_currency.toLowerCase();
      const hasCoin = !coins.length || coins.map((c) => c.toLowerCase()).includes(want);
      const ipn = await getSecret(env, 'nowpayments_ipn_secret');
      return {
        ok: hasCoin && !!ipn,
        message: `API key works.${hasCoin ? '' : ` ${want} is not enabled in your NOWPayments coin settings.`}${ipn ? '' : ' IPN secret is missing (payments will only be confirmed by polling).'}`,
      };
    }
    return { ok: false, message: 'Nothing to test for this method.' };
  } catch (e) {
    const msg = e instanceof GatewayError && e.message === 'NOT_CONFIGURED' ? 'Keys are not saved yet.' : (e as Error).message;
    return { ok: false, message: msg.slice(0, 300) };
  }
}
