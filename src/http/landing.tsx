import { Hono } from 'hono';
import type { Context } from 'hono';
import { raw } from 'hono/html';
import type { Env } from '../env';
import type { CategoryRow, Lang } from '../types';
import { getSettings, baseUrl, type AppSettings } from '../lib/settings';
import { db, must } from '../lib/db';
import { activeGroups, listAllProducts, productCounts } from '../services/catalog';
import { fmtUsd } from '../lib/money';
import { pick } from '../lib/i18n';

// ─────────────────────────────────────────────────────────────────────────────
// Landing page. Concept: the store *is* a Telegram bot, so the page is built around
// a hand-made phone that plays the real purchase flow, an editorial type system,
// and a catalog shelf of categories ("folders"). Everything is driven by
// settings.landing + settings.brand and the live catalog; no images required.
// ─────────────────────────────────────────────────────────────────────────────

type HonoEnv = { Bindings: Env };
export const landing = new Hono<HonoEnv>();

const CACHE = 'public, max-age=60';
const MAX_SHELF = 24;
const MAX_FEATURED = 8;

/** Shelf placeholders until the first categories go live (names only, no logos). */
const SOON = ['ChatGPT', 'Gemini', 'Claude', 'Canva', 'CapCut', 'Netflix', 'Spotify', 'Duolingo', 'Grok', 'Cursor', 'ElevenLabs', 'VPN'];

/** t.me deep link; main CTAs use start=shop so returning users land in the shop too. */
function botLink(s: AppSettings, start?: string): string {
  const u = s.brand.bot_username.replace(/^@/, '').trim();
  if (!u) return '#';
  return `https://t.me/${u}${start ? `?start=${encodeURIComponent(start)}` : ''}`;
}

/** Admin supplied links: only http(s) / tg / relative paths. */
function safeUrl(u: string | null | undefined): string {
  if (!u) return '';
  const v = u.trim();
  return /^(https?:\/\/|tg:\/\/|\/)/i.test(v) ? v : '';
}

function langOf(c: Context<HonoEnv>, forced?: Lang): Lang {
  if (forced) return forced;
  return c.req.query('lang') === 'ar' ? 'ar' : 'en';
}

const loc = (row: object, field: string, lang: Lang) => pick(row as Record<string, unknown>, field, lang);

// ─────────────────────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────────────────────

interface Shelf {
  id: string;
  name: string;
  emoji: string | null;
  count: number;
  from: number | null;
}

interface Featured {
  /** g = product (group) → ?start=g_<id>, p = single pack → ?start=p_<id> */
  kind: 'g' | 'p';
  id: string;
  name: string;
  emoji: string | null;
  price: number;
  original: number | null;
  warranty: number;
}

interface Data {
  shelves: Shelf[];
  featured: Featured[];
  products: number;
}

