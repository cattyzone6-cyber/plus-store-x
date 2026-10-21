import type { AppCtx, Env } from '../env';
import type { AppSettings } from '../lib/settings';
import { getSettings } from '../lib/settings';
import { db, must } from '../lib/db';
import { sendMessage, TelegramError, type InlineKeyboard } from '../lib/telegram';
import { markBlocked } from './users';

export type AdminEvent = keyof AppSettings['notifications']['events'] | 'system';

/**
 * Send an alert to the admin chat (settings.notifications.chat_id). When no chat is
 * configured, every admin with a linked telegram_id receives it directly.
 * Admin alerts are English (admins share one language).
 */
export async function notifyAdmins(env: Env, event: AdminEvent, html: string, keyboard?: InlineKeyboard): Promise<void> {
  const s = await getSettings(env);
  if (event !== 'system' && !s.notifications.events[event]) return;
  const targets: (string | number)[] = [];
  if (s.notifications.chat_id) targets.push(s.notifications.chat_id);
  else {
    const admins = must(await db(env).from('admins').select('telegram_id').not('telegram_id', 'is', null), 'admins') as { telegram_id: number }[];
    targets.push(...admins.map((a) => a.telegram_id));
  }
  await Promise.all(
    targets.map((chat) =>
      sendMessage(env, chat, html, { keyboard }).catch((e) => console.error('notifyAdmins failed', chat, e)),
    ),
  );
}

/** Fire-and-forget variant. */
export function notifyAdminsLater(app: AppCtx, event: AdminEvent, html: string, keyboard?: InlineKeyboard): void {
  app.waitUntil(notifyAdmins(app.env, event, html, keyboard));
}

/** Message a customer; marks them as having blocked the bot when unreachable. Returns false on failure. */
export async function notifyUser(env: Env, userId: number, html: string, keyboard?: InlineKeyboard): Promise<boolean> {
  try {
    await sendMessage(env, userId, html, { keyboard });
    return true;
  } catch (e) {
    if (e instanceof TelegramError && e.isUnreachable) await markBlocked(env, userId);
    else console.error('notifyUser failed', userId, e);
    return false;
  }
}

/** Is this Telegram user an admin (linked in the admin panel)? */
export async function adminByTelegramId(env: Env, telegramId: number): Promise<{ user_id: string; role: 'owner' | 'support'; email: string } | null> {
  return must(
    await db(env).from('admins').select('user_id,role,email').eq('telegram_id', telegramId).maybeSingle(),
    'admin by tg',
  ) as { user_id: string; role: 'owner' | 'support'; email: string } | null;
}

export async function audit(env: Env, entry: { admin_id?: string | null; admin_email?: string | null; action: string; entity?: string; entity_id?: string | number; data?: unknown }): Promise<void> {
  await db(env).from('audit_log').insert({
    admin_id: entry.admin_id ?? null,
    admin_email: entry.admin_email ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entity_id: entry.entity_id != null ? String(entry.entity_id) : null,
    data: entry.data ?? null,
  });
}
