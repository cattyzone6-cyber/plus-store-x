import type { Env } from '../env';
import type { ButtonStyle } from '../types';
import type { EmojiResolver } from './emoji';

// Minimal raw Bot API client for sending outside of a grammY update context
// (cron jobs, webhooks, admin panel actions, notifications).

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  copy_text?: { text: string };
  web_app?: { url: string };
  /** Bot API 9.4: 'primary' (blue) | 'success' (green) | 'danger' (red); omit for default */
  style?: Exclude<ButtonStyle, 'default'>;
  /** Bot API 9.4: custom emoji shown before the text (needs premium owner) */
  icon_custom_emoji_id?: string;
}
export type InlineKeyboard = InlineButton[][];

export class TelegramError extends Error {
  constructor(public method: string, public code: number, public description: string, public retryAfter?: number) {
    super(`Telegram ${method} failed (${code}): ${description}`);
  }
  /** user blocked the bot / deleted account / chat not found */
  get isUnreachable(): boolean {
    return this.code === 403 || /chat not found|user is deactivated|bot was blocked/i.test(this.description);
  }
  get isNotModified(): boolean {
    return /message is not modified/i.test(this.description);
  }
}

export async function tg<T = unknown>(env: Env, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };
  if (!body.ok) {
    throw new TelegramError(method, body.error_code ?? res.status, body.description ?? 'unknown error', body.parameters?.retry_after);
  }
  return body.result as T;
}

export interface SendOptions {
  keyboard?: InlineKeyboard;
  disablePreview?: boolean;
  replyTo?: number;
  silent?: boolean;
}

export function sendMessage(env: Env, chatId: number | string, html: string, opts: SendOptions = {}) {
  return tg<{ message_id: number }>(env, 'sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: opts.disablePreview ?? true },
    reply_markup: opts.keyboard ? { inline_keyboard: opts.keyboard } : undefined,
    reply_parameters: opts.replyTo ? { message_id: opts.replyTo, allow_sending_without_reply: true } : undefined,
    disable_notification: opts.silent,
  });
}

export function sendPhoto(env: Env, chatId: number | string, photo: string, captionHtml: string, opts: SendOptions = {}) {
  return tg<{ message_id: number }>(env, 'sendPhoto', {
    chat_id: chatId,
    photo,
    caption: captionHtml,
    parse_mode: 'HTML',
    reply_markup: opts.keyboard ? { inline_keyboard: opts.keyboard } : undefined,
    disable_notification: opts.silent,
  });
}

/** Send a text file (e.g. "Download as TXT"). */
export async function sendTextDocument(env: Env, chatId: number | string, filename: string, content: string, captionHtml?: string) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([content], { type: 'text/plain' }), filename);
  if (captionHtml) {
    form.append('caption', captionHtml);
    form.append('parse_mode', 'HTML');
  }
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
  const body = (await res.json()) as { ok: boolean; description?: string; error_code?: number };
  if (!body.ok) throw new TelegramError('sendDocument', body.error_code ?? res.status, body.description ?? 'unknown');
}

// ─────────────────────────────────────────────────────────────────────────────
// Button builder: applies colors + custom emoji icon, falls back to plain emoji
// ─────────────────────────────────────────────────────────────────────────────

export interface ButtonSpec {
  text: string;
  /** emoji library key (see DEFAULT_EMOJIS) */
  emoji?: string;
  /** explicit custom emoji id (e.g. from a product) + fallback char */
  customEmojiId?: string | null;
  fallbackEmoji?: string | null;
  style?: ButtonStyle | null;
  data?: string;
  url?: string;
  copy?: string;
  webApp?: string;
}

export function button(spec: ButtonSpec, em?: EmojiResolver): InlineButton {
  const iconId = (em?.premium && spec.customEmojiId) || (spec.emoji ? em?.iconId(spec.emoji) : undefined);
  const plain = spec.fallbackEmoji ?? (spec.emoji ? em?.char(spec.emoji) : '') ?? '';
  const b: InlineButton = { text: iconId || !plain ? spec.text : `${plain} ${spec.text}` };
  if (iconId) b.icon_custom_emoji_id = iconId;
  if (spec.style && spec.style !== 'default') b.style = spec.style;
  if (spec.url) b.url = spec.url;
  else if (spec.copy) b.copy_text = { text: spec.copy };
  else if (spec.webApp) b.web_app = { url: spec.webApp };
  else b.callback_data = spec.data ?? 'noop';
  return b;
}

/** Split a flat list of buttons into rows of `cols`. */
export function grid(buttons: InlineButton[], cols: number): InlineKeyboard {
  const rows: InlineKeyboard = [];
  for (let i = 0; i < buttons.length; i += cols) rows.push(buttons.slice(i, i + cols));
  return rows;
}
