import type { Context } from 'grammy';
import type { AppCtx, Env } from '../env';
import type { AppSettings } from '../lib/settings';
import type { EmojiResolver } from '../lib/emoji';
import type { Lang, UserRow, UserState } from '../types';
import type { InlineKeyboard } from '../lib/telegram';
import { t as translate } from '../lib/i18n';
import { adminByTelegramId } from '../services/notify';
import { setUserState } from '../services/users';

export interface AdminInfo {
  user_id: string;
  role: 'owner' | 'support';
  email: string;
}

/** Per-update state attached to the grammY context by the first middleware. */
export interface BotState {
  app: AppCtx;
  env: Env;
  s: AppSettings;
  em: EmojiResolver;
  user: UserRow;
  isNewUser: boolean;
  /** set once the callback query was answered (to avoid answering twice) */
  answered: boolean;
  adminCache?: Promise<AdminInfo | null>;
}

export type BotContext = Context & { st: BotState };

export function lang(ctx: BotContext): Lang {
  return ctx.st.user.lang;
}

/** Translate with the user's language and the emoji library. */
export function tr(ctx: BotContext, key: string, vars: Record<string, unknown> = {}): string {
  return translate(ctx.st.s, ctx.st.user.lang, key, vars, ctx.st.em);
}

export function getAdmin(ctx: BotContext): Promise<AdminInfo | null> {
  if (!ctx.from) return Promise.resolve(null);
  ctx.st.adminCache ??= adminByTelegramId(ctx.st.env, ctx.from.id).catch(() => null);
  return ctx.st.adminCache;
}

export async function setState(ctx: BotContext, state: UserState | null): Promise<void> {
  await setUserState(ctx.st.env, ctx.st.user.id, state);
  ctx.st.user.state = state ? { ...state, at: Date.now() } : null;
}

/** Answer the pending callback query once (optionally as a toast / alert). */
export async function answer(ctx: BotContext, text?: string, alert = false): Promise<void> {
  if (!ctx.callbackQuery || ctx.st.answered) return;
  ctx.st.answered = true;
  await ctx.answerCallbackQuery(text ? { text: text.slice(0, 200), show_alert: alert } : undefined).catch(() => {});
}

/** Strip HTML tags (for alerts / toasts which are plain text). */
export function plain(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export interface ShowOptions {
  /** image shown above the text via link preview (keeps the message editable) */
  imageUrl?: string | null;
  /** always send a new message instead of editing */
  forceNew?: boolean;
}

function isHttpUrl(u: string | null | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

/**
 * Render a screen: edit the message the button belongs to, or send a new message.
 * Images are shown as a large link preview above the text so every screen stays a
 * text message (editable, 4096 chars).
 */
export async function show(ctx: BotContext, html: string, keyboard: InlineKeyboard = [], opts: ShowOptions = {}): Promise<void> {
  const reply_markup = { inline_keyboard: keyboard } as never;
  const link_preview_options = isHttpUrl(opts.imageUrl)
    ? { url: opts.imageUrl, prefer_large_media: true, show_above_text: true }
    : { is_disabled: true };
  const msg = ctx.callbackQuery?.message;
  if (msg && !opts.forceNew && 'text' in msg && typeof msg.text === 'string') {
    try {
      await ctx.api.editMessageText(msg.chat.id, msg.message_id, html, { parse_mode: 'HTML', reply_markup, link_preview_options });
      return;
    } catch (e) {
      if (/message is not modified/i.test(String((e as Error).message))) return;
      // fall through: send a new message
    }
  }
  await ctx.reply(html, { parse_mode: 'HTML', reply_markup, link_preview_options });
}
