import type { Env } from '../env';
import type { DepositRow } from '../types';
import type { CreateDepositInput } from './types';
import { db, must } from '../lib/db';
import { round2 } from '../lib/money';

/** What services/deposits.ts hands to a gateway: the request plus the freshly inserted deposit row. */
export type GatewayInput = CreateDepositInput & { deposit: DepositRow };

export class GatewayError extends Error {
  constructor(message: string, public readonly status?: number, public readonly body?: unknown) {
    super(message);
  }
}

export async function patchDeposit(env: Env, id: string, patch: Partial<DepositRow>): Promise<DepositRow> {
  return must(await db(env).from('deposits').update(patch).eq('id', id).select('*').single(), 'deposit patch') as DepositRow;
}

/** fetch + JSON with a timeout; throws GatewayError on HTTP errors. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new GatewayError(`network error: ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new GatewayError(`HTTP ${res.status}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`, res.status, body);
  return body as T;
}

/** Amount the customer pays for a deposit: requested credit + fee. */
export function grossAmount(d: Pick<DepositRow, 'amount_usd' | 'fee_usd'>): number {
  return round2(Number(d.amount_usd) + Number(d.fee_usd || 0));
}

/** Format a crypto amount without float noise (max 8 decimals, trailing zeros trimmed, at least 2). */
export function fmtAmount(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  let s = v.toFixed(8).replace(/0+$/, '');
  if (s.endsWith('.')) s += '00';
  const [i, d = ''] = s.split('.');
  return `${i}.${d.padEnd(2, '0')}`;
}

export function minutesLeft(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000));
}
