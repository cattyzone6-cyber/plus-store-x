import type { AppCtx, Env } from '../env';
import type { GiveawayRow, UserRow } from '../types';
import { getSettings } from '../lib/settings';
import { getEmojiResolver } from '../lib/emoji';
import { db, must, rpc } from '../lib/db';
import { escapeHtml, t } from '../lib/i18n';
import { fmtUsd } from '../lib/money';
import { button } from '../lib/telegram';
import { notifyAdmins, notifyUser } from './notify';

export type JoinResult = 'ok' | 'already' | 'ended' | 'min_spent' | 'not_found';

export async function listActiveGiveaways(env: Env): Promise<GiveawayRow[]> {
  return must(
    await db(env).from('giveaways').select('*').eq('status', 'active').gt('ends_at', new Date().toISOString()).order('ends_at'),
    'giveaways',
  ) as GiveawayRow[];
}

export async function getGiveaway(env: Env, id: string): Promise<GiveawayRow | null> {
  return must(await db(env).from('giveaways').select('*').eq('id', id).maybeSingle(), 'giveaway') as GiveawayRow | null;
}

export async function giveawayEntries(env: Env, id: string): Promise<number> {
  const { count } = await db(env).from('giveaway_entries').select('user_id', { count: 'exact', head: true }).eq('giveaway_id', id);
  return count ?? 0;
}

export async function hasJoined(env: Env, id: string, userId: number): Promise<boolean> {
  const row = must(await db(env).from('giveaway_entries').select('user_id').eq('giveaway_id', id).eq('user_id', userId).maybeSingle(), 'entry') as { user_id: number } | null;
  return !!row;
}

export async function joinGiveaway(env: Env, giveawayId: string, user: UserRow): Promise<JoinResult> {
  const g = await getGiveaway(env, giveawayId);
  if (!g) return 'not_found';
  if (g.status !== 'active' || new Date(g.ends_at).getTime() <= Date.now()) return 'ended';
  if (Number(user.total_spent) < Number(g.min_spent)) return 'min_spent';
  const res = await db(env).from('giveaway_entries').insert({ giveaway_id: g.id, user_id: user.id });
  if (res.error) {
    if (/duplicate|unique/i.test(res.error.message)) return 'already';
    throw new Error(res.error.message);
  }
  return 'ok';
}

export function prizeText(g: GiveawayRow, lang: 'en' | 'ar'): string {
  if (g.prize_type === 'balance') return lang === 'ar' ? `${fmtUsd(g.prize_amount)} رصيد في المحفظة` : `${fmtUsd(g.prize_amount)} wallet balance`;
  return g.prize_text || '—';
}

/** Cron: close giveaways whose end time passed, draw winners, pay balance prizes. */
export async function finishDueGiveaways(app: AppCtx): Promise<number> {
  const { env } = app;
  const due = must(
    await db(env).from('giveaways').select('*').eq('status', 'active').lte('ends_at', new Date().toISOString()).limit(5),
    'due giveaways',
  ) as GiveawayRow[];
  if (!due.length) return 0;
  const s = await getSettings(env);
  const em = await getEmojiResolver(env, s);

  for (const g of due) {
    // claim it first so two cron runs never draw twice
    const claimed = must(await db(env).from('giveaways').update({ status: 'ended' }).eq('id', g.id).eq('status', 'active').select('id'), 'giveaway claim') as { id: string }[];
    if (!claimed.length) continue;

    const entries = must(await db(env).from('giveaway_entries').select('user_id').eq('giveaway_id', g.id), 'entries') as { user_id: number }[];
    const ids = entries.map((e) => e.user_id);
    // Fisher–Yates with crypto randomness
    const rnd = crypto.getRandomValues(new Uint32Array(ids.length));
    for (let i = ids.length - 1; i > 0; i--) {
      const j = rnd[i] % (i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const winners = ids.slice(0, g.winners_count);
    if (winners.length) {
      await db(env).from('giveaway_entries').update({ is_winner: true }).eq('giveaway_id', g.id).in('user_id', winners);
    }

    const users = winners.length
      ? (must(await db(env).from('users').select('id,lang,username,first_name').in('id', winners), 'winners') as Pick<UserRow, 'id' | 'lang' | 'username' | 'first_name'>[])
      : [];
    for (const u of users) {
      if (g.prize_type === 'balance' && Number(g.prize_amount) > 0) {
        try {
          await rpc(env, 'wallet_apply', { p_user_id: u.id, p_amount: Number(g.prize_amount), p_type: 'giveaway', p_ref_type: 'giveaway', p_ref_id: g.id, p_note: g.title_en });
        } catch (e) {
          console.error('giveaway prize failed', g.id, u.id, e);
        }
      }
      await notifyUser(env, u.id, t(s, u.lang, 'giveaway_won', { title: (u.lang === 'ar' && g.title_ar) || g.title_en, prize: prizeText(g, u.lang) }, em),
        [[button({ text: t(s, u.lang, 'btn_home'), emoji: 'home', data: 'home' }, em)]]);
    }

    const names = users.map((u) => (u.username ? `@${escapeHtml(u.username)}` : `<code>${u.id}</code>`)).join(', ');
    await notifyAdmins(env, 'system', `🎉 <b>Giveaway ended:</b> ${escapeHtml(g.title_en)}\nEntries: ${entries.length}\nWinners: ${names || '—'}\nPrize: ${escapeHtml(prizeText(g, 'en'))}`);
  }
  return due.length;
}
