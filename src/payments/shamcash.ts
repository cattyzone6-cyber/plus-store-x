import type { AppCtx } from '../env';
import type { AppSettings } from '../lib/settings';
import type { DepositInstructions, PaymentGateway } from './types';
import { getEmojiResolver } from '../lib/emoji';
import { escapeHtml, raw, t } from '../lib/i18n';
import { fmtUsd } from '../lib/money';
import { GatewayError, grossAmount, fmtAmount, patchDeposit, type GatewayInput } from './util';

// ShamCash: manual transfer. The customer sends a screenshot / transaction number and an
// admin approves it (bot inline buttons or admin panel → Deposits).

/** Amount to send in the configured ShamCash currency. */
export function shamcashAmount(s: AppSettings, grossUsd: number): { amount: number; currency: 'USD' | 'SYP' } {
  const cfg = s.payments.shamcash;
  if (cfg.currency === 'SYP' && cfg.syp_per_usd > 0) return { amount: Math.ceil(grossUsd * cfg.syp_per_usd), currency: 'SYP' };
  return { amount: grossUsd, currency: 'USD' };
}

async function create(app: AppCtx, s: AppSettings, input: GatewayInput): Promise<DepositInstructions> {
  const cfg = s.payments.shamcash;
  if (!cfg.account_number) throw new GatewayError('NOT_CONFIGURED');
  const d = input.deposit;
  const { amount, currency } = shamcashAmount(s, grossAmount(d));
  const deposit = await patchDeposit(app.env, d.id, { pay_amount: amount, pay_currency: currency, qr_url: cfg.qr_image_url || null });

  const em = await getEmojiResolver(app.env, s);
  const lang = input.lang;
  const instr = (lang === 'ar' ? cfg.instructions_ar : cfg.instructions_en) || cfg.instructions_en;
  const shown = currency === 'SYP' ? amount.toLocaleString('en-US') : fmtAmount(amount);
  const html = t(s, lang, 'pay_shamcash_instructions', {
    credit: fmtUsd(deposit.amount_usd),
    fee_line: raw(Number(deposit.fee_usd) > 0 ? t(s, lang, 'pay_fee_line', { fee: fmtUsd(deposit.fee_usd) }, em) : ''),
    amount: shown,
    currency,
    account_name: cfg.account_name || '—',
    account_number: cfg.account_number,
    reference: deposit.reference ?? '',
    instructions: raw(instr ? `${escapeHtml(instr)}\n\n` : ''),
  }, em);

  return {
    deposit,
    html,
    imageUrl: cfg.qr_image_url || undefined,
    copyValues: [
      { label: t(s, lang, 'pay_label_account'), value: cfg.account_number },
      { label: t(s, lang, 'pay_label_amount'), value: currency === 'SYP' ? String(amount) : fmtAmount(amount) },
    ],
    needsProof: true,
  };
}

export const shamcash: PaymentGateway = {
  method: 'shamcash',
  isEnabled: (s) => s.payments.shamcash.enabled && !!s.payments.shamcash.account_number,
  minAmount: (s) => Math.max(s.payments.min_deposit, s.payments.shamcash.min_amount),
  create: create as PaymentGateway['create'],
};
