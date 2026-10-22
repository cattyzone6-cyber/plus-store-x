import type { AppCtx } from './env';
import type { OrderRow } from './types';
import { db, must } from './lib/db';
import { enqueue } from './lib/jobs';
import { syncDueProviders, checkProviderBalances } from './services/sync';
import { pollPendingDeposits, expireDeposits } from './services/deposits';
import { continueBroadcasts } from './services/broadcast';
import { finishDueGiveaways } from './services/giveaways';
import { notifyAdmins } from './services/notify';
import { runAlerts } from './services/alerts';

/** Returns true (and records the run) when `key` has not run for `minutes`. */
async function due(app: AppCtx, key: string, minutes: number, now: Date): Promise<boolean> {
  const row = must(await db(app.env).from('cron_state').select('last_run').eq('key', key).maybeSingle(), 'cron_state') as { last_run: string } | null;
  if (row && now.getTime() - new Date(row.last_run).getTime() < minutes * 60_000 - 5_000) return false;
  await db(app.env).from('cron_state').upsert({ key, last_run: now.toISOString() });
  return true;
}

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`cron step ${name} failed`, e);
  }
}

/**
 * Cron steps (every minute, wrangler.jsonc triggers). The scheduled handler runs each step
 * in its own loopback invocation (see lib/loopback.ts) so every step gets its own Free plan
 * subrequest budget; steps still keep their batches small.
 */
export const CRON_STEPS: Record<string, (app: AppCtx, now: Date) => Promise<unknown>> = {
  orders: (app, now) => sweepOrders(app, now),
  deposits: async (app) => {
    await pollPendingDeposits(app);
    await expireDeposits(app);
  },
  broadcasts: (app) => continueBroadcasts(app), // free plan; paid plan re-enqueues itself
  sync: (app) => syncDueProviders(app),
  alerts: (app) => runAlerts(app),
  slow: async (app, now) => {
    if (await due(app, 'balances', 30, now)) await checkProviderBalances(app);
    if (await due(app, 'giveaways', 5, now)) await finishDueGiveaways(app);
  },
};

export async function runCronStep(app: AppCtx, name: string, now: Date): Promise<void> {
  const fn = CRON_STEPS[name];
  if (fn) await step(name, () => fn(app, now));
}

/** Fallback when no loopback is available (e.g. old runtimes): every step in this invocation. */
export async function runCron(app: AppCtx, now: Date): Promise<void> {
  for (const name of Object.keys(CRON_STEPS)) await runCronStep(app, name, now);
}

/** Recover orders that were paid but never fulfilled, and poll async provider orders. */
async function sweepOrders(app: AppCtx, now: Date): Promise<void> {
  const env = app.env;
  const oneMinAgo = new Date(now.getTime() - 60_000).toISOString();
  const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();

  // paid but not picked up (worker died before the job ran)
  const paid = must(
    await db(env).from('orders').select('id').eq('status', 'paid').lt('paid_at', oneMinAgo).limit(5),
    'sweep paid',
  ) as { id: number }[];
  for (const o of paid) await enqueue(app, { type: 'fulfill_order', orderId: o.id });

  // stuck in processing: retry (provider purchases are idempotent per order+source)
  const stuck = must(
    await db(env).from('orders').select('id,code,attempts').eq('status', 'processing').lt('updated_at', tenMinAgo).limit(5),
    'sweep processing',
  ) as Pick<OrderRow, 'id' | 'code' | 'attempts'>[];
  for (const o of stuck) {
    if (o.attempts >= 3) {
      await db(env).from('orders').update({ status: 'failed', error: 'Stuck in processing' }).eq('id', o.id).eq('status', 'processing');
      await notifyAdmins(env, 'order_failed', `⚠️ <b>Order ${o.code}</b> was stuck in processing and needs a manual check.`);
      continue;
    }
    await db(env).from('orders').update({ status: 'paid', attempts: o.attempts + 1 }).eq('id', o.id).eq('status', 'processing');
    await enqueue(app, { type: 'fulfill_order', orderId: o.id });
  }

  // abandoned checkouts: pending for 2h+ with no open deposit
  const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000).toISOString();
  const abandoned = must(
    await db(env).from('orders').select('id').eq('status', 'pending_payment').lt('created_at', twoHoursAgo).limit(20),
    'sweep abandoned',
  ) as { id: number }[];
  if (abandoned.length) {
    const open = must(
      await db(env).from('deposits').select('order_id').in('order_id', abandoned.map((o) => o.id)).in('status', ['pending', 'confirming']),
      'sweep open deposits',
    ) as { order_id: number }[];
    const keep = new Set(open.map((d) => d.order_id));
    const ids = abandoned.map((o) => o.id).filter((id) => !keep.has(id));
    if (ids.length) await db(env).from('orders').update({ status: 'cancelled' }).in('id', ids).eq('status', 'pending_payment');
  }

  // async provider orders
  const waiting = must(
    await db(env).from('orders').select('id').eq('status', 'awaiting_provider').lte('next_check_at', now.toISOString()).order('next_check_at').limit(5),
    'sweep awaiting',
  ) as { id: number }[];
  // each check runs as its own job (own subrequest budget); push next_check_at first so the
  // next tick cannot pick the same order while that job is still running
  for (const o of waiting) {
    const claimed = must(
      await db(env).from('orders').update({ next_check_at: new Date(now.getTime() + 3 * 60_000).toISOString() })
        .eq('id', o.id).eq('status', 'awaiting_provider').lte('next_check_at', now.toISOString()).select('id'),
      'claim check',
    ) as { id: number }[];
    if (claimed.length) await enqueue(app, { type: 'check_order', orderId: o.id });
  }
}
