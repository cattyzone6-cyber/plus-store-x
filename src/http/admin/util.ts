import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ZodType } from 'zod';
import type { AppCtx, Env } from '../../env';
import type { AdminRow } from '../../types';
import { audit } from '../../services/notify';

export type AdminEnv = { Bindings: Env; Variables: { admin: AdminRow } };
export type AdminContext = Context<AdminEnv>;

export function appCtx(c: { env: Env; executionCtx: { waitUntil(p: Promise<unknown>): void } }): AppCtx {
  return { env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) };
}

/** Throw an HTTP error that the admin error handler turns into {ok:false, error}. */
export function fail(status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502, error: string): never {
  throw new HTTPException(status, { message: error });
}

export async function body<T>(c: AdminContext, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    fail(400, 'Invalid JSON body');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail(422, `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`);
  }
  return parsed.data;
}

export function paging(c: AdminContext, defLimit = 25): { page: number; limit: number; from: number; to: number } {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') ?? String(defLimit), 10) || defLimit));
  const from = (page - 1) * limit;
  return { page, limit, from, to: from + limit - 1 };
}

export function requireOwner(c: AdminContext): void {
  if (c.get('admin').role !== 'owner') fail(403, 'Owner only');
}

export async function log(c: AdminContext, action: string, entity?: string, entityId?: string | number, data?: unknown): Promise<void> {
  const a = c.get('admin');
  await audit(c.env, { admin_id: a.user_id, admin_email: a.email, action, entity, entity_id: entityId, data });
}

/** Escape user text for ILIKE patterns. */
export function likePattern(q: string): string {
  return `%${q.replace(/[%_,()]/g, ' ').trim()}%`;
}

/** Throw on Supabase error with a readable message. */
export function check<T>(res: { data: T | null; error: { message: string } | null; count?: number | null }): T {
  if (res.error) fail(400, res.error.message);
  return res.data as T;
}
