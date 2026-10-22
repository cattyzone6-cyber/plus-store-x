import type { BotContext } from './context';
import { answer, plain, setState, tr } from './context';
import { showForceJoin, showHome, showLanguagePicker } from './handlers/home';
import { onToggleAlerts, onToggleNotifyMe, showCategory, showPriceList, showProduct, showShop } from './handlers/shop';
import {
  askCustomQty, askPromo, cancelCheckout, chooseQuantity, onInputOption, onInputText, onPromoText, onQtyText,
  payWithGateway, payWithWallet, reopenCheckout, startBuy,
} from './handlers/checkout';
import { askCustomAmount, askProof, onCancelDeposit, onCheckDeposit, onDepositAmountText, onProof, showAmounts, showDepositMenu, showMethods, startDeposit } from './handlers/deposit';
import { askRedeem, createApiKey, onRedeemText, onTxt, redeemPoints, revokeApiKey, showApi, showDiscounts, showOrder, showOrders, showProfile, showReferrals } from './handlers/profile';
import {
  askReplaceDescription, askTicket, onJoinGiveaway, onSetLanguage, onTicketMessage, showFreebie, showFreebies,
  showGiveaway, showGiveaways, showReplaceList, showReplaceOrder, showSupport,
} from './handlers/engagement';
import { cmdAdmin, cmdEmoji, cmdSetEmoji, isAdminState, onAdminCallback, onAdminMessage } from './admin';
import { checkForceJoin } from './forceJoin';
import { rpc } from '../lib/db';
import { notifyUser } from '../services/notify';
import { getUser } from '../services/users';
import { t } from '../lib/i18n';
import type { DepositMethod, Lang } from '../types';

const UUID = /^[0-9a-f-]{36}$/i;
const STATE_TTL_MS = 60 * 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// Callback queries
// ─────────────────────────────────────────────────────────────────────────────

