import type { MiddlewareHandler } from 'hono';
import type { AdminRow } from '../../types';
import { db, must } from '../../lib/db';
import type { AdminEnv } from './util';

// Per-isolate cache: token → admin row (60s) so every request does not hit Supabase Auth.
const cache = new Map<string, { at: number; admin: AdminRow | null }>();
const TTL = 60_000;

function ownerEmails(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export const adminAuth: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return c.json({ ok: false, error: 'Not signed in' }, 401);

  let entry = cache.get(token);
  if (!entry || Date.now() - entry.at > TTL) {
    const { data, error } = await db(c.env).auth.getUser(token);
    if (error || !data.user) return c.json({ ok: false, error: 'Session expired' }, 401);
    const user = data.user;
    let admin = must(await db(c.env).from('admins').select('*').eq('user_id', user.id).maybeSingle(), 'admin') as AdminRow | null;
    // only a confirmed email may claim OWNER_EMAILS (sign-ups are disabled, but never trust an unverified claim)
    const email = user.email_confirmed_at ? (user.email ?? '').toLowerCase() : '';
    if (!admin && email && ownerEmails(c.env.OWNER_EMAILS).includes(email)) {
      admin = must(
        await db(c.env).from('admins').insert({ user_id: user.id, email, role: 'owner' }).select('*').single(),
        'admin insert',
      ) as AdminRow;
    } else if (admin && admin.role !== 'owner' && ownerEmails(c.env.OWNER_EMAILS).includes(email)) {
      admin = must(await db(c.env).from('admins').update({ role: 'owner' }).eq('user_id', user.id).select('*').single(), 'admin promote') as AdminRow;
    }
    entry = { at: Date.now(), admin };
    cache.set(token, entry);
    if (cache.size > 500) {
      for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);
    }
  }
  if (!entry.admin) return c.json({ ok: false, error: 'This account is not an admin' }, 403);
  c.set('admin', entry.admin);
  await next();
};

/** Drop cached sessions (after role changes). */
export function clearAuthCache(): void {
  cache.clear();
}
