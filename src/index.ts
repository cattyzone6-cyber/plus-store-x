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
import { runCron } from './cron';

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
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const appCtx: AppCtx = { env, waitUntil: (p) => ctx.waitUntil(p) };
    ctx.waitUntil(runCron(appCtx, new Date(controller.scheduledTime)));
  },

  async queue(batch: MessageBatch<Job>, env: Env, ctx: ExecutionContext) {
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
