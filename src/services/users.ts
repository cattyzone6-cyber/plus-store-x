import type { Env } from '../env';
import type { Lang, UserRow, UserState } from '../types';
import { db, must } from '../lib/db';

export interface TgFrom {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

export function langFromCode(code: string | undefined, fallback: Lang): Lang {
  if (!code) return fallback;
  return code.toLowerCase().startsWith('ar') ? 'ar' : code.toLowerCase().startsWith('en') ? 'en' : fallback;
}

/** Load the user, creating it on first contact. Names/last_seen are refreshed at most every 5 minutes. */
export async function getOrCreateUser(env: Env, from: TgFrom, defaultLang: Lang): Promise<{ user: UserRow; isNew: boolean }> {
  const existing = must(await db(env).from('users').select('*').eq('id', from.id).maybeSingle(), 'user get') as UserRow | null;
  if (existing) {
    const stale = Date.now() - new Date(existing.last_seen_at).getTime() > 5 * 60_000;
    const changed = existing.username !== (from.username ?? null) || existing.first_name !== (from.first_name ?? null);
    if (stale || changed || existing.blocked_bot) {
      const patch = {
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        last_name: from.last_name ?? null,
        last_seen_at: new Date().toISOString(),
        blocked_bot: false,
      };
      await db(env).from('users').update(patch).eq('id', from.id);
      Object.assign(existing, patch);
    }
    return { user: existing, isNew: false };
  }
  const row = {
    id: from.id,
    username: from.username ?? null,
    first_name: from.first_name ?? null,
    last_name: from.last_name ?? null,
    lang: langFromCode(from.language_code, defaultLang),
  };
  const res = await db(env).from('users').insert(row).select('*').single();
  if (res.error) {
    // race: created by a parallel update
    const again = must(await db(env).from('users').select('*').eq('id', from.id).single(), 'user get') as UserRow;
    return { user: again, isNew: false };
  }
  return { user: res.data as UserRow, isNew: true };
}

export async function getUser(env: Env, id: number): Promise<UserRow | null> {
  return must(await db(env).from('users').select('*').eq('id', id).maybeSingle(), 'user get') as UserRow | null;
}

export async function setUserState(env: Env, userId: number, state: UserState | null): Promise<void> {
  must(await db(env).from('users').update({ state: state ? { ...state, at: Date.now() } : null }).eq('id', userId), 'user state');
}

export async function setUserLang(env: Env, userId: number, lang: Lang): Promise<void> {
  must(await db(env).from('users').update({ lang, lang_chosen: true }).eq('id', userId), 'user lang');
}

export async function markBlocked(env: Env, userId: number): Promise<void> {
  await db(env).from('users').update({ blocked_bot: true }).eq('id', userId);
}

/** Effective personal discount: max(admin set discount, level discount by total spent). */
export function userDiscountPercent(
  user: Pick<UserRow, 'discount_percent' | 'total_spent'> | null,
  levels: { min_spent: number; percent: number }[],
  levelsEnabled: boolean,
): number {
  if (!user) return 0;
  let p = Number(user.discount_percent) || 0;
  if (levelsEnabled) {
    for (const l of levels) if (Number(user.total_spent) >= l.min_spent) p = Math.max(p, l.percent);
  }
  return Math.min(Math.max(p, 0), 90);
}
