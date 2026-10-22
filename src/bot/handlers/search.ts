import type { Context } from 'grammy';
import type { InlineQueryResultArticle } from 'grammy/types';
import type { AppCtx } from '../../env';
import type { BotContext } from '../context';
import { setState, show, tr } from '../context';
import { btn, homeRow, loc, priceText, truncate } from '../ui';
import { groupButton, productButton, searchButton } from './shop';
import { featuredCatalog, searchCatalog, searchWords, type SearchResult } from '../../services/search';
import type { ProductView } from '../../services/catalog';
import { getSettings } from '../../lib/settings';
import { getEmojiResolver, type EmojiResolver } from '../../lib/emoji';
import { escapeHtml, raw, t } from '../../lib/i18n';
import { fmtUsd } from '../../lib/money';
import { getUser, langFromCode } from '../../services/users';
import type { Lang } from '../../types';

const MAX_RESULTS = 20;

// ─────────────────────────────────────────────────────────────────────────────
// In-bot search (/search, the Search button on the shop screen)
// ─────────────────────────────────────────────────────────────────────────────

/** "Type what you're looking for" — the next text message is the query. */
export async function askSearch(ctx: BotContext): Promise<void> {
  await setState(ctx, { kind: 'await_search' });
  await show(ctx, tr(ctx, 'search_prompt'), [[btn(ctx, 'btn_browse_shop', 'shop', 'shop')], homeRow(ctx)]);
}

/** Results screen. The state stays, so typing another word searches again. */
export async function runSearch(ctx: BotContext, query: string): Promise<void> {
  const { env, s, user } = ctx.st;
  const q = query.trim().slice(0, 64);
  if (!searchWords(q).length) {
    await setState(ctx, { kind: 'await_search' });
    await show(ctx, tr(ctx, 'search_too_short'), [[btn(ctx, 'btn_browse_shop', 'shop', 'shop')], homeRow(ctx)], { forceNew: !ctx.callbackQuery });
    return;
  }
  const { groups, packs } = await searchCatalog(env, s, q, user, MAX_RESULTS);
  await setState(ctx, { kind: 'await_search' });
  const count = groups.length + packs.length;
  const kb = [...groups.map((g) => [groupButton(ctx, g)]), ...packs.map((v) => [productButton(ctx, v)])];
  kb.push([searchButton(ctx, 'btn_search_again'), btn(ctx, 'btn_browse_shop', 'shop', 'shop')]);
  kb.push(homeRow(ctx));
  await show(ctx, tr(ctx, count ? 'search_results' : 'search_none', { query: q, count }), kb, { forceNew: !ctx.callbackQuery });
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline mode (@bot capcut) — needs inline mode turned on in BotFather (/setinline)
// ─────────────────────────────────────────────────────────────────────────────

function isHttpUrl(u: string | null | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

/** Inline cards are sent into any chat: plain emoji only (no custom emoji). */
function plainEmoji(em: EmojiResolver): EmojiResolver {
  return { premium: false, char: em.char, iconId: () => undefined, html: (k) => em.char(k) };
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

function stockLabel(tt: Translate, v: ProductView): string {
  if (v.pricing.soldOut) return tt('inline_sold_out');
  if (v.pricing.available != null) return tt('stock_count', { n: v.pricing.available });
  return tt('stock_unlimited');
}

function descriptionBlock(text: string): string {
  const d = text.trim();
  return d ? `\n<i>${escapeHtml(truncate(d, 300))}</i>` : '';
}

export function inlineResults(res: SearchResult, lang: Lang, botUsername: string, tt: Translate, em: EmojiResolver): InlineQueryResultArticle[] {
  const open = (payload: string) => ({ inline_keyboard: [[{ text: tt('btn_open_in_bot'), url: `https://t.me/${botUsername}?start=${payload}` }]] });
  const out: InlineQueryResultArticle[] = [];

  for (const g of res.groups) {
    const name = loc(g.group, 'name', lang);
    const price = g.fromPrice != null ? fmtUsd(g.fromPrice) : '—';
    out.push({
      type: 'article',
      id: `g${g.group.id}`,
      title: name,
      description: g.inStock ? tt('inline_group_desc', { price }) : tt('inline_sold_out'),
      ...(isHttpUrl(g.group.image_url) ? { thumbnail_url: g.group.image_url } : {}),
      input_message_content: {
        message_text: tt('inline_group_card', {
          emoji: g.group.emoji || em.char('product'),
          name,
          price,
          count: g.packs.length,
          description: raw(descriptionBlock(loc(g.group, 'description', lang))),
        }),
        parse_mode: 'HTML',
        link_preview_options: isHttpUrl(g.group.image_url) ? { url: g.group.image_url, prefer_large_media: true, show_above_text: true } : { is_disabled: true },
      },
      reply_markup: open(`g_${g.group.id}`),
    });
  }

  for (const v of res.packs) {
    const name = loc(v.product, 'name', lang);
    const price = priceText(v.pricing.unitPrice!, v.pricing.originalUnitPrice);
    const stock = stockLabel(tt, v);
    out.push({
      type: 'article',
      id: `p${v.product.id}`,
      title: name,
      description: tt('inline_pack_desc', { price, stock }),
      ...(isHttpUrl(v.product.image_url) ? { thumbnail_url: v.product.image_url } : {}),
      input_message_content: {
        message_text: tt('inline_pack_card', {
          emoji: v.product.emoji || em.char('product'),
          name,
          price,
          stock,
          description: raw(descriptionBlock(loc(v.product, 'description', lang))),
        }),
        parse_mode: 'HTML',
        link_preview_options: isHttpUrl(v.product.image_url) ? { url: v.product.image_url, prefer_large_media: true, show_above_text: true } : { is_disabled: true },
      },
      reply_markup: open(`p_${v.product.id}`),
    });
  }
  return out.slice(0, MAX_RESULTS);
}

/**
 * Answer an inline query. Runs before the user middleware (no user is created for inline
 * queries). Prices are the public ones (no personal discounts: the card is shared). Results
 * are personal because the language follows the user.
 */
export async function onInlineQuery(ctx: Context, app: AppCtx): Promise<void> {
  const iq = ctx.inlineQuery!;
  const { env } = app;
  const s = await getSettings(env);
  const user = await getUser(env, iq.from.id).catch(() => null);
  if (user?.is_banned || s.bot.maintenance_mode) {
    await ctx.answerInlineQuery([], { cache_time: 60, is_personal: true });
    return;
  }
  const lang: Lang = user?.lang ?? langFromCode(iq.from.language_code, s.bot.default_lang);
  const em = plainEmoji(await getEmojiResolver(env, s));
  const tt = (key: string, vars: Record<string, unknown> = {}) => t(s, lang, key, vars, em);

  const query = iq.query.trim().slice(0, 64);
  const res = query && searchWords(query).length
    ? await searchCatalog(env, s, query, null, MAX_RESULTS)
    : await featuredCatalog(env, s, null, MAX_RESULTS);
  await ctx.answerInlineQuery(inlineResults(res, lang, ctx.me.username, tt, em), {
    cache_time: 60,
    is_personal: true,
    button: { text: tt('inline_open_shop'), start_parameter: 'shop' },
  });
}
