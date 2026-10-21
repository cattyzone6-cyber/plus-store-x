import type { BotContext } from './context';
import type { ForceJoinChat } from '../lib/settings';
import { db } from '../lib/db';

// Short per-isolate cache so we don't call getChatMember on every update.
const cache = new Map<number, number>(); // userId → verified until (epoch ms)
const CACHE_MS = 10 * 60_000;

const MEMBER = new Set(['member', 'administrator', 'creator']);

/**
 * Returns the force-join chats the user has not joined yet (empty = OK).
 * If the bot cannot check a chat (not an admin there / wrong id) the chat is skipped,
 * so a misconfiguration never locks customers out.
 */
export async function checkForceJoin(ctx: BotContext, fresh = false): Promise<ForceJoinChat[]> {
  const { s, user, env } = ctx.st;
  if (!s.force_join.enabled || !s.force_join.chats.length) return [];
  if (!fresh && (cache.get(user.id) ?? 0) > Date.now()) return [];

  const missing: ForceJoinChat[] = [];
  for (const chat of s.force_join.chats) {
    try {
      const m = await ctx.api.getChatMember(chat.chat_id, user.id);
      const ok = MEMBER.has(m.status) || (m.status === 'restricted' && (m as { is_member?: boolean }).is_member === true);
      if (!ok) missing.push(chat);
    } catch (e) {
      console.warn('force join check failed for', chat.chat_id, (e as Error).message);
    }
  }
  if (!missing.length) {
    cache.set(user.id, Date.now() + CACHE_MS);
    if (!user.joined_verified) {
      user.joined_verified = true;
      await db(env).from('users').update({ joined_verified: true }).eq('id', user.id);
    }
  }
  return missing;
}
