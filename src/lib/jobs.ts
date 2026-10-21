import type { AppCtx } from '../env';
import { getSettings } from './settings';

/**
 * Background work. On the Paid plan (settings.system.plan = 'paid' AND the JOBS queue
 * binding exists) jobs go to the Cloudflare Queue (retries, no time pressure).
 * Otherwise they run with ctx.waitUntil() right after the response, and anything
 * unfinished is picked up again by the cron sweeps (orders stuck in 'paid' etc.).
 */
export type Job =
  | { type: 'fulfill_order'; orderId: number }
  | { type: 'check_order'; orderId: number }
  | { type: 'sync_provider'; providerId: string }
  | { type: 'broadcast'; broadcastId: string }
  | { type: 'deposit_credited'; depositId: string };

type Runner = (app: AppCtx, job: Job) => Promise<void>;
let runner: Runner | null = null;

/** Registered once in src/index.ts to avoid import cycles. */
export function setJobRunner(fn: Runner): void {
  runner = fn;
}

export async function runJob(app: AppCtx, job: Job): Promise<void> {
  if (!runner) throw new Error('job runner not registered');
  await runner(app, job);
}

export async function enqueue(app: AppCtx, job: Job): Promise<void> {
  const s = await getSettings(app.env);
  if (s.system.plan === 'paid' && app.env.JOBS) {
    await app.env.JOBS.send(job);
    return;
  }
  app.waitUntil(
    runJob(app, job).catch((err) => console.error('job failed', job, err)),
  );
}
