import { currentLang } from './i18n';

// Bidi isolation so "$12.50" / "−$3.00" never flips to "12.50$" inside Arabic text.
const LRI = '⁦';
const PDI = '⁩';

export function usd(n: number | string | null | undefined, digits = 2): string {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return `${LRI}${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(digits)}${PDI}`;
}

export function num(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-US');
}

/** Arabic UI keeps Latin digits (prices, codes and dates stay easy to compare). */
function locale(): string {
  return currentLang() === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
}

export function dt(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString(locale(), { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ago(s: string | null | undefined): string {
  if (!s) return '—';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  const ar = currentLang() === 'ar';
  if (diff < 60) { const n = Math.max(0, Math.floor(diff)); return ar ? `منذ ${n} ث` : `${n}s ago`; }
  if (diff < 3600) { const n = Math.floor(diff / 60); return ar ? `منذ ${n} د` : `${n}m ago`; }
  if (diff < 86400) { const n = Math.floor(diff / 3600); return ar ? `منذ ${n} س` : `${n}h ago`; }
  const n = Math.floor(diff / 86400);
  return ar ? `منذ ${n} يوم` : `${n}d ago`;
}

/** ISO → value for <input type="datetime-local"> */
export function toLocalInput(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(v).toISOString();
}

export const ORDER_STATUS_TONE: Record<string, 'gray' | 'gold' | 'green' | 'red' | 'blue' | 'purple'> = {
  pending_payment: 'gray',
  paid: 'blue',
  processing: 'blue',
  awaiting_provider: 'purple',
  manual_pending: 'gold',
  delivered: 'green',
  partially_delivered: 'gold',
  failed: 'red',
  refunded: 'gray',
  partially_refunded: 'gray',
  cancelled: 'gray',
};

export const DEPOSIT_STATUS_TONE: Record<string, 'gray' | 'gold' | 'green' | 'red' | 'blue'> = {
  pending: 'gold',
  confirming: 'blue',
  paid: 'green',
  expired: 'gray',
  rejected: 'red',
  cancelled: 'gray',
  failed: 'red',
};

/** Status / method / role / type values shown in the panel → [English, Arabic]. */
const LABELS: Record<string, [string, string]> = {
  // orders
  pending_payment: ['Pending payment', 'بانتظار الدفع'],
  paid: ['Paid', 'مدفوع'],
  processing: ['Processing', 'قيد التنفيذ'],
  awaiting_provider: ['At provider', 'عند المزوّد'],
  manual_pending: ['Manual delivery', 'بانتظار التسليم اليدوي'],
  delivered: ['Delivered', 'تم التسليم'],
  partially_delivered: ['Partly delivered', 'تسليم جزئي'],
  failed: ['Failed', 'فشل'],
  refunded: ['Refunded', 'مسترد'],
  partially_refunded: ['Partly refunded', 'مسترد جزئياً'],
  cancelled: ['Cancelled', 'ملغى'],
  // deposits
  pending: ['Pending', 'بانتظار الدفع'],
  confirming: ['Under review', 'قيد المراجعة'],
  expired: ['Expired', 'منتهي'],
  rejected: ['Rejected', 'مرفوض'],
  // tickets
  open: ['Open', 'مفتوحة'],
  approved: ['Approved', 'مقبولة'],
  resolved: ['Resolved', 'محلولة'],
  replaced: ['Replaced', 'تم الاستبدال'],
  answered: ['Answered', 'تم الرد'],
  replacement: ['Replacement', 'استبدال'],
  refund: ['Refund', 'استرداد'],
  support: ['Support', 'دعم'],
  // fulfilment attempts
  success: ['Success', 'نجح'],
  error: ['Error', 'خطأ'],
  // broadcasts / giveaways
  draft: ['Draft', 'مسودة'],
  queued: ['Queued', 'في الانتظار'],
  sending: ['Sending', 'قيد الإرسال'],
  done: ['Done', 'تم'],
  active: ['Active', 'نشط'],
  ended: ['Ended', 'انتهى'],
  // payment methods
  binance_pay: ['Binance Pay', 'Binance Pay'],
  binance_id: ['Binance Pay ID', 'بينانس Pay ID'],
  nowpayments: ['USDT (NOWPayments)', 'USDT (NOWPayments)'],
  shamcash: ['ShamCash', 'شام كاش'],
  admin: ['Admin', 'إدارة'],
  wallet: ['Wallet', 'المحفظة'],
  // roles
  owner: ['Owner', 'مالك'],
  // ledger types
  deposit: ['Deposit', 'شحن'],
  purchase: ['Purchase', 'شراء'],
  referral: ['Referral', 'إحالة'],
  admin_adjust: ['Admin adjustment', 'تعديل إداري'],
  redeem: ['Gift code', 'كود هدية'],
  cashback: ['Cashback', 'كاش باك'],
  giveaway: ['Giveaway', 'سحب'],
  // delivery / channels
  bot: ['Bot', 'البوت'],
  api: ['API', 'API'],
  instant: ['Instant', 'فوري'],
  async: ['Later', 'لاحقاً'],
  activation: ['Activation', 'تفعيل'],
  manual: ['Manual', 'يدوي'],
  stock: ['Stock', 'مخزون'],
  provider: ['Provider', 'مزوّد'],
};

/** Human label for a status/method/role value in the current language. */
export function label(s: string): string {
  const l = LABELS[s];
  if (l) return currentLang() === 'ar' ? l[1] : l[0];
  return s.replace(/_/g, ' ');
}
