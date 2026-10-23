import type { AdminInfo, BotContext } from './context';
import { answer, getAdmin, setState, show } from './context';
import { fmtDateTime, statusLabel } from './ui';
import { db, must, rpc } from '../lib/db';
import { escapeHtml } from '../lib/i18n';
import { fmtUsd } from '../lib/money';
import { baseUrl, saveSettingsSection } from '../lib/settings';
import type { InlineButton, InlineKeyboard } from '../lib/telegram';
import { enqueue } from '../lib/jobs';
import { audit, notifyUser } from '../services/notify';
import { acceptPendingCost } from '../services/price-guards';
import { getUser } from '../services/users';
import type { DepositRow, OrderRow, TicketRow, UserRow } from '../types';

// The same bot, seen by an admin: /start and /admin open this home instead of the shop.
// Work first (what is waiting, today's numbers), then lookups and quick actions.
// Owner-only: cost / profit, balances, providers, maintenance. Callback prefix "ad".

/** Bilingual admin text (admins read the panel in their own language). */
function L(ctx: BotContext, en: string, ar: string): string {
  return ctx.st.user.lang === 'ar' ? ar : en;
}

function b(text: string, data: string, style?: 'primary' | 'success' | 'danger'): InlineButton {
  return { text, callback_data: data, ...(style ? { style } : {}) } as InlineButton;
}

function navRow(ctx: BotContext, back?: string): InlineButton[] {
  const row = [b(L(ctx, '🛠 Admin home', '🛠 الإدارة'), 'ad', 'success')];
  if (back) row.unshift(b(L(ctx, '⬅️ Back', '⬅️ رجوع'), back, 'primary'));
  return row;
}

async function requireAdmin(ctx: BotContext): Promise<AdminInfo | null> {
  const admin = await getAdmin(ctx);
  if (!admin) await answer(ctx, 'Admins only.', true);
  return admin;
}

function userLabel(u: Pick<UserRow, 'id' | 'first_name' | 'last_name' | 'username'> | null, id?: number): string {
  if (!u) return `<code>${id ?? '?'}</code>`;
  const name = escapeHtml([u.first_name, u.last_name].filter(Boolean).join(' ') || String(u.id));
  return `${name}${u.username ? ` @${escapeHtml(u.username)}` : ''} <code>${u.id}</code>`;
}

