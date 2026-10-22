import type { Env } from '../env';
import { safeEqual, sha256Hex } from './crypto';

// Loopback calls into this same Worker (ctx.exports, default since compat 2025-11-17).
// Each call runs as a NEW invocation with its own limits — on the Workers Free plan that
// means its own 50 outgoing-request budget — so the cron and background jobs never share
// one budget. Internal routes are authenticated with a secret derived from ENCRYPTION_KEY.

let loop: Fetcher | null = null;

/** Remember the loopback binding of the current invocation (call at every entry point). */
export function captureLoopback(ctx: ExecutionContext): void {
  const ex = (ctx as unknown as { exports?: { default?: Fetcher } }).exports;
  if (ex?.default && typeof ex.default.fetch === 'function') loop = ex.default;
}

export function hasLoopback(): boolean {
  return loop !== null;
}

const secretCache = new Map<string, Promise<string>>();
function internalSecret(env: Env): Promise<string> {
  let s = secretCache.get(env.ENCRYPTION_KEY);
  if (!s) {
    s = sha256Hex(`plus-store-x:internal:${env.ENCRYPTION_KEY}`);
    secretCache.set(env.ENCRYPTION_KEY, s);
  }
  return s;
}

export const INTERNAL_HEADER = 'x-psx-internal';

/** POST to an internal route in a fresh invocation. Returns false when no loopback exists. */
export async function callInternal(env: Env, path: string, body: unknown): Promise<boolean> {
  if (!loop) return false;
  const res = await loop.fetch(`https://internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [INTERNAL_HEADER]: await internalSecret(env) },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`internal ${path} failed: ${res.status}`);
  return true;
}

export async function isInternalRequest(env: Env, req: Request): Promise<boolean> {
  const got = req.headers.get(INTERNAL_HEADER) ?? '';
  return !!got && safeEqual(got, await internalSecret(env));
}
