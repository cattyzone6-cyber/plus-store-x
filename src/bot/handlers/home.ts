import type { BotContext } from '../context';
import { show, tr } from '../context';
import { buildMainMenu, visibleMenu } from '../ui';
import { escapeHtml, raw } from '../../lib/i18n';
import { button } from '../../lib/telegram';

/** Welcome screen + main menu. */
export async function showHome(ctx: BotContext, opts: { forceNew?: boolean } = {}): Promise<void> {
  const { s, em, user } = ctx.st;
  const lang = user.lang;

  const menuLines = visibleMenu(s)
    .filter((m) => !['website', 'channel', 'language'].includes(m.id))
    .map((m) => tr(ctx, `menu_line_${m.id}`))
    .filter((l) => l && !l.startsWith('menu_line_'));

  const links: string[] = [];
  if (s.brand.channel_url) links.push(tr(ctx, 'welcome_channel_line', { url: s.brand.channel_url }));
  if (s.brand.group_url) links.push(tr(ctx, 'welcome_group_line', { url: s.brand.group_url }));

  const html = tr(ctx, 'welcome', {
    brand: s.brand.name,
    name: user.first_name || user.username || '',
    tagline: lang === 'ar' ? s.brand.tagline_ar : s.brand.tagline_en,
    menu: raw(menuLines.join('\n')),
    links: raw(links.length ? `\n${links.join('\n')}\n` : ''),
  });
  await show(ctx, html, buildMainMenu(s, em, lang), { imageUrl: s.bot.welcome_image_url || null, forceNew: opts.forceNew });
}

export async function showLanguagePicker(ctx: BotContext): Promise<void> {
  const { em } = ctx.st;
  await show(ctx, tr(ctx, 'lang_pick'), [[
    button({ text: 'English', fallbackEmoji: '🇬🇧', data: 'lang:en', style: 'primary' }, em),
    button({ text: 'العربية', fallbackEmoji: '🇸🇾', data: 'lang:ar', style: 'primary' }, em),
  ]]);
}

/** "Join to continue" screen. */
export async function showForceJoin(ctx: BotContext, missing: { title: string; url: string }[]): Promise<void> {
  const { em } = ctx.st;
  const list = missing.map((c) => `➤ <b>${escapeHtml(c.title)}</b>`).join('\n');
  const kb = missing.map((c) => [button({ text: tr(ctx, 'btn_join', { title: c.title }), emoji: 'join', url: c.url }, em)]);
  kb.push([button({ text: tr(ctx, 'btn_joined'), emoji: 'confirm', data: 'fj', style: 'primary' }, em)]);
  await show(ctx, tr(ctx, 'force_join', { list: raw(list) }), kb);
}
