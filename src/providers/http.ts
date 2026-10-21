import { ProviderError } from './types';

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

/** Seconds from a Retry-After header (delta-seconds or HTTP date). */
export function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (isFinite(n) && n >= 0) return Math.ceil(n);
  const d = Date.parse(v);
  return isNaN(d) ? undefined : Math.max(1, Math.ceil((d - Date.now()) / 1000));
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const m = b.message ?? b.detail ?? b.error ?? b.code;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return JSON.stringify(m).slice(0, 300);
  }
  if (typeof body === 'string' && body) return body.slice(0, 300);
  return `HTTP ${status}`;
}

/**
 * JSON request to a provider. Throws ProviderError on network errors (status undefined),
 * timeouts and non-2xx responses. Callers must not put secrets into error messages.
 */
export async function providerFetch<T = unknown>(baseUrl: string, path: string, opts: HttpOptions = {}): Promise<T> {
  const url = new URL(path, baseUrl.replace(/\/+$/, '') + '/');
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new ProviderError(name === 'TimeoutError' || name === 'AbortError' ? 'Provider request timed out' : `Provider unreachable: ${(e as Error).message}`);
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }

  if (!res.ok) {
    throw new ProviderError(errorMessage(parsed, res.status), res.status, parseRetryAfter(res.headers.get('retry-after')), parsed);
  }
  return parsed as T;
}

/** Only emoji-looking values are kept (providers sometimes send words like "chatgpt"). */
export function realEmoji(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return /\p{Extended_Pictographic}/u.test(v) ? v.trim() : null;
}

export function absUrl(baseUrl: string, v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    return new URL(v, baseUrl.replace(/\/+$/, '') + '/').toString();
  } catch {
    return null;
  }
}
