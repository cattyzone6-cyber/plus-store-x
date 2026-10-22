import type { BotContext } from '../context';
import { answer, show, tr } from '../context';
import { backHomeRow, btn, cb, chunkLines, discountPercent, homeRow, loc, priceHtml, priceText, truncate } from '../ui';
import { getCategory, getProductView, listAllProducts, listCategories, listProducts, listUncategorizedProducts, productCounts, UNCATEGORIZED, type ProductView } from '../../services/catalog';
import { fixedQuantity } from '../../services/pricing';
import { hasStockAlert, setAlertsOptIn, toggleStockAlert } from '../../services/alerts';
import { plain } from '../context';
import { customEmojiHtml } from '../../lib/emoji';
import { escapeHtml, raw } from '../../lib/i18n';
import { button, grid, type InlineButton, type InlineKeyboard } from '../../lib/telegram';
import type { CategoryRow, ProductRow } from '../../types';

export function productEmojiHtml(ctx: BotContext, p: Pick<ProductRow, 'custom_emoji_id' | 'emoji'>): string {
  return customEmojiHtml(ctx.st.em.premium, p.custom_emoji_id, p.emoji || ctx.st.em.char('product'));
}

function categoryEmojiHtml(ctx: BotContext, c: CategoryRow): string {
  return customEmojiHtml(ctx.st.em.premium, c.custom_emoji_id, c.emoji || ctx.st.em.char('category'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────

export async function showShop(ctx: BotContext, parentId: string | null = null): Promise<void> {
  const { env, s, em } = ctx.st;
  const lang = ctx.st.user.lang;
  const [cats, counts] = await Promise.all([listCategories(env, parentId), productCounts(env)]);
  const parent = parentId ? await getCategory(env, parentId) : null;

  // categories that have products or sub categories
  const visible = cats.filter((c) => (counts.get(c.id) ?? 0) > 0 || !parentId);
  const uncategorized = parentId ? 0 : counts.get(UNCATEGORIZED) ?? 0;
  if (!visible.length) {
    // no categories yet: list the products directly instead of an empty shop
    if (uncategorized > 0) return showUncategorized(ctx);
    await show(ctx, tr(ctx, 'shop_empty'), [homeRow(ctx)]);
    return;
  }
  const buttons = visible.map((c) =>
    button({ text: loc(c, 'name', lang), customEmojiId: c.custom_emoji_id, fallbackEmoji: c.emoji || em.char('category'), style: c.button_style, data: cb('c', c.id) }, em),
  );
  if (uncategorized > 0) buttons.push(button({ text: tr(ctx, 'btn_other_products'), emoji: 'product', style: 'default', data: cb('c', UNCATEGORIZED) }, em));
  const kb = grid(buttons, s.bot.category_columns);
  kb.push(parent ? backHomeRow(ctx, parent.parent_id ? cb('sc', parent.parent_id) : 'shop') : homeRow(ctx));
  const title = parent ? `${categoryEmojiHtml(ctx, parent)} <b>${escapeHtml(loc(parent, 'name', lang))}</b>\n\n${tr(ctx, 'shop_choose')}` : tr(ctx, 'shop_title');
  await show(ctx, title, kb);
}

export function productButtonText(ctx: BotContext, v: ProductView): string {
  const name = loc(v.product, 'name', ctx.st.user.lang);
  const p = v.pricing;
  if (p.unitPrice == null) return name;
  if (p.soldOut) return truncate(`${name} | ${priceText(p.unitPrice)} | ${tr(ctx, 'sold_out_short')}`, 60);
  const stock = p.available == null ? '∞' : String(p.available);
  return truncate(`${name} | ${priceText(p.unitPrice, p.originalUnitPrice)} | ${stock}`, 60);
}

function productButton(ctx: BotContext, v: ProductView): InlineButton {
  const { s, em } = ctx.st;
  const soldOut = v.pricing.soldOut;
  return button({
    text: productButtonText(ctx, v),
    customEmojiId: soldOut ? null : v.product.custom_emoji_id,
    fallbackEmoji: soldOut ? em.char('sold_out') : v.product.emoji || em.char('product'),
    style: soldOut ? s.bot.sold_out_style : v.product.button_style ?? s.bot.in_stock_style,
    data: soldOut ? cb('so', v.product.id) : cb('p', v.product.id),
  }, em);
}

/** Products that have no category (a virtual "Other products" category). */
export async function showUncategorized(ctx: BotContext): Promise<void> {
  const { env, s, user } = ctx.st;
  const [products, cats] = await Promise.all([listUncategorizedProducts(env, s, user), listCategories(env, null)]);
  if (!products.length) return showShop(ctx);
  const kb: InlineKeyboard = products.map((v) => [productButton(ctx, v)]);
  kb.push(cats.length ? backHomeRow(ctx, 'shop') : homeRow(ctx));
  await show(ctx, tr(ctx, cats.length ? 'category_other_view' : 'shop_all_products', { count: products.length }), kb);
}

export async function showCategory(ctx: BotContext, categoryId: string): Promise<void> {
  const { env, s, em, user } = ctx.st;
  const lang = user.lang;
  if (categoryId === UNCATEGORIZED) return showUncategorized(ctx);
  const cat = await getCategory(env, categoryId);
  if (!cat || !cat.is_active) {
    await showShop(ctx);
    return;
  }
  const [subs, products] = await Promise.all([listCategories(env, cat.id), listProducts(env, s, cat.id, user)]);

  const kb: InlineKeyboard = [];
  for (const sub of subs) {
    kb.push([button({ text: loc(sub, 'name', lang), customEmojiId: sub.custom_emoji_id, fallbackEmoji: sub.emoji || em.char('category'), style: sub.button_style, data: cb('c', sub.id) }, em)]);
  }
  for (const v of products) kb.push([productButton(ctx, v)]);
  kb.push(backHomeRow(ctx, cat.parent_id ? cb('c', cat.parent_id) : 'shop'));

  const reduced = products.filter((v) => !v.pricing.soldOut && discountPercent(v.pricing.unitPrice ?? 0, v.pricing.originalUnitPrice) > 0).length;
  const desc = loc(cat, 'description', lang);
  const html = tr(ctx, products.length ? 'category_view' : 'category_empty', {
    emoji: raw(categoryEmojiHtml(ctx, cat)),
    name: loc(cat, 'name', lang),
    description: raw(desc ? `<blockquote>${escapeHtml(desc)}</blockquote>\n` : ''),
    sale: raw(reduced ? `${tr(ctx, 'category_sale_line', { n: reduced, count: products.length })}\n\n` : ''),
    count: products.length,
  });
  await show(ctx, html, kb, { imageUrl: cat.image_url });
}

// ─────────────────────────────────────────────────────────────────────────────
// Product
// ─────────────────────────────────────────────────────────────────────────────

export function stockText(ctx: BotContext, v: ProductView): string {
  if (v.pricing.soldOut) return tr(ctx, 'stock_sold_out');
  if (v.product.fulfillment === 'manual' || v.pricing.route.every((o) => o.source.kind === 'manual')) return tr(ctx, 'stock_by_hand');
  if (v.pricing.available == null) return tr(ctx, 'stock_unlimited');
  return tr(ctx, 'stock_count', { n: v.pricing.available });
}

export function deliveryTypeText(ctx: BotContext, v: ProductView): string {
  if (v.product.fulfillment === 'manual') return tr(ctx, 'type_manual');
  const first = v.pricing.route[0];
  if (!first) return tr(ctx, 'type_instant');
  if (first.source.kind === 'manual') return tr(ctx, 'type_manual');
  if (first.providerProduct?.delivery_kind === 'activation') return tr(ctx, 'type_activation');
  if (first.providerProduct?.delivery_kind === 'async') return tr(ctx, 'type_async');
  return tr(ctx, 'type_instant');
}

export function warrantyText(ctx: BotContext, days: number): string {
  return days > 0 ? tr(ctx, 'warranty_days', { n: days }) : tr(ctx, 'warranty_none');
}

/** "$12.83 · Special discount — 5% off" */
export function priceLineHtml(ctx: BotContext, v: ProductView): string {
  const p = v.pricing;
  if (p.unitPrice == null) return '—';
  let html = priceHtml(p.unitPrice, p.originalUnitPrice);
  const pct = discountPercent(p.unitPrice, p.originalUnitPrice);
  if (pct > 0) {
    const label = p.userDiscountPercent > 0 ? tr(ctx, 'label_special') : tr(ctx, 'label_sale');
    html += tr(ctx, 'discount_label', { label, p: pct });
  }
  return html;
}

export async function showProduct(ctx: BotContext, productId: string): Promise<void> {
  const { env, s, user } = ctx.st;
  const lang = user.lang;
  const v = await getProductView(env, s, productId, user);
  if (!v || !v.product.is_active || v.pricing.unitPrice == null) {
    await answer(ctx, tr(ctx, 'err_PRODUCT_NOT_FOUND'), true);
    await showShop(ctx);
    return;
  }
  const { product } = v;
  const lines: string[] = [tr(ctx, 'product_price_line', { price: raw(priceLineHtml(ctx, v)) })];
  const duration = loc(product, 'duration', lang);
  if (duration) lines.push(tr(ctx, 'product_duration_line', { duration }));
  lines.push(tr(ctx, 'product_warranty_line', { warranty: warrantyText(ctx, product.warranty_days) }));
  lines.push(tr(ctx, 'product_stock_line', { stock: stockText(ctx, v) }));
  lines.push(tr(ctx, 'product_type_line', { type: deliveryTypeText(ctx, v) }));
  if (product.sold_count > 0) lines.push(tr(ctx, 'product_sold_line', { n: product.sold_count }));

  const desc = loc(product, 'description', lang);
  const manual = product.fulfillment === 'manual' || v.pricing.route[0]?.source.kind === 'manual';
  const html = tr(ctx, 'product_view', {
    emoji: raw(productEmojiHtml(ctx, product)),
    name: loc(product, 'name', lang),
    details: raw(lines.join('\n')),
    description: raw(desc ? tr(ctx, 'product_description_block', { description: desc }) : ''),
    footer: raw(v.pricing.soldOut ? tr(ctx, 'product_footer_sold_out') : manual ? tr(ctx, 'product_footer_manual') : tr(ctx, 'product_footer_instant')),
  });

  const kb: InlineKeyboard = [];
  if (!v.pricing.soldOut) kb.push([btn(ctx, 'btn_buy_now', cb('b', product.id), 'shop', s.bot.buy_style)]);
  else if (s.alerts.notify_me) {
    const on = await hasStockAlert(env, user.id, product.id);
    kb.push([btn(ctx, on ? 'btn_notify_on' : 'btn_notify_me', cb('na', product.id), 'bell', on ? 'success' : 'primary')]);
  }
  kb.push(backHomeRow(ctx, product.category_id ? cb('c', product.category_id) : 'shop'));
  await show(ctx, html, kb, { imageUrl: product.image_url });
}

/** Quantity picker (or skip it when the quantity is forced / only 1 allowed). */
export async function showQuantity(ctx: BotContext, productId: string): Promise<'shown' | number> {
  const { env, s, user } = ctx.st;
  const v = await getProductView(env, s, productId, user);
  if (!v || v.pricing.unitPrice == null || v.pricing.soldOut) {
    await answer(ctx, tr(ctx, 'err_SOLD_OUT'), true);
    return 'shown';
  }
  const { product } = v;
  const forced = fixedQuantity(v.pricing.route);
  const max = Math.min(product.max_qty, v.pricing.available ?? Number.MAX_SAFE_INTEGER);
  if (forced) return forced;
  if (max <= 1 || product.max_qty === 1) return Math.max(1, product.min_qty);

  const presets = (product.qty_presets?.length ? product.qty_presets : s.bot.qty_presets).filter((q) => q >= product.min_qty && q <= max);
  const buttons: InlineButton[] = presets.map((q) => button({ text: String(q), data: cb('q', product.id, q) }, ctx.st.em));
  const kb = grid(buttons, 4);
  kb.push([btn(ctx, 'btn_custom_qty', cb('qc', product.id), 'quantity')]);
  kb.push([btn(ctx, 'btn_back_to_product', cb('p', product.id), 'back', s.bot.nav_style)]);

  const html = tr(ctx, 'qty_prompt', {
    emoji: raw(productEmojiHtml(ctx, product)),
    name: loc(product, 'name', user.lang),
    price: raw(priceLineHtml(ctx, v)),
    delivery: deliveryTypeText(ctx, v),
  });
  await show(ctx, html, kb);
  return 'shown';
}

/** /product — price list of everything in stock. */
export async function showPriceList(ctx: BotContext): Promise<void> {
  const { env, s, user } = ctx.st;
  const views = await listAllProducts(env, s, user);
  if (!views.length) {
    await show(ctx, tr(ctx, 'pricelist_empty'), [homeRow(ctx)], { forceNew: true });
    return;
  }
  const lines = views.map((v) =>
    tr(ctx, 'pricelist_line', {
      emoji: raw(productEmojiHtml(ctx, v.product)),
      name: loc(v.product, 'name', user.lang),
      price: raw(priceHtml(v.pricing.unitPrice!, v.pricing.originalUnitPrice)),
      link: s.brand.bot_username || '',
    }),
  );
  const chunks = chunkLines([tr(ctx, 'pricelist_title'), ...lines]);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    await ctx.reply(chunks[i], {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: last ? ({ inline_keyboard: [[btn(ctx, 'btn_shop', 'shop', 'shop', 'primary')], homeRow(ctx)] } as never) : undefined,
    });
  }
}

/** "Notify me when available" on a sold-out product (toggles). */
export async function onToggleNotifyMe(ctx: BotContext, productId: string): Promise<void> {
  const on = await toggleStockAlert(ctx.st.env, ctx.st.s, ctx.st.user.id, productId);
  await answer(ctx, plain(tr(ctx, on === null ? 'notify_me_unavailable' : on ? 'notify_me_added' : 'notify_me_removed')), on !== false);
  await showProduct(ctx, productId);
}

/** Profile switch for new-product / back-in-stock announcements. */
export async function onToggleAlerts(ctx: BotContext, next: () => Promise<void>): Promise<void> {
  const on = !ctx.st.user.alerts_opt_in;
  await setAlertsOptIn(ctx.st.env, ctx.st.user.id, on);
  ctx.st.user = { ...ctx.st.user, alerts_opt_in: on };
  await answer(ctx, plain(tr(ctx, on ? 'alerts_turned_on' : 'alerts_turned_off')));
  await next();
}
