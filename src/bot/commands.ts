import type { Env } from '../env';
import { tg } from '../lib/telegram';

/** Commands shown in the Telegram "Menu" button (English default + Arabic). */
export const COMMANDS: { command: string; en: string; ar: string }[] = [
  { command: 'start', en: 'Open the shop', ar: 'افتح المتجر' },
  { command: 'shop', en: 'Browse products', ar: 'تصفح المنتجات' },
  { command: 'search', en: 'Search products', ar: 'ابحث عن منتج' },
  { command: 'product', en: 'Price list — everything in stock', ar: 'قائمة الأسعار — كل المتوفر' },
  { command: 'freebies', en: 'Free resources', ar: 'موارد مجانية' },
  { command: 'deposit', en: 'Add funds to your wallet', ar: 'اشحن محفظتك' },
  { command: 'history', en: 'My orders', ar: 'طلباتي' },
  { command: 'profile', en: 'My profile & balance', ar: 'ملفي ورصيدي' },
  { command: 'referrals', en: 'Refer & earn', ar: 'ادعُ واربح' },
  { command: 'discount', en: 'My discounts', ar: 'خصوماتي' },
  { command: 'redeem', en: 'Redeem a code', ar: 'استخدم كود' },
  { command: 'events', en: 'Events & giveaways', ar: 'الفعاليات والسحوبات' },
  { command: 'api', en: 'API access — your keys', ar: 'وصول API — مفاتيحك' },
  { command: 'replace', en: 'Request a replacement', ar: 'طلب استبدال' },
  { command: 'support', en: 'Support', ar: 'الدعم' },
  { command: 'lang', en: 'Language', ar: 'اللغة' },
];

/** Register the command menu for both languages (called from the admin panel → System). */
export async function setupBotCommands(env: Env, opts: { hide?: string[] } = {}): Promise<void> {
  const list = COMMANDS.filter((c) => !opts.hide?.includes(c.command));
  await tg(env, 'setMyCommands', { commands: list.map((c) => ({ command: c.command, description: c.en })) });
  await tg(env, 'setMyCommands', { commands: list.map((c) => ({ command: c.command, description: c.ar })), language_code: 'ar' });
}
