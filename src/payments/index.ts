import type { AppSettings } from '../lib/settings';
import type { DepositMethod } from '../types';
import type { PaymentGateway } from './types';
import { binancePay } from './binancePay';
import { binanceId } from './binanceId';
import { nowpayments } from './nowpayments';
import { shamcash } from './shamcash';

/** All gateways, in the order shown to customers. */
export const GATEWAYS: PaymentGateway[] = [binancePay, binanceId, nowpayments, shamcash];

export function getGateway(method: DepositMethod): PaymentGateway {
  const g = GATEWAYS.find((x) => x.method === method);
  if (!g) throw new Error(`Unknown payment method: ${method}`);
  return g;
}

export function enabledGateways(s: AppSettings): PaymentGateway[] {
  return GATEWAYS.filter((g) => g.isEnabled(s));
}

/** Methods confirmed automatically (polled by the cron). */
export const AUTO_METHODS: DepositMethod[] = ['binance_pay', 'binance_id', 'nowpayments'];
