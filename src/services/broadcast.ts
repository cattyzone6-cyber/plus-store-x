import type { AppCtx } from '../env';
import type { BroadcastRow, UserRow } from '../types';
import { db, must } from '../lib/db';
import { getSettings } from '../lib/settings';
import { enqueue } from '../lib/jobs';
import { sendMessage, sendPhoto, TelegramError, type InlineKeyboard } from '../lib/telegram';
import { markBlocked } from './users';

/**
 * Send the next batch of a broadcast. Users are walked in id order using cursor_id,
 * so a batch can be interrupted at any point and resumed safely.
 * Paid plan: re-enqueues itself until done. Free plan: the cron calls continueBroadcasts().
 */
export async function runBroadcastBatch(app: AppCtx, broadcastId: string): Promise<void> {
  const { env } = app;
  const s = await getSettings(env);
  const b = must(await db(env).from('broadcasts').select('*').eq('id', broadcastId).maybeSingle(), 'broadcast') as BroadcastRow | null;
  if (!b || !['queued', 'sending'].includes(b.status)) return;
  if (b.status === 'queued') await db(env).from('broadcasts').update({ status: 'sending' }).eq('id', b.id);

  const paid = s.system.plan === 'paid';
  // Free plan: 50 subrequests per invocation (each batch runs in its own one), keep a margin for the db calls.
  const batch = Math.max(1, Math.min(paid ? s.system.broadcast_batch_paid : s.system.broadcast_batch_free, paid ? 2000 : 35));

  let q = db(env).from('users').select('id,lang').gt('id', b.cursor_id).eq('blocked_bot', false).eq('is_banned', false).order('id').limit(batch);
  if (b.target === 'lang_en') q = q.eq('lang', 'en');
  if (b.target === 'lang_ar') q = q.eq('lang', 'ar');
  if (b.target === 'buyers') q = q.gt('orders_count', 0);
  if (b.target === 'non_buyers') q = q.eq('orders_count', 0);
  if (b.target === 'alerts') q = q.eq('alerts_opt_in', true);
  const users = must(await q, 'broadcast users') as Pick<UserRow, 'id' | 'lang'>[];

  if (!users.length) {
    await db(env).from('broadcasts').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', b.id);
    return;
  }

  const keyboard: InlineKeyboard | undefined = b.buttons?.length ? b.buttons.map((btn) => [{ text: btn.text, url: btn.url }]) : undefined;
  let sent = 0;
  let failed = 0;
  const blocked: number[] = [];

  // modest concurrency keeps us under Telegram's ~30 msg/s global limit
  const CONCURRENCY = paid ? 20 : 10;
  for (let i = 0; i < users.length; i += CONCURRENCY) {
    const chunk = users.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (u) => {
      const text = (u.lang === 'ar' && b.text_ar?.trim()) || b.text_en;
      try {
        if (b.image_url) await sendPhoto(env, u.id, b.image_url, text, { keyboard });
        else await sendMessage(env, u.id, text, { keyboard, disablePreview: false });
        sent++;
      } catch (e) {
        failed++;
        if (e instanceof TelegramError && e.isUnreachable) blocked.push(u.id);
        else if (e instanceof TelegramError && e.retryAfter) await new Promise((r) => setTimeout(r, Math.min(e.retryAfter!, 5) * 1000));
      }
    }));
    if (paid && i + CONCURRENCY < users.length) await new Promise((r) => setTimeout(r, 1000));
  }

  if (blocked.length) {
    if (blocked.length <= 5) await Promise.all(blocked.map((id) => markBlocked(env, id)));
    else await db(env).from('users').update({ blocked_bot: true }).in('id', blocked);
  }

  // re-read status so a cancel during the batch wins
  const cur = must(await db(env).from('broadcasts').select('status,sent,failed').eq('id', b.id).single(), 'broadcast') as Pick<BroadcastRow, 'status' | 'sent' | 'failed'>;
  const last = users[users.length - 1].id;
  const done = users.length < batch;
  await db(env).from('broadcasts').update({
    cursor_id: last,
    sent: cur.sent + sent,
    failed: cur.failed + failed,
    ...(cur.status === 'cancelled' ? {} : done ? { status: 'done', finished_at: new Date().toISOString() } : {}),
  }).eq('id', b.id);

  if (!done && cur.status !== 'cancelled' && paid && env.JOBS) {
    await enqueue(app, { type: 'broadcast', broadcastId: b.id });
  }
}

/** Cron (every minute): advance every broadcast still sending. */
export async function continueBroadcasts(app: AppCtx): Promise<void> {
  const s = await getSettings(app.env);
  // on the paid plan with a queue, batches chain themselves
  if (s.system.plan === 'paid' && app.env.JOBS) {
    // only re-kick broadcasts whose first job apparently got lost
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    const stale = must(await db(app.env).from('broadcasts').select('id').eq('status', 'queued').lt('started_at', cutoff), 'broadcasts') as { id: string }[];
    for (const b of stale) await enqueue(app, { type: 'broadcast', broadcastId: b.id });
    return;
  }
  const rows = must(await db(app.env).from('broadcasts').select('id').in('status', ['queued', 'sending']).order('created_at').limit(1), 'broadcasts') as { id: string }[];
  for (const r of rows) await runBroadcastBatch(app, r.id);
}
