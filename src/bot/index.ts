import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { Context as HonoContext } from 'hono';
import type { AppCtx, Env } from '../env';
import type { BotContext } from './context';
import { answer, getAdmin, plain, setState, tr } from './context';
import { attachReferral, isDeepLink, onCallback, onCommand, onMessage, showForceJoin, showLanguagePicker } from './router';
import { checkForceJoin } from './forceJoin';
import { getSettings } from '../lib/settings';
import { getEmojiResolver } from '../lib/emoji';
import { safeEqual } from '../lib/crypto';
import { escapeHtml } from '../lib/i18n';
import { getOrCreateUser, markBlocked } from '../services/users';
import { notifyAdminsLater } from '../services/notify';

// Per-request data keyed by the update object (isolates serve requests concurrently,
// so nothing request-specific may live in module scope).
const requests = new WeakMap<object, AppCtx>();

let cached: { token: string; bot: Promise<Bot<BotContext>> } | null = null;

function getBot(env: Env): Promise<Bot<BotContext>> {
  if (cached?.token === env.TELEGRAM_BOT_TOKEN) return cached.bot;
  const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);
  install(bot);
  const ready = bot.init().then(() => bot);
  ready.catch(() => {
    cached = null; // retry getMe on the next update
  });
  cached = { token: env.TELEGRAM_BOT_TOKEN, bot: ready };
  return ready;
}

const GROUP_COMMANDS = /^\/(myid|admin)(@\w+)?\b/;

function install(bot: Bot<BotContext>): void {
  // 1) context: settings, emoji library, user
  bot.use(async (ctx, next) => {
    const app = requests.get(ctx.update);
    if (!app || !ctx.from || ctx.from.is_bot) return;
    const { env } = app;

    if (ctx.myChatMember) {
      if (ctx.myChatMember.chat.type === 'private' && ctx.myChatMember.new_chat_member.status === 'kicked') await markBlocked(env, ctx.from.id);
      return;
    }

    const isPrivate = ctx.chat?.type === 'private';
    if (!isPrivate) {
      // in groups (e.g. the admin alerts chat) only admin buttons and a couple of commands work
      const ok = ctx.callbackQuery?.data?.startsWith('adm:') || GROUP_COMMANDS.test(ctx.message?.text ?? '');
      if (!ok) return;
    }

    const s = await getSettings(env);
    const em = await getEmojiResolver(env, s);
    const { user, isNew } = await getOrCreateUser(env, ctx.from, s.bot.default_lang);
    ctx.st = { app, env, s, em, user, isNewUser: isNew, answered: false };

    if (isNew && s.notifications.events.new_user) {
      const name = escapeHtml([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));
      notifyAdminsLater(app, 'new_user', `👤 <b>New user</b>: ${name}${ctx.from.username ? ` @${escapeHtml(ctx.from.username)}` : ''} <code>${ctx.from.id}</code>`);
    }

    try {
      await next();
    } catch (e) {
      console.error('bot handler error', e);
      try {
        if (ctx.callbackQuery) await answer(ctx, plain(tr(ctx, 'err_generic')), true);
        else await ctx.reply(tr(ctx, 'err_generic'), { parse_mode: 'HTML' });
      } catch {
        // ignore
      }
    } finally {
      if (ctx.callbackQuery && !ctx.st.answered) await answer(ctx);
    }
  });

  // 2) gates for customers in private chats: ban, maintenance, language, force join
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    const { s, user } = ctx.st;
    const data = ctx.callbackQuery?.data ?? '';
    const text = ctx.message?.text ?? '';
    if (data.startsWith('adm:') || /^\/(myid|admin|emoji|setemoji|cancel)\b/.test(text)) return next();

    if (user.is_banned) {
      if (ctx.callbackQuery) return answer(ctx, plain(tr(ctx, 'banned')), true);
      return void (await ctx.reply(tr(ctx, 'banned'), { parse_mode: 'HTML' }));
    }

    if (s.bot.maintenance_mode && !(await getAdmin(ctx))) {
      if (ctx.callbackQuery) return answer(ctx, plain(tr(ctx, 'maintenance')), true);
      return void (await ctx.reply(tr(ctx, 'maintenance'), { parse_mode: 'HTML' }));
    }

    if (s.bot.ask_lang_on_start && !user.lang_chosen && !data.startsWith('lang:')) {
      const m = /^\/start(?:@\w+)?\s+(\S+)/.exec(text);
      if (m) await attachReferral(ctx, m[1]);
      if (m && isDeepLink(m[1])) await setState(ctx, { kind: 'pending_link', data: { payload: m[1] } });
      return showLanguagePicker(ctx);
    }

    if (s.force_join.enabled && data !== 'fj' && !data.startsWith('lang:') && !(await getAdmin(ctx))) {
      const m = /^\/start(?:@\w+)?\s+(\S+)/.exec(text);
      if (m) await attachReferral(ctx, m[1]);
      const missing = await checkForceJoin(ctx);
      if (missing.length) {
        if (m && isDeepLink(m[1])) await setState(ctx, { kind: 'pending_link', data: { payload: m[1] } });
        return showForceJoin(ctx, missing);
      }
    }
    return next();
  });

  // 3) routing
  bot.on('callback_query:data', (ctx) => onCallback(ctx, ctx.callbackQuery.data, ctx.me.username));

  bot.on('message', async (ctx) => {
    const text = ctx.message.text ?? (ctx.message.caption?.startsWith('/') ? ctx.message.caption : '');
    const cmd = /^\/([a-zA-Z0-9_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(text ?? '');
    if (cmd && (!cmd[2] || cmd[2].toLowerCase() === ctx.me.username.toLowerCase())) {
      return onCommand(ctx, cmd[1].toLowerCase(), (cmd[3] ?? '').trim(), ctx.me.username);
    }
    if (ctx.chat.type !== 'private') return;
    return onMessage(ctx);
  });
}

/** POST /webhook/telegram */
export async function handleTelegramWebhook(c: HonoContext<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) return c.text('unauthorized', 401);

  let update: Update;
  try {
    update = await c.req.json<Update>();
  } catch {
    return c.text('bad request', 400);
  }

  let waitUntil: AppCtx['waitUntil'];
  try {
    const ec = c.executionCtx;
    waitUntil = (p) => ec.waitUntil(p);
  } catch {
    waitUntil = (p) => void p.catch((e) => console.error('background task failed', e));
  }
  const app: AppCtx = { env, waitUntil };

  try {
    const bot = await getBot(env);
    requests.set(update, app);
    await bot.handleUpdate(update);
  } catch (e) {
    // never make Telegram retry an update that crashed: log and acknowledge
    console.error('update failed', update.update_id, e);
  }
  return c.json({ ok: true });
}
