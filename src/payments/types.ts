import type { AppCtx } from '../env';
import type { AppSettings } from '../lib/settings';
import type { DepositMethod, DepositRow, Lang, UserRow } from '../types';

/**
 * Payment gateways create deposits (wallet top-ups). Crediting always goes through
 * services/deposits.ts → creditDeposit(), which calls the deposit_credit() SQL function
 * (idempotent) and then auto-pays a linked order if there is one.
 */

export interface CreateDepositInput {
  user: UserRow;
  amountUsd: number;      // wallet credit wanted
  orderId?: number | null; // pay this order after credit
  lang: Lang;
}

/** What the bot shows the customer after creating a deposit. */
export interface DepositInstructions {
  deposit: DepositRow;
  /** Telegram HTML to show */
  html: string;
  /** optional link button (checkout page / Binance app) */
  payUrl?: string;
  /** optional image (QR) */
  imageUrl?: string;
  /** text the customer may want to copy (address / pay id / amount) */
  copyValues?: { label: string; value: string }[];
  /** the customer must upload proof (manual methods) */
  needsProof?: boolean;
  /** show an "I've paid" button that triggers check() */
  canCheck?: boolean;
}

export interface CheckResult {
  status: 'paid' | 'pending' | 'expired' | 'failed';
  creditUsd?: number;
  externalId?: string;
  meta?: Record<string, unknown>;
}

export interface PaymentGateway {
  method: DepositMethod;
  isEnabled(s: AppSettings): boolean;
  /** min deposit for this method in USD */
  minAmount(s: AppSettings): number;
  create(app: AppCtx, s: AppSettings, input: CreateDepositInput): Promise<DepositInstructions>;
  /** poll / verify a pending deposit (cron + "I've paid" button) */
  check?(app: AppCtx, s: AppSettings, deposit: DepositRow): Promise<CheckResult>;
}