export async function onCallback(ctx: BotContext, data: string, botUsername: string): Promise<void> {
  const parts = data.split(':');
  const [head, a, b, c] = parts;

  // a deep link remembered while the language picker / join gate was shown
  const pendingLink = ctx.st.user.state?.kind === 'pending_link' ? String(ctx.st.user.state.data?.payload ?? '') : '';

  // leaving an input flow by navigating clears the pending state (except option picks)
  if (ctx.st.user.state && head !== 'inp' && head !== 'adm' && !isAdminState(ctx.st.user.state.kind)) await setState(ctx, null);

  switch (head) {
    case 'noop': return answer(ctx);
    case 'home': return showHome(ctx);
    case 'shop': return showShop(ctx);
    case 'sc': return showShop(ctx, a);
    case 'c': return showCategory(ctx, a);
    case 'so': return showProduct(ctx, a); // sold-out products open too ("notify me" button)
    case 'na': return onToggleNotifyMe(ctx, a);
    case 'p': return showProduct(ctx, a);
    case 'b': return startBuy(ctx, a);
    case 'q': return chooseQuantity(ctx, a, Number(b));
    case 'qc': return askCustomQty(ctx, a);
    case 'inp': return onInputOption(ctx, Number(a));
    case 'buy': return payWithWallet(ctx, Number(a));
    case 'pay': return payWithGateway(ctx, Number(a), (b as DepositMethod) || null);
    case 'promo': return askPromo(ctx, Number(a));
    case 'ck': return reopenCheckout(ctx, Number(a));
    case 'cancel': return cancelCheckout(ctx, Number(a), false);
    case 'bk': return cancelCheckout(ctx, Number(a), true);

    case 'dep':
      if (!a) return showDepositMenu(ctx);
      if (a === 'f') return showMethods(ctx);
      if (a === 'm') return showAmounts(ctx, b as DepositMethod);
      if (a === 'a') return startDeposit(ctx, b as DepositMethod, Number(c));
      if (a === 'c') return askCustomAmount(ctx, b as DepositMethod);
      if (a === 'o') return payWithGateway(ctx, Number(b), null);
      if (a === 'check') return onCheckDeposit(ctx, b);
      if (a === 'x') return onCancelDeposit(ctx, b);
      if (a === 'proof') return askProof(ctx, b);
      return answer(ctx);

    case 'prof': return showProfile(ctx);
    case 'al': return onToggleAlerts(ctx, () => showProfile(ctx));
    case 'orders': return showOrders(ctx, Number(a) || 0);
    case 'o': return showOrder(ctx, Number(a));
    case 'txt': return onTxt(ctx, Number(a));
    case 'ref': return showReferrals(ctx, botUsername);
    case 'disc': return showDiscounts(ctx);
    case 'pts': return redeemPoints(ctx);
    case 'redeem': return askRedeem(ctx);
    case 'api':
      if (a === 'new') return createApiKey(ctx);
      if (a === 'rv') return revokeApiKey(ctx, b);
      return showApi(ctx);

    case 'fr': return a ? showFreebie(ctx, a) : showFreebies(ctx);
    case 'gw':
      if (a === 'j') return onJoinGiveaway(ctx, b);
      return a && UUID.test(a) ? showGiveaway(ctx, a) : showGiveaways(ctx);
    case 'sup': return a === 't' ? askTicket(ctx) : showSupport(ctx);
    case 'rep':
      if (a === 'r') return askReplaceDescription(ctx, Number(b), 'replacement');
      if (a === 'f') return askReplaceDescription(ctx, Number(b), 'refund');
      return a ? showReplaceOrder(ctx, Number(a)) : showReplaceList(ctx);
    case 'lang':
      if (a === 'en' || a === 'ar') return onSetLanguage(ctx, a as Lang, pendingLink ? () => openStartPayload(ctx, pendingLink) : undefined);
      return showLanguagePicker(ctx);
    case 'fj': {
      const missing = await checkForceJoin(ctx, true);
      if (missing.length) return answer(ctx, plain(tr(ctx, 'force_join_not_yet')), true);
      await answer(ctx, plain(tr(ctx, 'force_join_ok')));
      return pendingLink ? openStartPayload(ctx, pendingLink) : showHome(ctx);
    }
    case 'adm': return onAdminCallback(ctx, data);
    default: return answer(ctx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

export async function onCommand(ctx: BotContext, command: string, arg: string, botUsername: string): Promise<void> {
  if (ctx.st.user.state && command !== 'setemoji') await setState(ctx, null);
  switch (command) {
    case 'start': return onStart(ctx, arg);
    case 'shop': return showShop(ctx);
    case 'product': case 'products': case 'prices': return showPriceList(ctx);
    case 'deposit': return showDepositMenu(ctx);
    case 'history': case 'orders': return showOrders(ctx, 0);
    case 'profile': case 'balance': return showProfile(ctx);
    case 'referrals': case 'ref': return showReferrals(ctx, botUsername);
    case 'discount': case 'discounts': return showDiscounts(ctx);
    case 'redeem': return askRedeem(ctx);
    case 'events': case 'giveaways': return showGiveaways(ctx);
    case 'api': return showApi(ctx);
    case 'replace': return showReplaceList(ctx);
    case 'support': case 'help': return showSupport(ctx);
    case 'freebies': return showFreebies(ctx);
    case 'lang': case 'language': return showLanguagePicker(ctx);
    case 'cancel': return void (await ctx.reply(tr(ctx, 'state_cancelled'), { parse_mode: 'HTML' }));
    case 'myid': return void (await ctx.reply(`<code>${ctx.from!.id}</code>`, { parse_mode: 'HTML' }));
    case 'admin': return cmdAdmin(ctx);
    case 'emoji': return cmdEmoji(ctx);
    case 'setemoji': return cmdSetEmoji(ctx, arg);
    default: return showHome(ctx, { forceNew: true });
  }
}

/** Attach a referral from a /start ref_<id> payload (new users only, once). */
export async function attachReferral(ctx: BotContext, payload: string): Promise<void> {
  const { env, s, user, isNewUser } = ctx.st;
  if (!payload.startsWith('ref_') || !isNewUser || !s.features.referrals || user.referrer_id) return;
  const refId = Number(payload.slice(4));
  if (!Number.isSafeInteger(refId) || refId === user.id) return;
  const attached = await rpc<boolean>(env, 'referral_attach', { p_user_id: user.id, p_referrer_id: refId }).catch(() => false);
  if (!attached) return;
  user.referrer_id = refId;
  const ref = await getUser(env, refId);
  if (ref) {
    ctx.st.app.waitUntil(notifyUser(env, refId, t(s, ref.lang, 'referral_new_friend', { name: user.first_name || user.username || String(user.id), percent: s.referral.percent }, ctx.st.em)));
  }
}

/** /start [ref_<id> | shop | c_<categoryId> | p_<productId>] */
async function onStart(ctx: BotContext, payload: string): Promise<void> {
  await attachReferral(ctx, payload);
  return openStartPayload(ctx, payload);
}

/** True for payloads that open a screen (worth remembering across the language / join gates). */
export function isDeepLink(payload: string): boolean {
  return payload === 'shop' || (/^[cp]_/.test(payload) && UUID.test(payload.slice(2)));
}

/** Deep links from the landing page, channel posts and alerts. */
export async function openStartPayload(ctx: BotContext, payload: string): Promise<void> {
  if (payload === 'shop') return showShop(ctx);
  if (payload.startsWith('c_') && UUID.test(payload.slice(2))) return showCategory(ctx, payload.slice(2));
  if (payload.startsWith('p_') && UUID.test(payload.slice(2))) return showProduct(ctx, payload.slice(2));
  return showHome(ctx, { forceNew: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Free text / media (conversation states)
// ─────────────────────────────────────────────────────────────────────────────

export async function onMessage(ctx: BotContext): Promise<void> {
  const msg = ctx.message!;
  const st = ctx.st.user.state;

  if (st && isAdminState(st.kind)) {
    if (await onAdminMessage(ctx)) return;
  }

  // admins can drop custom emoji anytime with /emoji in the caption — handled by commands
  if (!st || (st.at && Date.now() - st.at > STATE_TTL_MS)) {
    if (st) await setState(ctx, null);
    return showHome(ctx, { forceNew: true });
  }

  const text = msg.text ?? msg.caption ?? '';
  const photoId = msg.photo?.length ? msg.photo[msg.photo.length - 1].file_id : msg.document?.file_id;
  const data = (st.data ?? {}) as Record<string, unknown>;

  switch (st.kind) {
    case 'await_qty': return text ? onQtyText(ctx, text, data) : void 0;
    case 'await_input': return text ? onInputText(ctx, text, data) : void 0;
    case 'await_promo': return text ? onPromoText(ctx, text, data) : void 0;
    case 'await_deposit_amount': return text ? onDepositAmountText(ctx, text, data) : void 0;
    case 'await_proof':
      if (!photoId && !text) return void (await ctx.reply(tr(ctx, 'deposit_proof_prompt'), { parse_mode: 'HTML' }));
      return onProof(ctx, data, { fileId: photoId, text: text || undefined });
    case 'await_redeem': return text ? onRedeemText(ctx, text) : void 0;
    case 'await_ticket':
      if (!text && !photoId) return;
      return onTicketMessage(ctx, 'support', undefined, { text: text || undefined, fileId: photoId });
    case 'await_replace_desc':
      if (!text && !photoId) return;
      return onTicketMessage(ctx, data.kind === 'refund' ? 'refund' : 'replacement', data, { text: text || undefined, fileId: photoId });
    default:
      await setState(ctx, null);
      return showHome(ctx, { forceNew: true });
  }
}

export { showForceJoin, showLanguagePicker };