function startOfTodayUtc(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

const headCount = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> => {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.count ?? 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Home: inbox counts + today
// ─────────────────────────────────────────────────────────────────────────────

export async function showAdminHome(ctx: BotContext, opts: { forceNew?: boolean } = {}): Promise<void> {
  const admin = await requireAdmin(ctx);
  if (!admin) return;
  const { env, s } = ctx.st;
  const owner = admin.role === 'owner';
  const since = startOfTodayUtc();
  const count = (table: string) => db(env).from(table).select('*', { count: 'exact', head: true });

  const [manual, review, tickets, failed, atProvider, paused, stats, profit] = await Promise.all([
    headCount(count('orders').eq('status', 'manual_pending')),
    headCount(count('deposits').eq('status', 'confirming')),
    headCount(count('tickets').eq('status', 'open')),
    headCount(count('orders').eq('status', 'failed')),
    headCount(count('orders').eq('status', 'awaiting_provider')),
    owner ? headCount(count('products').eq('is_active', true).not('paused_reason', 'is', null)) : Promise.resolve(0),
    rpc<{ orders: number; deposits: number; deposits_count: number; new_users: number }>(env, 'admin_stats', { p_from: since }),
    owner ? rpc<{ totals: { revenue: number; profit: number; orders: number } }>(env, 'admin_profit', { p_from: since, p_to: new Date().toISOString() }) : Promise.resolve(null),
  ]);

  const lines: string[] = [
    `🛠 <b>${L(ctx, 'Admin', 'الإدارة')}</b> · ${escapeHtml(admin.email)} (${owner ? L(ctx, 'owner', 'مالك') : L(ctx, 'support', 'دعم')})`,
    s.bot.maintenance_mode ? `🚧 <b>${L(ctx, 'Maintenance mode is ON — customers cannot use the bot', 'وضع الصيانة مفعّل — الزبائن لا يستطيعون استخدام البوت')}</b>` : '',
    '',
    `📊 <b>${L(ctx, 'Today (UTC)', 'اليوم (UTC)')}</b>`,
    owner && profit
      ? `${L(ctx, 'Sales', 'المبيعات')}: <b>${fmtUsd(profit.totals.revenue)}</b> · ${L(ctx, 'profit', 'الربح')}: <b>${fmtUsd(profit.totals.profit)}</b> · ${L(ctx, 'orders', 'طلبات')}: <b>${profit.totals.orders}</b>`
      : `${L(ctx, 'Orders', 'الطلبات')}: <b>${stats.orders}</b>`,
    `${L(ctx, 'Top-ups', 'الشحنات')}: <b>${stats.deposits_count}</b>${owner ? ` (${fmtUsd(stats.deposits)})` : ''} · ${L(ctx, 'new customers', 'زبائن جدد')}: <b>${stats.new_users}</b>`,
  ];
  if (atProvider) lines.push(`⏳ ${L(ctx, 'At provider (being prepared)', 'عند المزوّد (قيد التجهيز)')}: <b>${atProvider}</b>`);
  const waiting = manual + review + tickets + failed + paused;
  lines.push('', waiting ? `📥 <b>${L(ctx, 'Waiting for you', 'بانتظارك')}</b> 👇` : `✅ ${L(ctx, 'Nothing is waiting for you.', 'لا شيء بانتظارك.')}`);

  const tag = (n: number) => (n ? ` (${n})` : '');
  const kb: InlineKeyboard = [
    [b(`📦 ${L(ctx, 'Deliver', 'تسليم يدوي')}${tag(manual)}`, 'ad:in:man', 'success'), b(`💳 ${L(ctx, 'Payments', 'دفعات للمراجعة')}${tag(review)}`, 'ad:in:dep', 'success')],
    [b(`🎫 ${L(ctx, 'Tickets', 'التذاكر')}${tag(tickets)}`, 'ad:in:tk', 'primary'), b(`⚠️ ${L(ctx, 'Failed', 'طلبات فاشلة')}${tag(failed)}`, 'ad:in:fail', 'danger')],
  ];
  if (owner) kb.push([b(`⏸ ${L(ctx, 'Paused packs', 'باقات موقوفة')}${tag(paused)}`, 'ad:in:pause', 'danger'), b(`⚙️ ${L(ctx, 'Quick actions', 'إجراءات سريعة')}`, 'ad:qa', 'primary')]);
  kb.push([b(`🔎 ${L(ctx, 'Find order / customer', 'بحث عن طلب أو زبون')}`, 'ad:find', 'primary')]);
  kb.push([b(`👁 ${L(ctx, 'View as customer', 'عرض كزبون')}`, 'home', 'success'), b(`🔄 ${L(ctx, 'Refresh', 'تحديث')}`, 'ad:r', 'primary')]);
  const panel = baseUrl(s);
  if (panel) kb.push([{ text: `🌐 ${L(ctx, 'Admin panel', 'لوحة التحكم')}`, url: `${panel}/admin/`, style: 'primary' } as InlineButton]);

  await show(ctx, lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'), kb, { forceNew: opts.forceNew });
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbox lists
// ─────────────────────────────────────────────────────────────────────────────

async function showList(ctx: BotContext, kind: string): Promise<void> {
  const admin = await requireAdmin(ctx);
  if (!admin) return;
  const { env } = ctx.st;
  const kb: InlineKeyboard = [];
  let title = '';

  if (kind === 'man' || kind === 'fail') {
    const rows = must(
      await db(env).from('orders').select('id,code,product_name,quantity,total,paid_at').eq('status', kind === 'man' ? 'manual_pending' : 'failed').order('paid_at', { ascending: true }).limit(15),
      'admin orders',
    ) as Pick<OrderRow, 'id' | 'code' | 'product_name' | 'quantity' | 'total'>[];
    title = kind === 'man' ? `📦 <b>${L(ctx, 'Orders to deliver by hand', 'طلبات للتسليم اليدوي')}</b>` : `⚠️ <b>${L(ctx, 'Failed orders', 'طلبات فاشلة')}</b>`;
    for (const o of rows) kb.push([b(`${o.code} · ${o.product_name.slice(0, 32)} ×${o.quantity} · ${fmtUsd(o.total)}`, `ad:o:${o.id}`, kind === 'man' ? 'success' : 'danger')]);
  } else if (kind === 'dep') {
    const rows = must(
      await db(env).from('deposits').select('id,method,amount_usd,reference,created_at').eq('status', 'confirming').order('created_at', { ascending: true }).limit(15),
      'admin deposits',
    ) as Pick<DepositRow, 'id' | 'method' | 'amount_usd' | 'reference'>[];
    title = `💳 <b>${L(ctx, 'Payments to review', 'دفعات للمراجعة')}</b>`;
    for (const d of rows) kb.push([b(`${fmtUsd(d.amount_usd)} · ${d.method} · ${d.reference ?? ''}`, `ad:d:${d.id}`, 'success')]);
  } else if (kind === 'tk') {
    const rows = must(
      await db(env).from('tickets').select('id,kind,message,created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(15),
      'admin tickets',
    ) as Pick<TicketRow, 'id' | 'kind' | 'message'>[];
    title = `🎫 <b>${L(ctx, 'Open tickets', 'تذاكر مفتوحة')}</b>`;
    const kindLabel = (k: TicketRow['kind']) => ({ replacement: L(ctx, 'replacement', 'استبدال'), refund: L(ctx, 'refund', 'استرداد'), support: L(ctx, 'support', 'دعم') })[k];
    for (const t of rows) kb.push([b(`#${t.id} · ${kindLabel(t.kind)} · ${(t.message ?? '').slice(0, 30)}`, `ad:t:${t.id}`, 'primary')]);
  } else if (kind === 'pause') {
    if (admin.role !== 'owner') return void (await answer(ctx, 'Owner only.', true));
    const rows = must(
      await db(env).from('products').select('id,name_en,paused_reason').eq('is_active', true).not('paused_reason', 'is', null).order('name_en').limit(20),
      'admin paused',
    ) as { id: string; name_en: string; paused_reason: string }[];
    title = `⏸ <b>${L(ctx, 'Packs paused by price protection', 'باقات أوقفتها حماية الأسعار')}</b>`;
    for (const p of rows) kb.push([b(`${p.paused_reason === 'cost_jump' ? '📈' : '📉'} ${p.name_en.slice(0, 48)}`, `ad:pk:${p.id}`, 'danger')]);
  }

  const empty = !kb.length;
  kb.push(navRow(ctx));
  await show(ctx, `${title}\n\n${empty ? L(ctx, 'Nothing here right now. ✅', 'لا يوجد شيء الآن. ✅') : L(ctx, 'Oldest first — tap one to open it.', 'الأقدم أولاً — اضغط لفتحه.')}`, kb);
}

// ─────────────────────────────────────────────────────────────────────────────
// Details
// ─────────────────────────────────────────────────────────────────────────────

export async function showAdminOrder(ctx: BotContext, id: number, back = 'ad'): Promise<void> {
  const admin = await requireAdmin(ctx);
  if (!admin) return;
  const { env } = ctx.st;
  const o = must(await db(env).from('orders').select('*').eq('id', id).maybeSingle(), 'admin order') as OrderRow | null;
  if (!o) return void (await answer(ctx, L(ctx, 'Order not found', 'الطلب غير موجود'), true));
  const owner = admin.role === 'owner';
  const [u, prov] = await Promise.all([
    getUser(env, o.user_id),
    o.provider_id ? db(env).from('providers').select('name').eq('id', o.provider_id).maybeSingle().then((r) => (r.data as { name: string } | null)?.name ?? null) : Promise.resolve(null),
  ]);
  const left = Number(o.total) - Number(o.refunded_amount);
  const lines = [
    `🧾 <b>${L(ctx, 'Order', 'الطلب')} <code>${o.code}</code></b> · ${statusLabel(ctx, o.status)}`,
    `${escapeHtml(o.product_name)} × ${o.quantity}`,
    `${L(ctx, 'Customer', 'الزبون')}: ${userLabel(u, o.user_id)}`,
    `${L(ctx, 'Total', 'المجموع')}: <b>${fmtUsd(o.total)}</b>${Number(o.refunded_amount) > 0 ? ` · ${L(ctx, 'refunded', 'مسترد')} ${fmtUsd(o.refunded_amount)}` : ''}${o.promo_code ? ` · ${L(ctx, 'code', 'كود')} ${escapeHtml(o.promo_code)}` : ''}`,
  ];
  if (owner && o.cost_total != null) lines.push(`🔒 ${L(ctx, 'Cost', 'التكلفة')}: ${fmtUsd(o.cost_total)} · ${L(ctx, 'profit', 'الربح')}: <b>${fmtUsd(left - Number(o.cost_total))}</b>`);
  lines.push(`${L(ctx, 'Paid', 'الدفع')}: ${fmtDateTime(o.paid_at, ctx.st.user.lang)}${o.delivered_at ? ` · ${L(ctx, 'delivered', 'التسليم')}: ${fmtDateTime(o.delivered_at, ctx.st.user.lang)}` : ''}`);
  if (prov) lines.push(`${L(ctx, 'Provider', 'المزوّد')}: ${escapeHtml(prov.trim())}${o.provider_status ? ` (${escapeHtml(o.provider_status)})` : ''}${o.provider_order_ref ? ` · <code>${escapeHtml(o.provider_order_ref)}</code>` : ''}`);
  const inputs = Object.entries(o.inputs ?? {});
  if (inputs.length) lines.push(...inputs.map(([k, v]) => `${escapeHtml(k)}: <code>${escapeHtml(Array.isArray(v) ? v.join(', ') : String(v))}</code>`));
  if (o.error) lines.push(`⚠️ <i>${escapeHtml(o.error.slice(0, 300))}</i>`);
  if (o.delivery?.length) {
    lines.push(owner
      ? `📦 ${L(ctx, 'Delivered', 'المُسلَّم')}:\n<blockquote expandable>${o.delivery.map((x) => escapeHtml(x)).join('\n').slice(0, 1500)}</blockquote>`
      : `📦 ${L(ctx, 'Delivered items', 'العناصر المُسلَّمة')}: ${o.delivery.length} (${L(ctx, 'hidden for support', 'مخفية عن الدعم')})`);
  }

  const kb: InlineKeyboard = [];
  if (['manual_pending', 'failed', 'processing', 'awaiting_provider', 'partially_delivered'].includes(o.status)) kb.push([b(`📦 ${L(ctx, 'Deliver by hand', 'تسليم يدوي')}`, `adm:deliver:${o.id}`, 'success')]);
  if (['failed', 'awaiting_provider', 'manual_pending'].includes(o.status)) kb.push([b(`🔁 ${L(ctx, 'Retry with provider', 'إعادة المحاولة عند المزوّد')}`, `ad:rt:${o.id}`, 'primary')]);
  if (owner && left > 0 && !['pending_payment', 'cancelled', 'refunded'].includes(o.status)) kb.push([b(`↩️ ${L(ctx, 'Refund to wallet', 'استرداد إلى المحفظة')} (${fmtUsd(left)})`, `adm:refund:${o.id}`, 'danger')]);
  kb.push([b(`👤 ${L(ctx, 'Customer', 'الزبون')}`, `ad:u:${o.user_id}`, 'primary')]);
  kb.push(navRow(ctx, back === 'ad' ? undefined : back));
  await show(ctx, lines.join('\n'), kb);
}

async function showAdminDeposit(ctx: BotContext, id: string): Promise<void> {
  const admin = await requireAdmin(ctx);
  if (!admin) return;
  const { env } = ctx.st;
  const d = must(await db(env).from('deposits').select('*').eq('id', id).maybeSingle(), 'admin deposit') as DepositRow | null;
  if (!d) return void (await answer(ctx, L(ctx, 'Payment not found', 'الدفعة غير موجودة'), true));
  const u = await getUser(env, d.user_id);
  const lines = [
    `💳 <b>${L(ctx, 'Payment', 'دفعة')} <code>${escapeHtml(d.reference ?? '')}</code></b> · ${escapeHtml(d.status)}`,
    `${L(ctx, 'Method', 'الطريقة')}: ${escapeHtml(d.method)}`,
    `${L(ctx, 'Wallet credit', 'الرصيد المطلوب')}: <b>${fmtUsd(d.amount_usd)}</b>${Number(d.fee_usd) > 0 ? ` · ${L(ctx, 'fee', 'رسوم')} ${fmtUsd(d.fee_usd)}` : ''}${d.pay_amount != null ? ` · ${L(ctx, 'to send', 'المطلوب إرساله')} ${d.pay_amount} ${escapeHtml(d.pay_currency ?? '')}` : ''}`,
    `${L(ctx, 'Customer', 'الزبون')}: ${userLabel(u, d.user_id)}`,
    `${L(ctx, 'Created', 'أُنشئت')}: ${fmtDateTime(d.created_at, ctx.st.user.lang)}`,
  ];
  if (d.proof_text) lines.push(`${L(ctx, 'Transaction ID / note', 'رقم العملية / ملاحظة')}: <code>${escapeHtml(d.proof_text)}</code>`);
  if (d.status === 'confirming') lines.push('', `⚠️ ${L(ctx, 'Check that the money really arrived before approving.', 'تأكد من وصول المبلغ فعلاً قبل الموافقة.')}`);

  const kb: InlineKeyboard = [];
  if (d.proof_file_id) kb.push([b(`🖼 ${L(ctx, 'Show proof', 'عرض الإثبات')}`, `ad:pf:${d.id}`, 'primary')]);
  if (['pending', 'confirming', 'expired'].includes(d.status)) {
    kb.push([b(`✅ ${L(ctx, 'Approve', 'موافقة')}`, `adm:dep_ok:${d.id}`, 'success'), b(`❌ ${L(ctx, 'Reject', 'رفض')}`, `adm:dep_no:${d.id}`, 'danger')]);
  }
  kb.push([b(`👤 ${L(ctx, 'Customer', 'الزبون')}`, `ad:u:${d.user_id}`, 'primary')]);
  kb.push(navRow(ctx, 'ad:in:dep'));
  await show(ctx, lines.join('\n'), kb);
}

async function showAdminTicket(ctx: BotContext, id: number): Promise<void> {
  const admin = await requireAdmin(ctx);
  if (!admin) return;
  const { env } = ctx.st;
  const t = must(await db(env).from('tickets').select('*').eq('id', id).maybeSingle(), 'admin ticket') as TicketRow | null;
  if (!t) return void (await answer(ctx, L(ctx, 'Ticket not found', 'التذكرة غير موجودة'), true));
  const [u, o] = await Promise.all([
    getUser(env, t.user_id),
    t.order_id ? db(env).from('orders').select('id,code,product_name,warranty_until').eq('id', t.order_id).maybeSingle().then((r) => r.data as Pick<OrderRow, 'id' | 'code' | 'product_name' | 'warranty_until'> | null) : Promise.resolve(null),
  ]);
  const kindLabel = { replacement: L(ctx, 'Replacement (warranty)', 'استبدال (ضمان)'), refund: L(ctx, 'Refund request', 'طلب استرداد'), support: L(ctx, 'Support', 'دعم') }[t.kind];
  const lines = [
    `🎫 <b>${L(ctx, 'Ticket', 'تذكرة')} #${t.id}</b> · ${kindLabel} · ${escapeHtml(t.status)}`,
    `${L(ctx, 'Customer', 'الزبون')}: ${userLabel(u, t.user_id)}`,
  ];
  if (o) lines.push(`${L(ctx, 'Order', 'الطلب')}: <code>${o.code}</code> · ${escapeHtml(o.product_name)}${o.warranty_until ? ` · ${L(ctx, 'warranty until', 'الضمان حتى')} ${fmtDateTime(o.warranty_until, ctx.st.user.lang)}` : ''}`);
  if (t.message) lines.push('', `<blockquote expandable>${escapeHtml(t.message.slice(0, 1500))}</blockquote>`);

  const kb: InlineKeyboard = [];
  if (t.attachment_id) kb.push([b(`🖼 ${L(ctx, 'Show attachment', 'عرض المرفق')}`, `ad:ta:${t.id}`, 'primary')]);
  if (t.status === 'open') {
    if (t.order_id && t.kind !== 'support') kb.push([b(`🔄 ${L(ctx, 'Replace', 'استبدال')}`, `adm:tk_rep:${t.id}`, 'success')]);
    kb.push([b(`💬 ${L(ctx, 'Answer', 'رد')}`, `adm:tk_ans:${t.id}`, 'primary')]);
    if (admin.role === 'owner' && t.order_id) kb.push([b(`↩️ ${L(ctx, 'Refund', 'استرداد')}`, `adm:tk_ref:${t.id}`, 'danger')]);
    kb.push([b(`✖️ ${L(ctx, 'Reject', 'رفض')}`, `adm:tk_no:${t.id}`, 'danger')]);
  }
  if (o) kb.push([b(`🧾 ${L(ctx, 'Order', 'الطلب')}`, `ad:o:${o.id}`, 'primary'), b(`👤 ${L(ctx, 'Customer', 'الزبون')}`, `ad:u:${t.user_id}`, 'primary')]);
  else kb.push([b(`👤 ${L(ctx, 'Customer', 'الزبون')}`, `ad:u:${t.user_id}`, 'primary')]);
  kb.push(navRow(ctx, 'ad:in:tk'));
  await show(ctx, lines.join('\n'), kb);
}

export async function showAdminUser(ctx: BotContext, id: number): Promise<void> {
  const admin = await requireAdmin(ctx);
  if (!admin) return;
  const { env } = ctx.st;
  const u = await getUser(env, id);
  if (!u) return void (await answer(ctx, L(ctx, 'Customer not found', 'الزبون غير موجود'), true));
  const orders = must(
    await db(env).from('orders').select('id,code,product_name,status,total').eq('user_id', id).order('created_at', { ascending: false }).limit(5),
    'admin user orders',
  ) as Pick<OrderRow, 'id' | 'code' | 'product_name' | 'status' | 'total'>[];
  const lines = [
    `👤 <b>${L(ctx, 'Customer', 'الزبون')}</b> ${userLabel(u)}`,
    `${L(ctx, 'Balance', 'الرصيد')}: <b>${fmtUsd(u.balance)}</b> · ${L(ctx, 'spent', 'أنفق')}: ${fmtUsd(u.total_spent)} · ${L(ctx, 'orders', 'طلبات')}: ${u.orders_count}`,
    `${L(ctx, 'Topped up', 'شحن')}: ${fmtUsd(u.total_deposited)} · ${L(ctx, 'points', 'نقاط')}: ${u.points}${Number(u.discount_percent) > 0 ? ` · ${L(ctx, 'discount', 'خصم')} ${u.discount_percent}%` : ''}`,
    `${L(ctx, 'Joined', 'انضم')}: ${fmtDateTime(u.joined_at, ctx.st.user.lang)} · ${L(ctx, 'language', 'اللغة')}: ${u.lang}`,
  ];
  if (u.is_banned) lines.push(`⛔ ${L(ctx, 'Banned', 'محظور')}${u.ban_reason ? `: ${escapeHtml(u.ban_reason)}` : ''}`);
  if (u.blocked_bot) lines.push(`🔕 ${L(ctx, 'Blocked the bot (messages will not arrive)', 'حظر البوت (الرسائل لن تصل)')}`);
  if (u.note) lines.push(`📝 <i>${escapeHtml(u.note.slice(0, 300))}</i>`);
  if (orders.length) lines.push('', `${L(ctx, 'Latest orders', 'آخر الطلبات')} 👇`);

  const kb: InlineKeyboard = orders.map((o) => [b(`${o.code} · ${o.product_name.slice(0, 28)} · ${fmtUsd(o.total)} · ${statusLabel(ctx, o.status).split(' ')[0]}`, `ad:o:${o.id}`, 'primary')]);
  const actions = [b(`✉️ ${L(ctx, 'Message', 'مراسلة')}`, `ad:msg:${u.id}`, 'primary')];
  if (admin.role === 'owner') actions.unshift(b(`💰 ${L(ctx, 'Adjust balance', 'تعديل الرصيد')}`, `ad:bal:${u.id}`, 'success'));
  kb.push(actions);
  kb.push(navRow(ctx));
  await show(ctx, lines.join('\n'), kb);
}

async function showPausedPack(ctx: BotContext, id: string): Promise<void> {
  const admin = await requireAdmin(ctx);
  if (!admin || admin.role !== 'owner') return void (await answer(ctx, 'Owner only.', true));
  const p = must(await db(ctx.st.env).from('products').select('id,name_en,paused_reason,cost_basis,pending_cost,manual_price,pricing_mode').eq('id', id).maybeSingle(), 'paused pack') as
    { id: string; name_en: string; paused_reason: string | null; cost_basis: number | null; pending_cost: number | null; manual_price: number | null; pricing_mode: string } | null;
  if (!p) return void (await answer(ctx, L(ctx, 'Pack not found', 'الباقة غير موجودة'), true));
  const lines = [`⏸ <b>${escapeHtml(p.name_en)}</b>`];
  const kb: InlineKeyboard = [];
  if (p.paused_reason === 'cost_jump') {
    lines.push(`${L(ctx, 'The provider raised the cost', 'رفع المزوّد التكلفة')}: ${fmtUsd(p.cost_basis ?? 0)} → <b>${fmtUsd(p.pending_cost ?? 0)}</b>`, L(ctx, 'Accept it to sell again at the new price (your margin stays the same).', 'اقبلها لتعود الباقة للبيع بالسعر الجديد (نسبة ربحك تبقى كما هي).'));
    kb.push([b(`✅ ${L(ctx, 'Accept new cost', 'قبول التكلفة الجديدة')}`, `ad:acc:${p.id}`, 'success')]);
  } else if (p.paused_reason === 'below_margin') {
    lines.push(L(ctx, 'Its manual price is below the minimum margin. Change the price in the admin panel (Packs); it resumes by itself.', 'سعرها اليدوي أقل من الحد الأدنى للربح. غيّر السعر من لوحة التحكم (الباقات) وستعود للبيع تلقائياً.'));
  } else {
    lines.push(L(ctx, 'This pack is selling normally.', 'هذه الباقة تُباع بشكل طبيعي.'));
  }
  kb.push([b(`🛍 ${L(ctx, 'Open in shop', 'فتح في المتجر')}`, `p:${p.id}`, 'primary')]);
  kb.push(navRow(ctx, 'ad:in:pause'));
  await show(ctx, lines.join('\n'), kb);
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick actions (owner)
// ─────────────────────────────────────────────────────────────────────────────

async function showQuickActions(ctx: BotContext): Promise<void> {
  const admin = await requireAdmin(ctx);
  if (!admin || admin.role !== 'owner') return void (await answer(ctx, 'Owner only.', true));
  const { env, s } = ctx.st;
  const providers = must(await db(env).from('providers').select('id,name,enabled,balance').order('sort').order('name'), 'qa providers') as { id: string; name: string; enabled: boolean; balance: number | null }[];
  const lines = [
    `⚙️ <b>${L(ctx, 'Quick actions', 'إجراءات سريعة')}</b>`,
    '',
    `🚧 ${L(ctx, 'Maintenance', 'الصيانة')}: <b>${s.bot.maintenance_mode ? L(ctx, 'ON', 'مفعّلة') : L(ctx, 'off', 'متوقفة')}</b>`,
    `🔌 ${L(ctx, 'Providers — tap to stop or start ordering from one', 'المزوّدون — اضغط لإيقاف أو تشغيل الطلب من أحدهم')}:`,
  ];
  const kb: InlineKeyboard = [[b(s.bot.maintenance_mode ? `✅ ${L(ctx, 'Turn maintenance off', 'إيقاف وضع الصيانة')}` : `🚧 ${L(ctx, 'Turn maintenance on', 'تفعيل وضع الصيانة')}`, 'ad:mt', s.bot.maintenance_mode ? 'success' : 'danger')]];
  for (const p of providers) {
    kb.push([b(`${p.enabled ? '🟢' : '🔴'} ${p.name.trim()} · ${p.balance != null ? fmtUsd(Number(p.balance)) : '—'}`, `ad:pv:${p.id}`, p.enabled ? 'success' : 'danger')]);
  }
  kb.push(navRow(ctx));
  await show(ctx, lines.join('\n'), kb);
}

// ─────────────────────────────────────────────────────────────────────────────
// Callbacks "ad:..." and admin text input
// ─────────────────────────────────────────────────────────────────────────────

export async function onAdminNav(ctx: BotContext, data: string): Promise<void> {
  const admin = await requireAdmin(ctx);
  if (!admin) return;
  const [, a, id] = data.split(':');
  const { env, s, app } = ctx.st;
  const owner = admin.role === 'owner';

  switch (a) {
    case undefined: case 'r': return showAdminHome(ctx);
    case 'in': return showList(ctx, id);
    case 'o': return showAdminOrder(ctx, Number(id));
    case 'd': return showAdminDeposit(ctx, id);
    case 't': return showAdminTicket(ctx, Number(id));
    case 'u': return showAdminUser(ctx, Number(id));
    case 'pk': return showPausedPack(ctx, id);
    case 'qa': return showQuickActions(ctx);

    case 'pf': case 'ta': {
      const fileId = a === 'pf'
        ? (must(await db(env).from('deposits').select('proof_file_id').eq('id', id).maybeSingle(), 'proof') as { proof_file_id: string | null } | null)?.proof_file_id
        : (must(await db(env).from('tickets').select('attachment_id').eq('id', Number(id)).maybeSingle(), 'attachment') as { attachment_id: string | null } | null)?.attachment_id;
      if (!fileId) return void (await answer(ctx, L(ctx, 'No file', 'لا يوجد ملف'), true));
      await answer(ctx);
      try {
        await ctx.replyWithPhoto(fileId);
      } catch {
        await ctx.replyWithDocument(fileId);
      }
      return;
    }

    case 'rt': {
      const rows = must(await db(env).from('orders').update({ status: 'paid', error: null })
        .eq('id', Number(id)).in('status', ['failed', 'manual_pending', 'processing', 'awaiting_provider']).select('id'), 'retry') as { id: number }[];
      if (!rows.length) return void (await answer(ctx, L(ctx, 'This order cannot be retried now', 'لا يمكن إعادة هذا الطلب الآن'), true));
      await enqueue(app, { type: 'fulfill_order', orderId: Number(id) });
      await audit(env, { admin_id: admin.user_id, admin_email: admin.email, action: 'order.retry', entity: 'order', entity_id: id, data: { via: 'bot' } });
      await answer(ctx, L(ctx, 'Sent to the provider again', 'أُرسل للمزوّد مرة أخرى'));
      return showAdminOrder(ctx, Number(id));
    }

    case 'acc': {
      if (!owner) return void (await answer(ctx, 'Owner only.', true));
      const p = await acceptPendingCost(env, id);
      await audit(env, { admin_id: admin.user_id, admin_email: admin.email, action: 'product.accept_cost', entity: 'product', entity_id: id, data: { via: 'bot', cost: p.cost_basis } });
      await answer(ctx, L(ctx, 'Accepted — selling again', 'تم القبول — عادت للبيع'));
      return showList(ctx, 'pause');
    }

    case 'mt': {
      if (!owner) return void (await answer(ctx, 'Owner only.', true));
      const on = !s.bot.maintenance_mode;
      await saveSettingsSection(env, 'bot', { ...s.bot, maintenance_mode: on });
      s.bot.maintenance_mode = on;
      await audit(env, { admin_id: admin.user_id, admin_email: admin.email, action: 'settings.update', entity: 'settings', entity_id: 'bot', data: { via: 'bot', maintenance_mode: on } });
      await answer(ctx, on ? L(ctx, 'Maintenance ON', 'تم تفعيل الصيانة') : L(ctx, 'Maintenance off', 'تم إيقاف الصيانة'));
      return showQuickActions(ctx);
    }

    case 'pv': {
      if (!owner) return void (await answer(ctx, 'Owner only.', true));
      const p = must(await db(env).from('providers').select('id,name,enabled').eq('id', id).maybeSingle(), 'provider') as { id: string; name: string; enabled: boolean } | null;
      if (!p) return void (await answer(ctx, 'Not found', true));
      must(await db(env).from('providers').update({ enabled: !p.enabled }).eq('id', id), 'provider toggle');
      await audit(env, { admin_id: admin.user_id, admin_email: admin.email, action: 'provider.update', entity: 'provider', entity_id: id, data: { via: 'bot', enabled: !p.enabled } });
      await answer(ctx, `${p.name.trim()}: ${!p.enabled ? L(ctx, 'on', 'يعمل') : L(ctx, 'stopped', 'متوقف')}`);
      return showQuickActions(ctx);
    }

    case 'find':
      await setState(ctx, { kind: 'await_admin_lookup' });
      await answer(ctx);
      return void (await ctx.reply(L(ctx,
        '🔎 Send an <b>order code</b>, a <b>payment reference</b> (D…), a customer <b>Telegram ID</b>, or a <b>@username</b> / name. /cancel to stop.',
        '🔎 أرسل <b>رقم طلب</b>، أو <b>مرجع دفعة</b> (D…)، أو <b>رقم تيليجرام</b> للزبون، أو <b>@يوزر</b> أو اسم. /cancel للإلغاء.'), { parse_mode: 'HTML' }));

    case 'bal':
      if (!owner) return void (await answer(ctx, 'Owner only.', true));
      await setState(ctx, { kind: 'await_admin_balance', data: { userId: Number(id) } });
      await answer(ctx);
      return void (await ctx.reply(L(ctx,
        '💰 Send the amount to add, e.g. <code>5</code>, or to take away, e.g. <code>-2.5</code>. You can add a note after it: <code>5 compensation</code>. /cancel to stop.',
        '💰 أرسل المبلغ للإضافة مثل <code>5</code>، أو للخصم مثل <code>-2.5</code>. يمكنك كتابة ملاحظة بعده: <code>5 تعويض</code>. /cancel للإلغاء.'), { parse_mode: 'HTML' }));

    case 'msg':
      await setState(ctx, { kind: 'await_admin_message', data: { userId: Number(id) } });
      await answer(ctx);
      return void (await ctx.reply(L(ctx, '✉️ Send the message for the customer (text). /cancel to stop.', '✉️ أرسل رسالتك للزبون (نص). /cancel للإلغاء.')));

    default:
      return answer(ctx);
  }
}

/** Text while an admin lookup / balance / message prompt is open. Returns true when handled. */
export async function onAdminInput(ctx: BotContext, kind: string, data: Record<string, unknown>): Promise<boolean> {
  const admin = await getAdmin(ctx);
  if (!admin) return false;
  const { env } = ctx.st;
  const text = (ctx.message?.text ?? '').trim();
  if (!text) return true;

  if (kind === 'await_admin_lookup') {
    await setState(ctx, null);
    const q = text.replace(/^#/, '');
    // order code, then payment reference, then customer id / username / name
    const code = /^[A-Za-z0-9-]{4,40}$/.test(q) ? q.toUpperCase() : null; // codes are stored upper-case
    const order = code ? must(await db(env).from('orders').select('id').eq('code', code).maybeSingle(), 'find order') as { id: number } | null : null;
    if (order) { await showAdminOrder(ctx, order.id); return true; }
    if (code && /^D[A-Z0-9]{6,}$/.test(code)) {
      const dep = must(await db(env).from('deposits').select('id').eq('reference', code).maybeSingle(), 'find deposit') as { id: string } | null;
      if (dep) { await showAdminDeposit(ctx, dep.id); return true; }
    }
    if (/^\d{4,}$/.test(q)) {
      const u = await getUser(env, Number(q));
      if (u) { await showAdminUser(ctx, u.id); return true; }
      const byId = must(await db(env).from('orders').select('id').eq('id', Number(q)).maybeSingle(), 'find order id') as { id: number } | null;
      if (byId) { await showAdminOrder(ctx, byId.id); return true; }
    }
    const term = q.replace(/^@/, '').replace(/[%_,()]/g, '');
    const users = term.length >= 2
      ? must(await db(env).from('users').select('id,first_name,last_name,username').or(`username.ilike.%${term}%,first_name.ilike.%${term}%`).limit(8), 'find users') as Pick<UserRow, 'id' | 'first_name' | 'last_name' | 'username'>[]
      : [];
    if (users.length === 1) { await showAdminUser(ctx, users[0].id); return true; }
    const kb: InlineKeyboard = users.map((u) => [b(`👤 ${[u.first_name, u.last_name].filter(Boolean).join(' ') || u.id}${u.username ? ` @${u.username}` : ''}`, `ad:u:${u.id}`, 'primary')]);
    kb.push([b(`🔎 ${L(ctx, 'Search again', 'بحث مرة أخرى')}`, 'ad:find', 'primary')], navRow(ctx));
    await ctx.reply(users.length ? L(ctx, 'Several customers match:', 'عدة زبائن مطابقين:') : L(ctx, `Nothing found for “${escapeHtml(q)}”.`, `لا نتائج لـ «${escapeHtml(q)}».`), { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } as never });
    return true;
  }

  if (kind === 'await_admin_balance') {
    if (admin.role !== 'owner') { await setState(ctx, null); return true; }
    const m = text.match(/^([+-]?\d+(?:[.,]\d{1,2})?)\s*(.*)$/s);
    const amount = m ? Number(m[1].replace(',', '.')) : NaN;
    if (!m || !isFinite(amount) || amount === 0 || Math.abs(amount) > 10_000) {
      await ctx.reply(L(ctx, 'Send a number like 5 or -2.5 (max 10000), or /cancel.', 'أرسل رقماً مثل 5 أو ‎-2.5 (حتى 10000)، أو /cancel.'));
      return true;
    }
    const userId = Number(data.userId);
    const note = m[2]?.trim() || null;
    try {
      const balance = await rpc<number>(env, 'wallet_apply', {
        p_user_id: userId, p_amount: amount, p_type: 'admin_adjust', p_ref_type: 'admin', p_ref_id: admin.email, p_note: note, p_created_by: admin.user_id,
      });
      await setState(ctx, null);
      await audit(env, { admin_id: admin.user_id, admin_email: admin.email, action: 'user.balance', entity: 'user', entity_id: userId, data: { via: 'bot', amount, note } });
      const u = await getUser(env, userId);
      if (u) {
        const sign = amount > 0 ? '+' : '−';
        const head = u.lang === 'ar' ? '💰 <b>تحديث المحفظة</b>' : '💰 <b>Wallet update</b>';
        const bal = u.lang === 'ar' ? 'الرصيد' : 'Balance';
        await notifyUser(env, userId, `${head}\n${sign}${fmtUsd(Math.abs(amount))}${note ? `\n<i>${escapeHtml(note)}</i>` : ''}\n${bal}: <b>${fmtUsd(Number(balance))}</b>`);
      }
      await ctx.reply(`✅ ${L(ctx, 'New balance', 'الرصيد الجديد')}: <b>${fmtUsd(Number(balance))}</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[b(`👤 ${L(ctx, 'Customer', 'الزبون')}`, `ad:u:${userId}`, 'primary')], navRow(ctx)] } as never });
    } catch (e) {
      const msg = (e as Error).message;
      await ctx.reply(msg.includes('INSUFFICIENT') ? L(ctx, 'The balance would go below zero.', 'الرصيد سيصبح أقل من صفر.') : `❌ ${escapeHtml(msg.slice(0, 200))}`, { parse_mode: 'HTML' });
    }
    return true;
  }

  if (kind === 'await_admin_message') {
    const userId = Number(data.userId);
    const u = await getUser(env, userId);
    const head = u?.lang === 'en' ? '📩 <b>Message from support</b>' : '📩 <b>رسالة من الدعم</b>';
    const ok = await notifyUser(env, userId, `${head}\n\n${escapeHtml(text.slice(0, 3500))}`);
    await setState(ctx, null);
    await audit(env, { admin_id: admin.user_id, admin_email: admin.email, action: 'user.message', entity: 'user', entity_id: userId, data: { via: 'bot', delivered: ok } });
    await ctx.reply(ok ? `✅ ${L(ctx, 'Sent.', 'تم الإرسال.')}` : `⚠️ ${L(ctx, 'Not delivered — the customer blocked the bot.', 'لم تصل — الزبون حظر البوت.')}`, { reply_markup: { inline_keyboard: [[b(`👤 ${L(ctx, 'Customer', 'الزبون')}`, `ad:u:${userId}`, 'primary')], navRow(ctx)] } as never });
    return true;
  }
  return false;
}

/** "🛠 Admin" row on the customer home, for admins only. */
export async function adminHomeRow(ctx: BotContext): Promise<InlineButton[] | null> {
  return (await getAdmin(ctx)) ? [b(L(ctx, '🛠 Admin', '🛠 الإدارة'), 'ad', 'danger')] : null;
}
