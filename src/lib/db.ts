import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';

export type DB = SupabaseClient;

const cache = new WeakMap<object, DB>();

/** Service-role Supabase client (bypasses RLS). Never expose to the browser. */
export function db(env: Env): DB {
  let client = cache.get(env);
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-client-info': 'plus-store-x-worker' } },
    });
    cache.set(env, client);
  }
  return client;
}

/** Throw on Supabase error, return data otherwise. */
export function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what = 'db'): T {
  if (res.error) throw new DbError(`${what}: ${res.error.message}`, res.error.message);
  return res.data as T;
}

export class DbError extends Error {
  constructor(message: string, public readonly pgMessage: string) {
    super(message);
  }
}

/** Known error codes raised by the SQL functions (see migrations/..._functions.sql). */
export const DB_ERRORS = [
  'INSUFFICIENT_BALANCE', 'USER_NOT_FOUND', 'ORDER_NOT_FOUND', 'ORDER_NOT_PENDING', 'ORDER_NOT_PAID',
  'PROMO_EXHAUSTED', 'PROMO_USER_LIMIT', 'INSUFFICIENT_STOCK', 'REFUND_EXCEEDS_TOTAL', 'CODE_INVALID',
  'CODE_EXPIRED', 'CODE_USED', 'CODE_EXHAUSTED', 'INSUFFICIENT_POINTS', 'DEPOSIT_NOT_FOUND',
] as const;
export type DbErrorCode = (typeof DB_ERRORS)[number];

/** Extract a known error code from any error thrown by a db call. */
export function dbErrorCode(err: unknown): DbErrorCode | null {
  const msg = err instanceof Error ? err.message : String(err);
  return DB_ERRORS.find((c) => msg.includes(c)) ?? null;
}

/** Call a SQL function and return its result. */
export async function rpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  return must<T>(await db(env).rpc(fn, args), `rpc ${fn}`);
}
