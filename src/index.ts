import { Hono } from 'hono';
import type { AppCtx, Env } from './env';
import { setJobRunner, runJob, type Job } from './lib/jobs';
import { fulfillOrder, checkAwaitingOrder } from './services/orders';
import { syncProvider } from './services/sync';
import { runBroadcastBatch } from './services/broadcast';
import { onDepositCredited } from './services/deposits';
import { handleTelegramWebhook } from './bot';
import { paymentWebhooks } from './http/webhooks';
import { adminApi } from './http/admin';
import { resellerApi } from './http/reseller';
import { landing } from './http/landing';
import { CRON_STEPS, runCron, runCronStep } from './cron';
import { callInternal, captureLoopback, hasLoopback, isInternalRequest } from './lib/loopback';

// ─────────────────────────────────────────────────────────────────────────────
// Background job runner (Queue consumer on the Paid plan, waitUntil otherwise)
// ─────────────────────────────────────────────────────────────────────────────
setJobRunner(async (app: AppCtx, job: Job) => {
  switch (job.type) {
    case 'fulfill_order':
      return fulfillOrder(app, job.orderId);
    case 'check_order':
      return checkAwaitingOrder(app, job.orderId);
    case 'sync_provider':
      await syncProvider(app, job.providerId);
      return;
    case 'broadcast':
      await runBroadcastBatch(app, job.broadcastId);
      return;
    case 'deposit_credited':
      return onDepositCredited(app, job.depositId);
  }
});

type HonoEnv = { Bindings: Env };
const app = new Hono<HonoEnv>();

app.get('/health', (c) => c.json({ ok: true }));

// Loopback-only routes (lib/loopback.ts): each runs in its own invocation with its own
// subrequest budget. Answer at once and do the work in waitUntil.
app.post('/__internal/:kind/:name?', async (c) => {
  if (!(await isInternalRequest(c.env, c.req.raw))) return c.text('Not found', 404);
  const appCtx: AppCtx = { env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) };
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const kind = c.req.param('kind');
  if (kind === 'job') {
    c.executionCtx.waitUntil(runJob(appCtx, body as unknown as Job).catch((e) => console.error('job failed', body, e)));
  } else if (kind === 'cron') {
    const now = typeof body.now === 'number' ? new Date(body.now) : new Date();
    c.executionCtx.waitUntil(runCronStep(appCtx, c.req.param('name') ?? '', now));
  } else {
    return c.text('Not found', 404);
  }
  return c.json({ ok: true }, 202);
});

// Telegram updates
app.post('/webhook/telegram', (c) => handleTelegramWebhook(c));

// Payment gateway callbacks (NOWPayments IPN, Binance Pay)
app.route('/webhook', paymentWebhooks);

// Admin panel REST API (Supabase Auth JWT)
app.route('/api/admin', adminApi);

// Public reseller API (customers' API keys)
app.route('/api/v1', resellerApi);

// Admin panel SPA: real files are served by the assets binding before the worker runs;
// deep links (/admin/orders/123) fall back to index.html.
app.get('/admin', (c) => c.redirect('/admin/'));
app.get('/admin/*', async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/admin/index.html';
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

// Landing page (/, /ar)
app.route('/', landing);

app.notFound((c) => c.text('Not found', 404));
app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ ok: false, error: 'internal_error' }, 500);
});

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    captureLoopback(ctx);
    return app.fetch(req, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    captureLoopback(ctx);
    const appCtx: AppCtx = { env, waitUntil: (p) => ctx.waitUntil(p) };
    const now = controller.scheduledTime;
    if (!hasLoopback()) {
      ctx.waitUntil(runCron(appCtx, new Date(now)));
      return;
    }
    // fan out: one invocation per step
    await Promise.all(Object.keys(CRON_STEPS).map((name) =>
      callInternal(env, `/__internal/cron/${name}`, { now }).catch((e) => {
        console.error(`cron dispatch ${name} failed, running inline`, e);
        return runCronStep(appCtx, name, new Date(now));
      }),
    ));
  },

  async queue(batch: MessageBatch<Job>, env: Env, ctx: ExecutionContext) {
    captureLoopback(ctx);
    const appCtx: AppCtx = { env, waitUntil: (p) => ctx.waitUntil(p) };
    for (const msg of batch.messages) {
      try {
        await runJob(appCtx, msg.body);
        msg.ack();
      } catch (e) {
        console.error('queue job failed', msg.body, e);
        msg.retry({ delaySeconds: 30 });
      }
    }
  },
} satisfies ExportedHandler<Env, Job>;