async function loadData(env: Env, s: AppSettings, lang: Lang): Promise<Data> {
  const empty: Data = { shelves: [], featured: [], products: 0 };
  if (!s.landing.show_products) return empty;
  try {
    const cats = must(await db(env).from('categories').select('*').eq('is_active', true).order('sort').order('name_en'), 'categories') as CategoryRow[];
    const byId = new Map(cats.map((c) => [c.id, c]));
    // sub-categories roll up into their top-level folder
    const rootOf = (id: string | null): CategoryRow | null => {
      let c = id ? byId.get(id) ?? null : null;
      for (let i = 0; c?.parent_id && i < 5; i++) c = byId.get(c.parent_id) ?? c;
      return c;
    };

    const [counts, views, groups] = await Promise.all([productCounts(env), listAllProducts(env, s, null), activeGroups(env)]);
    // a pack inside a product group belongs to the group's category
    const catOf = (v: (typeof views)[number]): string | null =>
      v.product.group_id && groups.has(v.product.group_id) ? groups.get(v.product.group_id)!.category_id : v.product.category_id;
    const shelf = new Map<string, Shelf>();
    for (const c of cats) {
      if (c.parent_id) continue;
      shelf.set(c.id, { id: c.id, name: loc(c, 'name', lang), emoji: c.emoji, count: 0, from: null });
    }
    for (const [catId, n] of counts) {
      const root = rootOf(catId);
      const t = root && shelf.get(root.id);
      if (t) t.count += n;
    }
    for (const v of views) {
      const root = rootOf(catOf(v));
      const t = root && shelf.get(root.id);
      if (t && v.pricing.unitPrice != null) t.from = t.from == null ? v.pricing.unitPrice : Math.min(t.from, v.pricing.unitPrice);
    }
    // featured products (groups) first, priced "from" their cheapest in-stock pack
    const groupFrom = new Map<string, number>();
    for (const v of views) {
      const gid = v.product.group_id;
      if (!gid || !groups.has(gid) || v.pricing.unitPrice == null) continue;
      groupFrom.set(gid, Math.min(groupFrom.get(gid) ?? Number.MAX_VALUE, v.pricing.unitPrice));
    }
    const featuredGroups: Featured[] = [...groups.values()]
      .filter((g) => g.is_featured && groupFrom.has(g.id))
      .map((g) => ({ kind: 'g' as const, id: g.id, name: loc(g, 'name', lang), emoji: g.emoji, price: groupFrom.get(g.id)!, original: null, warranty: 0 }));
    const featuredPacks: Featured[] = views
      .filter((v) => v.product.is_featured && v.pricing.unitPrice != null)
      .map((v) => ({
        kind: 'p' as const,
        id: v.product.id,
        name: loc(v.product, 'name', lang),
        emoji: v.product.emoji,
        price: v.pricing.unitPrice!,
        original: v.pricing.originalUnitPrice != null && v.pricing.originalUnitPrice > v.pricing.unitPrice! + 0.004 ? v.pricing.originalUnitPrice : null,
        warranty: v.product.warranty_days,
      }));
    const featured = [...featuredGroups, ...featuredPacks].slice(0, MAX_FEATURED);
    return {
      shelves: [...shelf.values()].filter((t) => t.count > 0).slice(0, MAX_SHELF),
      featured,
      products: views.length,
    };
  } catch (e) {
    console.error('landing data failed', e);
    return empty;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy (UI chrome; the editable copy lives in settings.landing)
// ─────────────────────────────────────────────────────────────────────────────

const UI = {
  en: {
    nav_catalog: 'Catalog',
    nav_how: 'How it works',
    nav_pay: 'Payments',
    nav_faq: 'FAQ',
    switch: 'العربية',
    browse: 'Browse the catalog',
    eyebrow: 'A store that lives in Telegram',
    steps_label: 'How it works',
    step1: 'Open the shop',
    step2: 'Pick a pack',
    step3: 'Pay from your wallet',
    step4: 'Receive it in the chat',
    demo_label: 'Example order — real prices are in the bot',
    sec_catalog: 'Catalog',
    catalog_title: 'Pick a brand. Then the pack.',
    catalog_text: 'Every brand is a folder in the bot, with all of its plans inside.',
    soon_title: 'The shelf is being stocked.',
    soon_text: 'Brands appear here the moment they go live in the bot.',
    soon: 'Soon',
    packs: (n: number) => (n === 1 ? '1 product' : `${n} products`),
    from: 'from',
    restocking: 'Restocking',
    featured: 'Featured',
    buy: 'Buy in Telegram',
    warranty_d: (n: number) => `${n}-day warranty`,
    sec_receipt: 'What you get',
    receipt_title: 'Your order, straight into the chat.',
    receipt_text: 'No waiting on a seller. The bot sends what you bought into your conversation, with everything you need to keep it safe.',
    receipt_f1: 'An order ID for support',
    receipt_f2: 'Warranty dates on every order',
    receipt_f3: 'A TXT copy one tap away',
    seal: 'WARRANTY ON EVERY ORDER · REPLACEMENT OR REFUND · ',
    sec_pay: 'Payments',
    pay_title: 'Pay the way you already do.',
    pay_text: 'Top up a wallet in US dollars once, then buy as often as you like.',
    wallet: 'Wallet',
    sec_why: 'Why it works',
    why_title: 'Built so you never chase a seller.',
    sec_faq: 'Questions',
    faq_title: 'Before you ask.',
    final_title: 'Your next subscription is one message away.',
    channel: 'Channel',
    group: 'Community',
    support: 'Support',
    website: 'Website',
    rights: 'All rights reserved.',
  },
  ar: {
    nav_catalog: 'المتجر',
    nav_how: 'كيف يعمل',
    nav_pay: 'الدفع',
    nav_faq: 'أسئلة',
    switch: 'English',
    browse: 'تصفّح المتجر',
    eyebrow: 'متجر يعمل داخل تيليجرام',
    steps_label: 'كيف يعمل',
    step1: 'افتح المتجر',
    step2: 'اختر الباقة',
    step3: 'ادفع من محفظتك',
    step4: 'استلمها في المحادثة',
    demo_label: 'طلب للتوضيح — الأسعار الحقيقية داخل البوت',
    sec_catalog: 'المتجر',
    catalog_title: 'اختر الخدمة، ثم الباقة.',
    catalog_text: 'كل خدمة لها قسم داخل البوت، وفيه كل باقاتها.',
    soon_title: 'نجهّز الرفوف الآن.',
    soon_text: 'تظهر الخدمات هنا فور إطلاقها داخل البوت.',
    soon: 'قريباً',
    packs: (n: number) => (n === 1 ? 'منتج واحد' : n === 2 ? 'منتجان' : n <= 10 ? `${n} منتجات` : `${n} منتج`),
    from: 'ابتداءً من',
    restocking: 'يُعاد توفيرها',
    featured: 'مختارات',
    buy: 'اشترِ عبر تيليجرام',
    warranty_d: (n: number) => `ضمان ${n} يوم`,
    sec_receipt: 'ماذا تستلم',
    receipt_title: 'طلبك يصلك مباشرة في المحادثة.',
    receipt_text: 'بدون انتظار بائع. يرسل البوت ما اشتريته إلى محادثتك، مع كل ما تحتاجه للاحتفاظ به بأمان.',
    receipt_f1: 'رقم طلب للدعم',
    receipt_f2: 'تاريخ الضمان مع كل طلب',
    receipt_f3: 'نسخة TXT بضغطة واحدة',
    seal: 'ضمان على كل طلب · ',
    sec_pay: 'الدفع',
    pay_title: 'ادفع بالطريقة التي تستخدمها.',
    pay_text: 'اشحن محفظة بالدولار مرة واحدة، واشترِ متى شئت.',
    wallet: 'المحفظة',
    sec_why: 'لماذا نحن',
    why_title: 'صُمّم كي لا تلاحق أي بائع.',
    sec_faq: 'أسئلة',
    faq_title: 'قبل أن تسأل.',
    final_title: 'اشتراكك القادم على بُعد رسالة.',
    channel: 'القناة',
    group: 'المجتمع',
    support: 'الدعم',
    website: 'الموقع',
    rights: 'جميع الحقوق محفوظة.',
  },
} as const;
type UiCopy = (typeof UI)[Lang];

/** Strings inside the phone demo. */
function demoCopy(lang: Lang, brand: string) {
  if (lang === 'ar') {
    return {
      status: 'بوت', typing: 'يكتب…', start: '/start',
      welcome: [`👑 أهلاً بك في ${brand}!`, 'اختر من القائمة بالأسفل 👇'],
      shop: '🛍️ المتجر', deposit: '💰 شحن', profile: '👤 ملفي', support: '✉️ الدعم',
      shopText: ['🛍️ المتجر — اختر القسم'],
      cats: ['🤖 ChatGPT', '🍿 Netflix', '🎬 CapCut', '🎨 Canva'], back: '◀️ رجوع', home: '🏠 الرئيسية',
      packsText: ['🤖 ChatGPT — ٣ باقات'],
      packs: ['ChatGPT Plus · شهر | $12.83', 'ChatGPT Pro · شهر | $64.60', '❌ ChatGPT Team · نفدت'],
      checkout: ['🧾 إتمام الشراء', 'ChatGPT Plus · شهر × 1', '🛡️ ضمان 25 يوم', 'الإجمالي: $12.83', '💲 رصيدك: $20.00'],
      pay: 'ادفع $12.83 من المحفظة', promo: '🏷️ كود خصم', cancel: '❌ إلغاء',
      paid: ['✅ تم الدفع من المحفظة', 'خُصم $12.83 · المتبقي $7.17'],
      delivered: '✅ تم تسليم طلبك!', item: '📦 ChatGPT Plus · شهر × 1', yours: '🔑 حسابك:',
      key: 'user••••@mail.com | ••••••••', warranty: '🛡️ الضمان: 25 يوم', order: '🔗 رقم الطلب:', txt: '📥 تحميل كملف TXT',
    };
  }
  return {
    status: 'bot', typing: 'typing…', start: '/start',
    welcome: [`👑 Welcome to ${brand}!`, 'Pick a section below 👇'],
    shop: '🛍️ Shop', deposit: '💰 Deposit', profile: '👤 Profile', support: '✉️ Support',
    shopText: ['🛍️ Shop — choose a category'],
    cats: ['🤖 ChatGPT', '🍿 Netflix', '🎬 CapCut', '🎨 Canva'], back: '◀️ Back', home: '🏠 Home',
    packsText: ['🤖 ChatGPT — 3 packs'],
    packs: ['ChatGPT Plus · 1 month | $12.83', 'ChatGPT Pro · 1 month | $64.60', '❌ ChatGPT Team · sold out'],
    checkout: ['🧾 Checkout', 'ChatGPT Plus · 1 month × 1', '🛡️ 25 days warranty', 'Total: $12.83', '💲 Balance: $20.00'],
    pay: 'Pay $12.83 from wallet', promo: '🏷️ Promo code', cancel: '❌ Cancel',
    paid: ['✅ Paid with wallet', 'Debited $12.83 · Remaining $7.17'],
    delivered: '✅ Order delivered!', item: '📦 ChatGPT Plus · 1 month × 1', yours: '🔑 Your account:',
    key: 'user••••@mail.com | ••••••••', warranty: '🛡️ Warranty: 25 days', order: '🔗 Order ID:', txt: '📥 Download as TXT',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons (static constants only)
// ─────────────────────────────────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  dots: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
};

function Icon(props: { name: string; size?: number; cls?: string }) {
  const size = props.size ?? 20;
  return raw(
    `<svg class="ico ${props.cls ?? ''} ico-${props.name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[props.name] ?? ''}</svg>`,
  );
}

function TgIcon(props: { size?: number }) {
  const size = props.size ?? 20;
  return (
    <svg class="ico" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;

function css(accentRaw: string, lang: Lang): string {
  // only a plain hex color may reach the stylesheet
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(accentRaw) ? accentRaw : '#F5B301';
  const display = lang === 'ar' ? `"Readex Pro","Bricolage Grotesque",system-ui,sans-serif` : `"Bricolage Grotesque",Inter,system-ui,sans-serif`;
  const body = lang === 'ar' ? `"Readex Pro",Inter,system-ui,sans-serif` : `Inter,system-ui,-apple-system,"Segoe UI",sans-serif`;
  return `
:root{--gold:${accent};--ink:#0e0d0b;--ink2:#151310;--ink3:#1c1a16;--cream:#f3ecdf;--muted:#a69d8e;--faint:#6f685d;
--line:rgba(243,236,223,.09);--line2:rgba(243,236,223,.16);--goldline:color-mix(in srgb,var(--gold) 38%,transparent);
--display:${display};--body:${body};--r:18px;--wrap:1200px}
*,*:before,*:after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:80px;overflow-x:clip}
body{background:var(--ink);color:var(--cream);font:400 16px/1.6 var(--body);-webkit-font-smoothing:antialiased;overflow-x:clip;text-rendering:optimizeLegibility}
body:before{content:"";position:fixed;inset:0;background-image:${GRAIN};opacity:.045;pointer-events:none;z-index:100;mix-blend-mode:overlay}
a{color:inherit;text-decoration:none}
img{display:block;max-width:100%}
.ico{display:block;flex:none}
[dir=rtl] .ico-arrow{transform:scaleX(-1)}
:focus-visible{outline:2px solid var(--gold);outline-offset:3px;border-radius:8px}
.wrap{max-width:var(--wrap);margin:0 auto;padding-inline:16px}
@media(min-width:768px){.wrap{padding-inline:32px}}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;inset-inline-start:16px;top:-60px;z-index:60;background:var(--gold);color:#1a1200;padding:10px 14px;border-radius:10px;font-weight:600}
.skip:focus{top:12px}

/* type */
.label{display:flex;align-items:center;gap:12px;font:600 12px/1 var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
[dir=rtl] .label{letter-spacing:0;font-size:13px}
.label b{color:var(--gold);font-weight:600;font-variant-numeric:tabular-nums}
.label:after{content:"";flex:1;height:1px;background:var(--line);max-width:120px}
h1,h2,h3{font-family:var(--display);font-weight:700;letter-spacing:-.025em;text-wrap:balance}
[dir=rtl] h1,[dir=rtl] h2,[dir=rtl] h3{letter-spacing:0}
h2{font-size:clamp(30px,4.6vw,56px);line-height:1.04;margin-top:18px}
[dir=rtl] h2{line-height:1.3}
.lede{color:var(--muted);font-size:clamp(16px,1.6vw,18px);max-width:52ch;margin-top:16px}
.gold{color:var(--gold)}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:0 24px;border-radius:999px;font:600 16px/1 var(--body);
 background:var(--gold);color:#1a1200;transition:transform .2s ease,background .2s ease;white-space:nowrap}
.btn:hover{transform:translateY(-1px);background:color-mix(in srgb,var(--gold) 88%,#fff)}
.btn.sm{min-height:44px;padding:0 18px;font-size:14px}
.link{display:inline-flex;align-items:center;gap:8px;min-height:52px;padding:0 6px;font-weight:600;color:var(--cream);border-bottom:1px solid transparent}
.link:hover{color:var(--gold)}

/* header */
.top{position:sticky;top:0;z-index:40;transition:background .25s,border-color .25s;border-bottom:1px solid transparent}
.top.solid{background:color-mix(in srgb,var(--ink) 86%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-color:var(--line)}
.top .wrap{display:flex;align-items:center;gap:20px;height:68px}
.brand{display:flex;align-items:center;gap:10px;font:700 17px/1 var(--display);min-width:0;margin-inline-end:auto}
.brand img{width:34px;height:34px;border-radius:10px;object-fit:cover}
.brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav{display:none;gap:4px}
.nav a{padding:10px 12px;border-radius:10px;font-size:14px;font-weight:500;color:var(--muted)}
.nav a:hover{color:var(--cream)}
.lang{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;font-size:14px;font-weight:600;color:var(--muted);border:1px solid var(--line2);border-radius:999px}
.lang:hover{color:var(--cream);border-color:var(--cream)}
.top .btn{display:none}
@media(min-width:900px){.nav{display:flex}.top .btn{display:inline-flex}}

/* hero */
.hero{padding:40px 0 72px}
.hero .wrap{display:grid;gap:56px;align-items:center}
@media(min-width:1000px){.hero{padding:56px 0 112px}.hero .wrap{grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:72px}}
.eyebrow{display:inline-flex;align-items:center;gap:10px;font-size:14px;font-weight:500;color:var(--muted)}
.eyebrow i{width:8px;height:8px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 4px color-mix(in srgb,var(--gold) 18%,transparent)}
.hero h1{font-size:clamp(42px,7.4vw,92px);line-height:.98;margin-top:22px}
[dir=rtl] .hero h1{font-size:clamp(38px,6.4vw,76px);line-height:1.22}
.hero .lede{margin-top:24px;font-size:clamp(17px,1.8vw,20px)}
.cta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;margin-top:34px}
.steps{list-style:none;margin-top:48px;border-top:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;max-width:560px}
.steps li{border-bottom:1px solid var(--line)}
.steps li:nth-child(odd){border-inline-end:1px solid var(--line)}
.steps button{all:unset;box-sizing:border-box;display:flex;gap:12px;align-items:baseline;width:100%;min-height:56px;padding:16px 14px;cursor:pointer;color:var(--muted);font-size:15px;font-weight:500;transition:color .25s}
.steps button b{font:600 13px/1 var(--body);color:var(--faint);font-variant-numeric:tabular-nums;transition:color .25s}
.steps li[aria-current=step] button,.steps button:hover{color:var(--cream)}
.steps li[aria-current=step] button b{color:var(--gold)}
.steps button:focus-visible{outline:2px solid var(--gold);outline-offset:-2px}
@media(min-width:620px){.steps{grid-template-columns:repeat(4,1fr)}.steps li{border-inline-end:1px solid var(--line)}.steps li:last-child{border-inline-end:0}.steps button{flex-direction:column;gap:8px;padding:16px 14px 18px}}

/* phone */
.stage{position:relative;display:grid;justify-items:center}
.stage:before{content:"";position:absolute;inset:8% -6% 4%;border-radius:40%;background:radial-gradient(closest-side,color-mix(in srgb,var(--gold) 11%,transparent),transparent);pointer-events:none}
.phone{position:relative;width:min(340px,86vw);aspect-ratio:9/18.6;border-radius:46px;padding:10px;background:linear-gradient(160deg,#2a2722,#12110f 40%,#1d1b18);
 box-shadow:0 0 0 1px rgba(255,255,255,.07),0 40px 90px -20px rgba(0,0,0,.8),inset 0 0 0 1px rgba(255,255,255,.04)}
.phone:after{content:"";position:absolute;top:18px;left:50%;width:84px;height:24px;margin-left:-42px;border-radius:14px;background:#050505}
.screen{position:relative;height:100%;border-radius:37px;overflow:hidden;background:#0f1923;display:flex;flex-direction:column;direction:ltr;
 font:400 12.5px/1.42 Inter,"Readex Pro",system-ui,sans-serif;color:#e8eef4}
.screen:before{content:"";position:absolute;inset:0;opacity:.5;pointer-events:none;
 background:radial-gradient(circle at 20% 30%,rgba(76,126,168,.18),transparent 40%),radial-gradient(circle at 80% 80%,rgba(76,126,168,.12),transparent 45%)}
.tg-head{position:relative;display:flex;align-items:center;gap:10px;padding:46px 12px 10px;background:#17212b;border-bottom:1px solid rgba(0,0,0,.3)}
.tg-head img{width:34px;height:34px;border-radius:50%;object-fit:cover}
.tg-head .who{min-width:0;flex:1}
.tg-head .who b{display:block;font-weight:600;font-size:14px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tg-head .who small{display:block;font-size:12px;color:#7d8e9f}
.tg-head .who small.t{color:#6ab3f3}
.tg-head .ico{color:#7d8e9f}
.chat{position:relative;flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding:10px 8px 12px;overflow:hidden}
.day{align-self:center;margin-bottom:auto;padding:3px 10px;border-radius:999px;background:rgba(0,0,0,.28);color:#c5d2de;font-size:11px;font-weight:500}
.msg{max-width:88%;animation:pop .35s cubic-bezier(.2,.8,.2,1) both}
.msg:not(.on){display:none}
.msg.out{align-self:flex-end}
.bub{position:relative;padding:7px 10px 18px;border-radius:14px;background:#182533}
.out .bub{background:#2b5278;border-bottom-right-radius:5px}
.in .bub{border-bottom-left-radius:5px}
.bub p+p{margin-top:2px}
.bub .t{position:absolute;right:9px;bottom:4px;font-size:10px;color:#7d8e9f}
.out .bub .t{color:#a6c5e3}
.bub code{display:block;margin-top:3px;padding:4px 6px;border-radius:6px;background:rgba(0,0,0,.25);font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f3ecdf;word-break:break-all}
.frame:not(.on){display:none}
.frame.on{animation:fade .3s ease both}
.kb{display:grid;gap:4px;margin-top:4px;grid-template-columns:1fr 1fr}
.kb span{grid-column:span 1;display:flex;align-items:center;justify-content:center;min-height:30px;padding:4px 6px;border-radius:9px;background:rgba(255,255,255,.09);
 font-size:11.5px;font-weight:500;text-align:center;line-height:1.2;transition:transform .15s,filter .15s}
.kb .w{grid-column:span 2}
.kb .b{background:#3a6ea5}
.kb .g{background:#3f8a46}
.kb .r{background:#9d4343}
.kb .press{transform:scale(.94);filter:brightness(1.35)}
.tg-input{display:flex;align-items:center;gap:8px;padding:8px 10px 16px;background:#17212b}
.tg-input span{flex:1;height:32px;border-radius:16px;background:#242f3d;color:#7d8e9f;display:flex;align-items:center;padding:0 12px;font-size:12px}
.tg-input i{width:32px;height:32px;border-radius:50%;background:#3a6ea5;flex:none}
.stage figcaption{margin-top:18px;font-size:13px;color:var(--faint);text-align:center}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}

/* sections */
section{padding:72px 0}
@media(min-width:900px){section{padding:112px 0}}
.rule{border-top:1px solid var(--line)}
.split{display:grid;gap:48px;align-items:start}
@media(min-width:960px){.split{grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:80px}}

/* shelf */
.shelf{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:48px}
@media(min-width:640px){.shelf{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(min-width:1000px){.shelf{grid-template-columns:repeat(4,minmax(0,1fr))}}
.tile{position:relative;display:flex;flex-direction:column;min-height:168px;padding:18px;border:1px solid var(--line);border-radius:var(--r);background:var(--ink2);transition:border-color .25s,transform .25s,background .25s}
a.tile:hover{border-color:var(--goldline);background:var(--ink3);transform:translateY(-2px)}
.tile .mono{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;border:1px solid var(--line2);font:700 20px/1 var(--display);color:var(--cream)}
.tile .count{position:absolute;top:20px;inset-inline-end:18px;font-size:12px;color:var(--muted)}
.tile h3{margin-top:auto;padding-top:22px;font-size:clamp(18px,2vw,22px);line-height:1.15;letter-spacing:-.01em;overflow-wrap:anywhere}
.tile .price{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;font-size:14px;color:var(--muted)}
.tile .price b{color:var(--cream);font-weight:600}
.tile .price .ico{color:var(--faint);transition:color .25s,transform .25s}
a.tile:hover .price .ico{color:var(--gold);transform:translateX(3px)}
[dir=rtl] a.tile:hover .price .ico{transform:scaleX(-1) translateX(3px)}
.soonlist{list-style:none;display:flex;flex-wrap:wrap;gap:10px;margin-top:48px;max-width:960px}
.soonlist li{display:inline-flex;align-items:baseline;gap:10px;min-height:52px;padding:12px 20px;border:1px dashed var(--line2);border-radius:999px;
 font:600 clamp(17px,2vw,22px)/1.2 var(--display);color:var(--muted);letter-spacing:-.01em}
.soonlist small{font:600 11px/1 var(--body);letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
[dir=rtl] .soonlist small{letter-spacing:0;font-size:12px}
.soonlist li:nth-child(3n+1){color:var(--cream)}

/* featured */
.feat{margin-top:56px}
.feat-row{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,1fr);gap:12px;margin-top:18px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px;scrollbar-width:thin}
@media(min-width:1000px){.feat-row{grid-auto-flow:row;grid-template-columns:repeat(4,1fr);overflow:visible}}
.card{scroll-snap-align:start;display:flex;flex-direction:column;gap:6px;padding:18px;border-radius:var(--r);border:1px solid var(--line);background:var(--ink2)}
.card .nm{font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.card .meta{font-size:13px;color:var(--muted)}
.card .pr{display:flex;align-items:baseline;gap:8px;margin-top:auto;padding-top:12px;font:700 22px/1 var(--display)}
.card .pr s{font:400 14px/1 var(--body);color:var(--faint)}
.card .pr .from{font:400 13px/1 var(--body);color:var(--faint)}
.card .go{display:inline-flex;align-items:center;gap:8px;min-height:44px;margin-top:6px;font-size:14px;font-weight:600;color:var(--gold)}

/* receipt + seal */
.facts{list-style:none;margin-top:28px;display:grid;gap:0;border-top:1px solid var(--line)}
.facts li{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);font-weight:500}
.facts .ico{color:var(--gold)}
.slip{position:relative;max-width:440px;margin-inline:auto;width:100%}
.receipt{position:relative;padding:28px 26px 34px;background:var(--cream);color:#1d1a15;border-radius:6px 6px 0 0;
 -webkit-mask:radial-gradient(circle 7px at 50% 100%,transparent 6.5px,#000 7px) 0 100%/18px 100% repeat-x;mask:radial-gradient(circle 7px at 50% 100%,transparent 6.5px,#000 7px) 0 100%/18px 100% repeat-x;
 box-shadow:0 40px 80px -30px rgba(0,0,0,.7);transform:rotate(-1.2deg)}
[dir=rtl] .receipt{transform:rotate(1.2deg)}
.receipt .hd{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:16px;border-bottom:1px dashed rgba(29,26,21,.28)}
.receipt .hd b{font:700 20px/1.1 var(--display)}
.receipt .hd small{font-size:12px;color:#6b6457;white-space:nowrap}
.receipt dl{display:grid;grid-template-columns:auto 1fr;gap:10px 16px;padding:18px 0;border-bottom:1px dashed rgba(29,26,21,.28);font-size:14px}
.receipt dt{color:#6b6457}
.receipt dd{text-align:end;font-weight:600;overflow-wrap:anywhere}
.receipt .key{margin-top:18px;padding:12px 14px;border-radius:10px;background:#1d1a15;color:var(--cream);font:500 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;direction:ltr;text-align:left;overflow-wrap:anywhere}
.receipt .txt{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;min-height:44px;border-radius:10px;border:1px solid rgba(29,26,21,.22);font-weight:600;font-size:14px}
.seal{position:absolute;z-index:2;top:-58px;inset-inline-end:-34px;width:148px;height:148px;color:var(--gold);filter:drop-shadow(0 18px 30px rgba(0,0,0,.55))}
.seal svg{width:100%;height:100%;overflow:visible}
.seal .spin{transform-origin:100px 100px;animation:rot 28s linear infinite}
.seal text{font:600 12.5px var(--body);letter-spacing:1px;fill:currentColor}
[dir=rtl] .seal text{letter-spacing:0;font-size:16px;direction:ltr}
@media(max-width:520px){.seal{width:108px;height:108px;top:-46px;inset-inline-end:-6px}}
@keyframes rot{to{transform:rotate(360deg)}}

/* payments */
.pays{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:40px}
.pay{display:flex;align-items:center;gap:14px;min-height:76px;padding:14px 16px;border:1px solid var(--line);border-radius:var(--r)}
.pay .mk{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--ink3);font:700 15px/1 var(--display);color:var(--gold);flex:none}
.pay b{display:block;font-weight:600}
.pay small{display:block;color:var(--muted);font-size:13px}

/* features */
.feats{list-style:none;display:grid;margin-top:8px;border-top:1px solid var(--line)}
@media(min-width:760px){.feats{grid-template-columns:1fr 1fr;column-gap:56px}}
.feats li{display:grid;grid-template-columns:40px 1fr;gap:4px 14px;padding:24px 0;border-bottom:1px solid var(--line)}
.feats .em{grid-row:span 2;font-size:22px;line-height:1.3}
.feats b{font:600 18px/1.35 var(--display);letter-spacing:-.01em}
[dir=rtl] .feats b{letter-spacing:0}
.feats p{color:var(--muted);font-size:15px}

/* faq */
.faq{border-top:1px solid var(--line);margin-top:8px}
.faq details{border-bottom:1px solid var(--line)}
.faq summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;padding:18px 0;cursor:pointer;font:600 clamp(17px,1.8vw,20px)/1.35 var(--display)}
.faq summary::-webkit-details-marker{display:none}
.faq summary .ico{color:var(--muted);transition:transform .25s,color .25s}
.faq details[open] summary .ico{transform:rotate(45deg);color:var(--gold)}
.faq details p{padding:0 0 22px;color:var(--muted);max-width:68ch}

/* final */
.final{padding:0 0 96px}
.band{position:relative;display:grid;gap:28px;padding:48px 24px;border-radius:28px;border:1px solid var(--line);background:var(--ink2);overflow:hidden}
.band:before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.6}
@media(min-width:900px){.band{grid-template-columns:1fr auto;align-items:center;padding:72px 64px}}
.band h2{margin:0;font-size:clamp(30px,4.4vw,54px);max-width:16ch}
.band .art{display:none}
@media(min-width:900px){.band.has-art{grid-template-columns:1fr auto auto}.band .art{display:block;width:180px;height:180px;border-radius:22px;object-fit:cover}}

/* footer */
footer{border-top:1px solid var(--line);padding:40px 0 calc(40px + env(safe-area-inset-bottom))}
footer .wrap{display:grid;gap:24px}
@media(min-width:760px){footer .wrap{grid-template-columns:1fr auto;align-items:center}}
.fnote{color:var(--muted);font-size:14px;max-width:60ch;margin-top:8px}
.flinks{display:flex;flex-wrap:wrap;gap:4px 8px}
.flinks a{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;color:var(--muted);font-size:14px;font-weight:500}
.flinks a:hover{color:var(--cream)}
.copy{color:var(--faint);font-size:13px}

/* mobile bar */
.mbar{position:fixed;inset:auto 12px calc(12px + env(safe-area-inset-bottom));z-index:45;display:flex;align-items:center;gap:12px;padding:8px 8px 8px 16px;
 border-radius:999px;background:color-mix(in srgb,var(--ink3) 92%,transparent);border:1px solid var(--line2);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
 transform:translateY(140%);transition:transform .35s cubic-bezier(.2,.8,.2,1)}
[dir=rtl] .mbar{padding:8px 16px 8px 8px}
.mbar.show{transform:none}
.mbar span{flex:1;min-width:0;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mbar .btn{min-height:44px;padding:0 18px;font-size:14px}
@media(min-width:900px){.mbar{display:none}}

@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}html{scroll-behavior:auto}}
`;
}

// phone timeline: starts in view, loops, pauses on hover/focus/hidden tab; the default markup
// already shows the final state, so no-JS and reduced-motion visitors see a complete order
const JS = `(()=>{const top=document.querySelector('.top');const solid=()=>top&&top.classList.toggle('solid',scrollY>8);addEventListener('scroll',solid,{passive:true});solid();
const bar=document.querySelector('.mbar'),hero=document.querySelector('.hero');if(bar&&hero){const t=()=>{const r=hero.getBoundingClientRect();bar.classList.toggle('show',r.bottom<80&&innerHeight+scrollY<document.body.scrollHeight-260)};addEventListener('scroll',t,{passive:true});t()}
const ph=document.querySelector('.phone');if(!ph)return;const rm=matchMedia('(prefers-reduced-motion: reduce)').matches;
const msgs=[...ph.querySelectorAll('[data-at]')],frames=[...ph.querySelectorAll('[data-f]')],st=ph.querySelector('.who small'),steps=[...document.querySelectorAll('.steps li')];
const S=st?st.dataset:{};const STEP_OF=[0,0,0,1,2,3];
function show(n){ph.dataset.step=n;msgs.forEach(m=>m.classList.toggle('on',n>=+m.dataset.at));frames.forEach(f=>f.classList.toggle('on',+f.dataset.f===Math.max(1,Math.min(n,5))));
steps.forEach((s,i)=>i===STEP_OF[n]&&n>0?s.setAttribute('aria-current','step'):s.removeAttribute('aria-current'))}
function press(k){const b=ph.querySelector('[data-press="'+k+'"]');if(b){b.classList.add('press');setTimeout(()=>b.classList.remove('press'),380)}}
function typing(on){if(st){st.textContent=on?S.typing:S.idle;st.classList.toggle('t',on)}}
const TL=[[0,650],['t',650],[1,1700],['p2',420],['t',380],[2,1600],['p3',420],['t',380],[3,1700],['p4',420],['t',380],[4,1900],['p5',420],['t',650],[5,4600]];
let i=0,timer=0,paused=false,running=false;
function tick(){if(paused)return;const [a,d]=TL[i];if(a==='t'){typing(true)}else if(typeof a==='string'){press(a.slice(1))}else{typing(false);show(a)}
i=(i+1)%TL.length;if(i===0){timer=setTimeout(()=>{show(0);tick()},d);return}timer=setTimeout(tick,d)}
function start(){if(running||rm)return;running=true;show(0);i=1;timer=setTimeout(tick,500)}
function stop(){paused=true;clearTimeout(timer)}function resume(){if(!running)return;paused=false;clearTimeout(timer);timer=setTimeout(tick,600)}
const JUMP=[1,3,4,5];steps.forEach((s,k)=>{const b=s.querySelector('button');b&&b.addEventListener('click',()=>{stop();show(JUMP[k]);typing(false);i=TL.findIndex(x=>x[0]===JUMP[k])+1;setTimeout(()=>{if(running)resume()},5200)})});
if(rm){show(5);return}
ph.addEventListener('mouseenter',stop);ph.addEventListener('mouseleave',resume);ph.addEventListener('touchstart',()=>{paused?resume():stop()},{passive:true});
document.addEventListener('visibilitychange',()=>document.hidden?stop():resume());
if('IntersectionObserver' in window){new IntersectionObserver((e,o)=>{if(e[0].isIntersecting){start();o.disconnect()}},{threshold:.35}).observe(ph)}else start()})();`;

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function Lines(props: { lines: readonly string[] }) {
  return <>{props.lines.map((l) => <p>{l}</p>)}</>;
}

function Phone(props: { s: AppSettings; lang: Lang; logo: string }) {
  const d = demoCopy(props.lang, props.s.brand.name);
  return (
    <div class="phone" data-step="5" aria-hidden="true">
      <div class="screen">
        <div class="tg-head">
          <Icon name="back" size={20} />
          <img src={props.logo} alt="" width="34" height="34" loading="lazy" />
          <div class="who">
            <b>{props.s.brand.name}</b>
            <small data-idle={d.status} data-typing={d.typing}>{d.status}</small>
          </div>
          <Icon name="dots" size={20} />
        </div>
        <div class="chat">
          <span class="day">{props.lang === 'ar' ? 'اليوم' : 'Today'}</span>
          <div class="msg out on" data-at="0"><div class="bub"><p>{d.start}</p><span class="t">12:04</span></div></div>
          <div class="msg in on" data-at="1">
            <div class="frame" data-f="1">
              <div class="bub"><Lines lines={d.welcome} /><span class="t">12:04</span></div>
              <div class="kb">
                <span class="w b" data-press="2">{d.shop}</span>
                <span class="b">{d.deposit}</span><span class="b">{d.profile}</span>
                <span class="w g">{d.support}</span>
              </div>
            </div>
            <div class="frame" data-f="2">
              <div class="bub"><Lines lines={d.shopText} /><span class="t">12:04</span></div>
              <div class="kb">
                <span class="b" data-press="3">{d.cats[0]}</span><span class="b">{d.cats[1]}</span>
                <span class="b">{d.cats[2]}</span><span class="b">{d.cats[3]}</span>
                <span>{d.back}</span><span>{d.home}</span>
              </div>
            </div>
            <div class="frame" data-f="3">
              <div class="bub"><Lines lines={d.packsText} /><span class="t">12:05</span></div>
              <div class="kb">
                <span class="w g" data-press="4">{d.packs[0]}</span>
                <span class="w g">{d.packs[1]}</span>
                <span class="w r">{d.packs[2]}</span>
                <span>{d.back}</span><span>{d.home}</span>
              </div>
            </div>
            <div class="frame" data-f="4">
              <div class="bub"><Lines lines={d.checkout} /><span class="t">12:05</span></div>
              <div class="kb">
                <span class="w g" data-press="5">{d.pay}</span>
                <span>{d.promo}</span><span class="r">{d.cancel}</span>
              </div>
            </div>
            <div class="frame on" data-f="5">
              <div class="bub"><Lines lines={d.paid} /><span class="t">12:05</span></div>
            </div>
          </div>
          <div class="msg in on" data-at="5">
            <div class="bub">
              <p><b>{d.delivered}</b></p>
              <p>{d.item}</p>
              <p>{d.yours}</p>
              <code>{d.key}</code>
              <p>{d.warranty}</p>
              <p>{d.order} PSX-7K2Q9M</p>
              <span class="t">12:05</span>
            </div>
            <div class="kb"><span class="w b">{d.txt}</span></div>
          </div>
        </div>
        <div class="tg-input"><span>Message</span><i /></div>
      </div>
    </div>
  );
}

function Seal(props: { text: string; lang: Lang }) {
  // static SVG; the text comes from the constant UI copy. Latin text is fitted to the circle
  // with letter spacing. Arabic keeps natural spacing (spacing would break joined letters), is
  // repeated to close the ring, and is laid out LTR along the path: Chromium drops RTL text
  // on a closed textPath.
  const ar = props.lang === 'ar';
  const fit = ar ? {} : { textLength: '462', lengthAdjust: 'spacing' };
  const t = ar ? props.text.repeat(3) : props.text;
  return (
    <div class="seal" aria-hidden="true">
      <svg viewBox="0 0 200 200">
        <defs><path id="seal-path" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" /></defs>
        <circle cx="100" cy="100" r="96" fill="#0e0d0b" stroke="currentColor" stroke-opacity=".5" />
        <circle cx="100" cy="100" r="54" fill="none" stroke="currentColor" stroke-opacity=".35" />
        <g class="spin"><text direction={ar ? 'ltr' : undefined}><textPath href="#seal-path" {...fit}>{t}</textPath></text></g>
        <g transform="translate(76 76) scale(2)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
        </g>
      </svg>
    </div>
  );
}

interface PayChip { mark: string; name: string; note: string }

function paymentChips(s: AppSettings, ui: UiCopy, lang: Lang): PayChip[] {
  const p = s.payments;
  const all: (PayChip & { on: boolean })[] = [
    { on: p.binance_pay.enabled || p.binance_id.enabled, mark: 'B', name: 'Binance', note: p.binance_pay.enabled ? 'Binance Pay' : 'Pay ID' },
    { on: p.nowpayments.enabled, mark: '₮', name: 'USDT', note: 'BEP20' },
    { on: p.shamcash.enabled, mark: 'SC', name: lang === 'ar' ? 'شام كاش' : 'ShamCash', note: p.shamcash.currency === 'SYP' ? 'SYP' : 'USD' },
  ];
  // until the owner enables methods, show the supported ones
  const list = all.some((m) => m.on) ? all.filter((m) => m.on) : all;
  return [...list, { mark: '$', name: ui.wallet, note: 'USD' }];
}

function monogram(name: string): string {
  const ch = [...name.trim()][0] ?? '•';
  return ch.toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function Page(props: { s: AppSettings; lang: Lang; data: Data; origin: string }) {
  const { s, lang, data, origin } = props;
  const L = s.landing;
  const ui = UI[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const pickL = (en: string, ar: string) => (lang === 'ar' ? ar : en) || en;
  const title = pickL(L.title_en, L.title_ar);
  const subtitle = pickL(L.subtitle_en, L.subtitle_ar);
  const cta = pickL(L.cta_en, L.cta_ar);
  const tagline = pickL(s.brand.tagline_en, s.brand.tagline_ar);
  const footer = pickL(L.footer_en, L.footer_ar);
  const logo = safeUrl(s.brand.logo_url) || '/assets/logo.jpg';
  const art = safeUrl(L.hero_image_url);
  const channel = safeUrl(s.brand.channel_url);
  const group = safeUrl(s.brand.group_url);
  const website = safeUrl(s.brand.website_url);
  const logoAbs = logo.startsWith('http') ? logo : `${origin}${logo}`;
  const shop = botLink(s, 'shop');
  const support = s.brand.support_username ? `https://t.me/${s.brand.support_username.replace(/^@/, '')}` : '';
  const home = lang === 'ar' ? '/ar' : '/';
  const otherLangHref = lang === 'ar' ? '/' : '/ar';
  const pageTitle = `${s.brand.name} — ${tagline}`;
  const description = L.seo_description || subtitle;
  const pays = paymentChips(s, ui, lang);
  const features = L.features.filter((f) => pickL(f.title_en, f.title_ar));
  const faq = L.faq.filter((f) => pickL(f.q_en, f.q_ar));

  // numbered sections only for the ones that render
  let n = 0;
  const num = () => String(++n).padStart(2, '0');
  const showCatalog = L.show_products;
  const hasShelf = data.shelves.length > 0;

  const sameAs = [channel, group].filter((u) => u.startsWith('http'));
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: s.brand.name,
    url: `${origin}/`,
    logo: logoAbs,
    description,
    ...(sameAs.length ? { sameAs } : {}),
  }).replace(/</g, '\\u003c');
  const fonts = lang === 'ar'
    ? 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Readex+Pro:wght@400;500;600;700&display=swap'
    : 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Inter:wght@400;500;600&display=swap';

  return (
    <html lang={lang} dir={dir}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{pageTitle}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#0e0d0b" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={s.brand.name} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={logoAbs} />
        <meta property="og:url" content={`${origin}${home}`} />
        <meta property="og:locale" content={lang === 'ar' ? 'ar_AR' : 'en_US'} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={logoAbs} />
        <link rel="canonical" href={`${origin}${home}`} />
        <link rel="icon" href={logo} />
        <link rel="apple-touch-icon" href={logo} />
        <link rel="alternate" hreflang="en" href={`${origin}/`} />
        <link rel="alternate" hreflang="ar" href={`${origin}/ar`} />
        <link rel="alternate" hreflang="x-default" href={`${origin}/`} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link href={fonts} rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: css(L.accent_color || '#F5B301', lang) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      </head>
      <body dir={dir}>
        <a class="skip" href="#main">{lang === 'ar' ? 'تخطَّ إلى المحتوى' : 'Skip to content'}</a>

        <header class="top">
          <div class="wrap">
            <a class="brand" href={home}>
              <img src={logo} alt="" width="34" height="34" />
              <span>{s.brand.name}</span>
            </a>
            <nav class="nav" aria-label={lang === 'ar' ? 'الأقسام' : 'Sections'}>
              {showCatalog && <a href="#catalog">{ui.nav_catalog}</a>}
              <a href="#how">{ui.nav_how}</a>
              <a href="#pay">{ui.nav_pay}</a>
              {faq.length > 0 && <a href="#faq">{ui.nav_faq}</a>}
            </nav>
            <a class="lang" href={otherLangHref} hreflang={lang === 'ar' ? 'en' : 'ar'} lang={lang === 'ar' ? 'en' : 'ar'}>{ui.switch}</a>
            <a class="btn sm" href={shop}><TgIcon size={16} />{cta}</a>
          </div>
        </header>

        <main id="main">
          <section class="hero" id="how" aria-labelledby="hero-title">
            <div class="wrap">
              <div>
                <span class="eyebrow"><i />{ui.eyebrow}</span>
                <h1 id="hero-title">{title}</h1>
                <p class="lede">{subtitle}</p>
                <div class="cta">
                  <a class="btn" href={shop}><TgIcon size={20} />{cta}</a>
                  {showCatalog && <a class="link" href="#catalog">{ui.browse}<Icon name="down" size={18} /></a>}
                </div>
                <ol class="steps" aria-label={ui.steps_label}>
                  {[ui.step1, ui.step2, ui.step3, ui.step4].map((t, i) => (
                    <li aria-current={i === 3 ? 'step' : undefined}><button type="button"><b>{`0${i + 1}`}</b>{t}</button></li>
                  ))}
                </ol>
              </div>
              <figure class="stage">
                <Phone s={s} lang={lang} logo={logo} />
                <figcaption>{ui.demo_label}</figcaption>
              </figure>
            </div>
          </section>

          {showCatalog && (
            <section class="rule" id="catalog" aria-labelledby="catalog-title">
              <div class="wrap">
                <p class="label"><b>{num()}</b>{ui.sec_catalog}</p>
                <h2 id="catalog-title">{hasShelf ? ui.catalog_title : ui.soon_title}</h2>
                <p class="lede">{hasShelf ? ui.catalog_text : ui.soon_text}</p>
                {hasShelf ? (
                  <div class="shelf">
                    {data.shelves.map((t) => (
                      <a class="tile" href={botLink(s, `c_${t.id}`)}>
                        <span class="mono">{t.emoji || monogram(t.name)}</span>
                        <span class="count">{ui.packs(t.count)}</span>
                        <h3>{t.name}</h3>
                        <span class="price">
                          {t.from != null ? <span>{ui.from} <bdi dir="ltr"><b>{fmtUsd(t.from)}</b></bdi></span> : <span>{ui.restocking}</span>}
                          <Icon name="arrow" size={18} />
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <ul class="soonlist" aria-label={ui.soon}>
                    {SOON.map((name) => (
                      <li><span dir="ltr">{name}</span><small>{ui.soon}</small></li>
                    ))}
                  </ul>
                )}
                {data.featured.length > 0 && (
                  <div class="feat">
                    <p class="label">{ui.featured}</p>
                    <div class="feat-row">
                      {data.featured.map((f) => (
                        <a class="card" href={botLink(s, `${f.kind}_${f.id}`)}>
                          <span class="nm">{f.emoji ? `${f.emoji} ` : ''}{f.name}</span>
                          {f.warranty > 0 && <span class="meta">{ui.warranty_d(f.warranty)}</span>}
                          <span class="pr">{f.kind === 'g' && <span class="from">{ui.from} </span>}<bdi dir="ltr">{fmtUsd(f.price)}</bdi>{f.original != null && <s><bdi dir="ltr">{fmtUsd(f.original)}</bdi></s>}</span>
                          <span class="go"><TgIcon size={16} />{ui.buy}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          <section class="rule" aria-labelledby="receipt-title">
            <div class="wrap split">
              <div>
                <p class="label"><b>{num()}</b>{ui.sec_receipt}</p>
                <h2 id="receipt-title">{ui.receipt_title}</h2>
                <p class="lede">{ui.receipt_text}</p>
                <ul class="facts">
                  <li><Icon name="check" size={18} />{ui.receipt_f1}</li>
                  <li><Icon name="check" size={18} />{ui.receipt_f2}</li>
                  <li><Icon name="check" size={18} />{ui.receipt_f3}</li>
                </ul>
              </div>
              <div class="slip">
                <Seal text={ui.seal} lang={lang} />
                <div class="receipt" aria-hidden="true">
                  <div class="hd"><b>{lang === 'ar' ? 'تم التسليم' : 'Delivered'}</b></div>
                  <dl>
                    <dt>{lang === 'ar' ? 'المنتج' : 'Product'}</dt><dd>ChatGPT Plus · {lang === 'ar' ? 'شهر' : '1 month'}</dd>
                    <dt>{lang === 'ar' ? 'الدفع' : 'Paid'}</dt><dd>{lang === 'ar' ? 'من المحفظة' : 'From wallet'}</dd>
                    <dt>{lang === 'ar' ? 'الضمان' : 'Warranty'}</dt><dd>{lang === 'ar' ? '25 يوم' : '25 days'}</dd>
                    <dt>{lang === 'ar' ? 'رقم الطلب' : 'Order ID'}</dt><dd dir="ltr">PSX-7K2Q9M</dd>
                  </dl>
                  <div class="key">user••••@mail.com&nbsp;|&nbsp;••••••••</div>
                  <div class="txt">📥 {lang === 'ar' ? 'تحميل كملف TXT' : 'Download as TXT'}</div>
                </div>
              </div>
            </div>
          </section>

          <section class="rule" id="pay" aria-labelledby="pay-title">
            <div class="wrap">
              <p class="label"><b>{num()}</b>{ui.sec_pay}</p>
              <h2 id="pay-title">{ui.pay_title}</h2>
              <p class="lede">{ui.pay_text}</p>
              <ul class="pays" role="list">
                {pays.map((p) => (
                  <li class="pay"><span class="mk" aria-hidden="true">{p.mark}</span><span><b>{p.name}</b><small>{p.note}</small></span></li>
                ))}
              </ul>
            </div>
          </section>

          {features.length > 0 && (
            <section class="rule" aria-labelledby="why-title">
              <div class="wrap split">
                <div>
                  <p class="label"><b>{num()}</b>{ui.sec_why}</p>
                  <h2 id="why-title">{ui.why_title}</h2>
                </div>
                <ul class="feats">
                  {features.map((f) => (
                    <li>
                      <span class="em" aria-hidden="true">{f.icon}</span>
                      <b>{pickL(f.title_en, f.title_ar)}</b>
                      <p>{pickL(f.text_en, f.text_ar)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {faq.length > 0 && (
            <section class="rule" id="faq" aria-labelledby="faq-title">
              <div class="wrap split">
                <div>
                  <p class="label"><b>{num()}</b>{ui.sec_faq}</p>
                  <h2 id="faq-title">{ui.faq_title}</h2>
                </div>
                <div class="faq">
                  {faq.map((f) => (
                    <details>
                      <summary>{pickL(f.q_en, f.q_ar)}<Icon name="plus" size={20} /></summary>
                      <p>{pickL(f.a_en, f.a_ar)}</p>
                    </details>
                  ))}
                </div>
              </div>
            </section>
          )}

          <div class="final">
            <div class="wrap">
              <div class={art ? 'band has-art' : 'band'}>
                <h2>{ui.final_title}</h2>
                {art && <img class="art" src={art} alt="" width="180" height="180" loading="lazy" />}
                <a class="btn" href={shop}><TgIcon size={20} />{cta}</a>
              </div>
            </div>
          </div>
        </main>

        <footer>
          <div class="wrap">
            <div>
              <a class="brand" href={home}><img src={logo} alt="" width="34" height="34" loading="lazy" /><span>{s.brand.name}</span></a>
              {(footer || tagline) && <p class="fnote">{footer || tagline}</p>}
              <p class="copy">© {new Date().getFullYear()} {s.brand.name}. {ui.rights}</p>
            </div>
            <div class="flinks">
              {channel && <a href={channel} rel="noopener">{ui.channel}</a>}
              {group && <a href={group} rel="noopener">{ui.group}</a>}
              {support && <a href={support} rel="noopener">{ui.support}</a>}
              {website && <a href={website} rel="noopener">{ui.website}</a>}
              <a href={otherLangHref} hreflang={lang === 'ar' ? 'en' : 'ar'} lang={lang === 'ar' ? 'en' : 'ar'}>{ui.switch}</a>
            </div>
          </div>
        </footer>

        <div class="mbar">
          <span>{s.brand.name}</span>
          <a class="btn" href={shop}><TgIcon size={16} />{cta}</a>
        </div>

        <script dangerouslySetInnerHTML={{ __html: JS }} />
      </body>
    </html>
  );
}

async function render(c: Context<HonoEnv>, forced?: Lang) {
  const s = await getSettings(c.env);
  if (!s.landing.enabled) {
    const bot = botLink(s, 'shop');
    return c.redirect(bot === '#' ? '/admin/' : bot, 302);
  }
  const lang = langOf(c, forced);
  const data = await loadData(c.env, s, lang);
  const origin = baseUrl(s, c.req.raw);
  const body = await (<Page s={s} lang={lang} data={data} origin={origin} />).toString();
  return c.html(`<!doctype html>${body}`, 200, { 'Cache-Control': CACHE });
}

/** Exported for local previews / tests (renders without touching the database). */
export async function renderLandingHtml(s: AppSettings, lang: Lang, data: Data, origin: string): Promise<string> {
  return `<!doctype html>${await (<Page s={s} lang={lang} data={data} origin={origin} />).toString()}`;
}
export type { Data as LandingData };

landing.get('/', (c) => render(c));
landing.get('/ar', (c) => render(c, 'ar'));
landing.get('/en', (c) => render(c, 'en'));

landing.get('/robots.txt', async (c) => {
  const s = await getSettings(c.env);
  const origin = baseUrl(s, c.req.raw);
  return c.text(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /webhook/\nSitemap: ${origin}/sitemap.xml\n`, 200, { 'Cache-Control': 'public, max-age=3600' });
});

landing.get('/sitemap.xml', async (c) => {
  const s = await getSettings(c.env);
  const origin = baseUrl(s, c.req.raw);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${origin}/ar</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
});
