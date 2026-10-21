import { Hono } from 'hono';
import type { Context } from 'hono';
import { raw } from 'hono/html';
import type { Env } from '../env';
import type { CategoryRow, Lang } from '../types';
import { getSettings, baseUrl, type AppSettings } from '../lib/settings';
import { db, must } from '../lib/db';
import { listAllProducts, type ProductView } from '../services/catalog';
import { fmtUsd } from '../lib/money';
import { pick } from '../lib/i18n';

type HonoEnv = { Bindings: Env };
export const landing = new Hono<HonoEnv>();

const CACHE = 'public, max-age=60';
const MAX_SHOWCASE = 24;

/** Shown in the marquee / "what we offer" tiles until products are imported. */
const FALLBACK_SERVICES = [
  'ChatGPT', 'Gemini', 'Claude', 'Canva', 'CapCut', 'Netflix', 'Spotify', 'YouTube Premium',
  'Duolingo', 'Coursera', 'Grok', 'Cursor', 'ElevenLabs', 'VPN', 'Microsoft 365', 'Adobe',
];
const FALLBACK_TILES: { name: string; icon: string; kind: 'ai' | 'design' | 'video' | 'stream' | 'music' }[] = [
  { name: 'ChatGPT', icon: '🤖', kind: 'ai' },
  { name: 'Gemini', icon: '✨', kind: 'ai' },
  { name: 'Claude', icon: '🧠', kind: 'ai' },
  { name: 'Canva', icon: '🎨', kind: 'design' },
  { name: 'CapCut', icon: '🎬', kind: 'video' },
  { name: 'Netflix', icon: '🍿', kind: 'stream' },
  { name: 'Spotify', icon: '🎧', kind: 'music' },
  { name: 'YouTube Premium', icon: '▶️', kind: 'stream' },
];

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
  const q = c.req.query('lang');
  return q === 'ar' ? 'ar' : 'en';
}

const loc = (row: object, field: string, lang: Lang) => pick(row as Record<string, unknown>, field, lang);

interface Group {
  category: CategoryRow | null;
  items: ProductView[];
}

async function loadShowcase(env: Env, s: AppSettings): Promise<Group[]> {
  if (!s.landing.show_products) return [];
  try {
    let views = await listAllProducts(env, s, null, { featuredOnly: true });
    if (!views.length) views = await listAllProducts(env, s, null);
    views = views.slice(0, MAX_SHOWCASE);
    if (!views.length) return [];
    const cats = must(await db(env).from('categories').select('*').eq('is_active', true), 'categories') as CategoryRow[];
    const catMap = new Map(cats.map((c) => [c.id, c]));
    const groups = new Map<string, Group>();
    for (const v of views) {
      const key = v.product.category_id ?? '_';
      const g = groups.get(key) ?? { category: v.product.category_id ? catMap.get(v.product.category_id) ?? null : null, items: [] };
      g.items.push(v);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => (a.category?.sort ?? 9999) - (b.category?.sort ?? 9999));
  } catch (e) {
    console.error('landing showcase failed', e);
    return [];
  }
}

const UI: Record<Lang, Record<string, string>> = {
  en: {
    nav_products: 'Products',
    nav_how: 'How it works',
    nav_faq: 'FAQ',
    switch: 'العربية',
    see_products: 'Browse products',
    see_offer: 'See what we offer',
    trust_instant: 'Instant delivery',
    trust_warranty: 'Warranty included',
    trust_secure: 'Secure payments',
    trust_support: '24/7 support',
    stat_products: 'products',
    stat_categories: 'categories',
    stat_delivery: 'automatic delivery',
    chip_delivery: 'Delivered in seconds',
    chip_warranty: 'Replacement warranty',
    chip_wallet: 'Wallet top-up in USD',
    offer_kicker: 'Catalog',
    offer_title: 'Everything digital, in one place',
    offer_text: 'AI tools, streaming, design, learning and VPN subscriptions — all inside Telegram.',
    kind_ai: 'AI tools',
    kind_design: 'Design',
    kind_video: 'Video editing',
    kind_stream: 'Streaming',
    kind_music: 'Music',
    how_kicker: 'Simple',
    how_title: 'How it works',
    step1_t: 'Choose',
    step1_d: 'Open the bot and pick the subscription you need.',
    step2_t: 'Pay',
    step2_d: 'Top up your wallet with Binance, USDT or ShamCash.',
    step3_t: 'Receive',
    step3_d: 'Your product arrives in the chat — most orders in seconds.',
    products_kicker: 'Store',
    products_title: 'Popular products',
    all: 'All',
    other: 'More',
    buy: 'Buy in Telegram',
    sold_out: 'Sold out',
    sale: 'Sale',
    days: 'd warranty',
    more_in_bot: 'Full catalog in the bot',
    more_in_bot_text: 'New products are added every week.',
    open_bot: 'Open the bot',
    pay_kicker: 'Payments',
    pay_title: 'Pay the way you like',
    pay_wallet: 'Wallet balance',
    features_kicker: 'Why us',
    features_title: 'Built for trust',
    faq_kicker: 'Questions',
    faq_title: 'Frequently asked',
    ready: 'Ready to start?',
    ready_text: 'Open the bot, top up your wallet and get your product in seconds.',
    channel: 'Channel',
    group: 'Community',
    support: 'Support',
    rights: 'All rights reserved.',
  },
  ar: {
    nav_products: 'المنتجات',
    nav_how: 'كيف يعمل',
    nav_faq: 'الأسئلة',
    switch: 'English',
    see_products: 'تصفح المنتجات',
    see_offer: 'شاهد ما نقدمه',
    trust_instant: 'تسليم فوري',
    trust_warranty: 'ضمان مشمول',
    trust_secure: 'دفع آمن',
    trust_support: 'دعم على مدار الساعة',
    stat_products: 'منتج',
    stat_categories: 'قسم',
    stat_delivery: 'تسليم تلقائي',
    chip_delivery: 'تسليم خلال ثوانٍ',
    chip_warranty: 'ضمان استبدال',
    chip_wallet: 'محفظة بالدولار',
    offer_kicker: 'الكتالوج',
    offer_title: 'كل ما هو رقمي في مكان واحد',
    offer_text: 'أدوات الذكاء الاصطناعي، البث، التصميم، التعلّم واشتراكات VPN — كلها داخل تيليجرام.',
    kind_ai: 'ذكاء اصطناعي',
    kind_design: 'تصميم',
    kind_video: 'مونتاج فيديو',
    kind_stream: 'بث ومشاهدة',
    kind_music: 'موسيقى',
    how_kicker: 'بسيط',
    how_title: 'كيف يعمل',
    step1_t: 'اختر',
    step1_d: 'افتح البوت واختر الاشتراك الذي تحتاجه.',
    step2_t: 'ادفع',
    step2_d: 'اشحن محفظتك عبر بينانس أو USDT أو شام كاش.',
    step3_t: 'استلم',
    step3_d: 'يصلك منتجك في المحادثة — معظم الطلبات خلال ثوانٍ.',
    products_kicker: 'المتجر',
    products_title: 'المنتجات الأكثر طلباً',
    all: 'الكل',
    other: 'المزيد',
    buy: 'اشترِ عبر تيليجرام',
    sold_out: 'نفدت الكمية',
    sale: 'تخفيض',
    days: ' يوم ضمان',
    more_in_bot: 'الكتالوج الكامل داخل البوت',
    more_in_bot_text: 'نضيف منتجات جديدة كل أسبوع.',
    open_bot: 'افتح البوت',
    pay_kicker: 'الدفع',
    pay_title: 'ادفع بالطريقة التي تناسبك',
    pay_wallet: 'رصيد المحفظة',
    features_kicker: 'لماذا نحن',
    features_title: 'مبني على الثقة',
    faq_kicker: 'أسئلة',
    faq_title: 'الأسئلة الشائعة',
    ready: 'جاهز للبدء؟',
    ready_text: 'افتح البوت، اشحن محفظتك واحصل على منتجك خلال ثوانٍ.',
    channel: 'القناة',
    group: 'المجتمع',
    support: 'الدعم',
    rights: 'جميع الحقوق محفوظة.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Icons (inline SVG, stroke style)
// ─────────────────────────────────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  headset: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
};

function Icon(props: { name: string; size?: number }) {
  const size = props.size ?? 20;
  // icon paths are static constants above, never user input
  return raw(
    `<svg class="ico ico-${props.name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[props.name] ?? ''}</svg>`,
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

const NOISE = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;

function css(accentRaw: string): string {
  // only a plain hex color may reach the stylesheet
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(accentRaw) ? accentRaw : '#F5B301';
  return `
:root{--gold:${accent};--gold2:#ffd76a;--gold3:#fff1c2;--bg:#050507;--bg2:#0b0b10;--card:rgba(255,255,255,.035);--card2:rgba(255,255,255,.06);
--line:rgba(255,215,106,.16);--line2:rgba(255,215,106,.34);--text:#f5f2ea;--muted:#a8a294;--radius:20px}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%;overflow-x:hidden;overflow-x:clip}
body{background:var(--bg);color:var(--text);font:16px/1.6 Inter,Cairo,system-ui,-apple-system,"Segoe UI",sans-serif;overflow-x:hidden;overflow-x:clip;-webkit-font-smoothing:antialiased}
main,footer{overflow-x:hidden;overflow-x:clip}
body[dir=rtl]{font-family:Cairo,Inter,system-ui,sans-serif}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.ico{flex:none;display:block}
body[dir=rtl] .ico-arrow{transform:scaleX(-1)}
.wrap{max-width:1180px;margin:0 auto;padding:0 16px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
/* background layers */
.bg{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
.bg .glow{position:absolute;inset:-25vmax;background:
 radial-gradient(38vmax 38vmax at 18% 8%,rgba(245,179,1,.17),transparent 62%),
 radial-gradient(30vmax 30vmax at 88% 26%,rgba(255,215,106,.10),transparent 60%),
 radial-gradient(44vmax 44vmax at 50% 108%,rgba(245,179,1,.10),transparent 60%);animation:drift 22s ease-in-out infinite alternate}
.bg .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,215,106,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,215,106,.045) 1px,transparent 1px);
 background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 25%,transparent 75%);mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 25%,transparent 75%)}
.bg .noise{position:absolute;inset:0;background-image:${NOISE};opacity:.05;mix-blend-mode:overlay}
@keyframes drift{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(2vmax,-2vmax,0) scale(1.08)}}
/* text helpers */
.gold{background:linear-gradient(180deg,var(--gold3) 0%,var(--gold2) 45%,var(--gold) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.kicker{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--gold2);
 padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:rgba(245,179,1,.06)}
body[dir=rtl] .kicker{letter-spacing:0}
.kicker:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--gold);box-shadow:0 0 10px var(--gold)}
.head{text-align:center;max-width:720px;margin:0 auto 40px}
.head h2{font-size:clamp(26px,4.2vw,42px);line-height:1.15;font-weight:800;margin:14px 0 10px;letter-spacing:-.01em}
.head p{color:var(--muted);font-size:clamp(15px,2vw,18px)}
/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:15px 26px;border-radius:14px;font-weight:700;font-size:16px;white-space:nowrap;
 background:linear-gradient(135deg,var(--gold2),var(--gold) 55%,#d99400);color:#1a1200;box-shadow:0 10px 34px rgba(245,179,1,.28),inset 0 1px 0 rgba(255,255,255,.45);
 transition:transform .18s ease,box-shadow .25s ease}
.btn:hover{transform:translateY(-2px);box-shadow:0 16px 44px rgba(245,179,1,.4),inset 0 1px 0 rgba(255,255,255,.45)}
.btn.sm{padding:10px 16px;border-radius:12px;font-size:14px}
.btn.ghost{background:rgba(255,255,255,.03);color:var(--text);border:1px solid var(--line2);box-shadow:none}
.btn.ghost:hover{border-color:var(--gold);color:var(--gold2)}
.btn.block{width:100%}
/* nav */
nav{position:sticky;top:0;z-index:20;backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);background:rgba(5,5,7,.62);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;height:68px}
.brand{display:flex;align-items:center;gap:11px;font-weight:800;font-size:17px;min-width:0}
.brand img{width:40px;height:40px;border-radius:12px;object-fit:cover;box-shadow:0 0 0 1px var(--line2),0 0 18px rgba(245,179,1,.25)}
.brand span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.links{display:flex;align-items:center;gap:4px}
.links a.l{padding:8px 12px;border-radius:10px;color:var(--muted);font-size:14px;font-weight:600;transition:color .2s,background .2s}
.links a.l:hover{color:var(--text);background:rgba(255,255,255,.04)}
.lang{padding:8px 12px;border-radius:10px;border:1px solid var(--line);font-size:14px;font-weight:600;color:var(--muted)}
.lang:hover{color:var(--text);border-color:var(--gold)}
/* hero */
.hero{padding:72px 0 56px}
.hero .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
.hero h1{font-size:clamp(34px,5.6vw,64px);line-height:1.06;font-weight:800;letter-spacing:-.025em;margin:18px 0 18px}
body[dir=rtl] .hero h1{letter-spacing:0;line-height:1.25}
.hero .sub{font-size:clamp(16px,2.1vw,19px);color:var(--muted);max-width:560px;margin-bottom:30px}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.trust{display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:30px;color:var(--muted);font-size:14px;font-weight:600}
.trust span{display:inline-flex;align-items:center;gap:7px}
.trust .ico{color:var(--gold2)}
.stats{display:flex;gap:26px;margin-top:28px;flex-wrap:wrap}
.stats div{min-width:0}
.stats b{display:block;font-size:26px;font-weight:800;line-height:1.1}
.stats small{color:var(--muted);font-size:13px}
/* hero visual */
.visual{position:relative;width:min(100%,420px);aspect-ratio:1;margin-inline:auto}
.visual .ring{position:absolute;inset:4%;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 20%,rgba(255,215,106,.7) 32%,transparent 44%,transparent 70%,rgba(245,179,1,.5) 82%,transparent 94%);
 -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 1px));mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 1px));animation:spin 14s linear infinite}
.visual .ring2{position:absolute;inset:16%;border-radius:50%;border:1px dashed rgba(255,215,106,.18);animation:spin 40s linear infinite reverse}
.visual .halo{position:absolute;inset:18%;border-radius:50%;background:radial-gradient(circle,rgba(245,179,1,.35),transparent 65%);filter:blur(24px)}
.visual .logo{position:absolute;inset:24%;border-radius:32px;overflow:hidden;box-shadow:0 0 0 1px var(--line2),0 30px 80px rgba(0,0,0,.6),0 0 70px rgba(245,179,1,.25);animation:float 7s ease-in-out infinite}
.visual .logo img{width:100%;height:100%;object-fit:cover}
.chip{position:absolute;display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:14px;font-size:13px;font-weight:700;white-space:nowrap;
 background:rgba(14,14,20,.72);border:1px solid var(--line2);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 14px 40px rgba(0,0,0,.45);animation:float 6s ease-in-out infinite}
.chip .ico{color:var(--gold2)}
.chip.c1{top:9%;inset-inline-start:-4%}
.chip.c2{top:46%;inset-inline-end:-8%;animation-delay:-2s}
.chip.c3{bottom:7%;inset-inline-start:4%;animation-delay:-4s}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes float{50%{transform:translateY(-9px)}}
/* marquee */
.marquee{border-block:1px solid var(--line);background:linear-gradient(90deg,rgba(245,179,1,.04),rgba(255,255,255,.015),rgba(245,179,1,.04));overflow:hidden;direction:ltr;
 -webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.track{display:flex;gap:14px;width:max-content;padding:18px 0;animation:scroll 38s linear infinite}
.marquee:hover .track{animation-play-state:paused}
.track span{display:inline-flex;align-items:center;gap:10px;padding:9px 18px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-weight:600;font-size:15px;white-space:nowrap}
.track span i{width:7px;height:7px;border-radius:50%;background:var(--gold);box-shadow:0 0 10px var(--gold);font-style:normal}
@keyframes scroll{to{transform:translateX(-50%)}}
/* sections */
section{padding:88px 0}
.card{position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:var(--radius);
 backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:transform .25s ease,border-color .25s ease,box-shadow .25s ease}
.card:hover{transform:translateY(-4px);border-color:var(--line2);box-shadow:0 20px 50px rgba(0,0,0,.35),0 0 0 1px rgba(245,179,1,.06)}
/* offer tiles (no products yet) */
.tiles{display:grid;gap:14px;grid-template-columns:repeat(4,1fr)}
.tile{display:flex;align-items:center;gap:14px;padding:18px}
.mono{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;font-size:24px;flex:none;
 background:radial-gradient(circle at 30% 25%,rgba(255,215,106,.22),rgba(245,179,1,.06));border:1px solid var(--line2);box-shadow:inset 0 0 14px rgba(245,179,1,.12)}
.tile b{display:block;font-size:15px;line-height:1.3}
.tile small{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}
/* steps */
.steps{display:grid;gap:18px;grid-template-columns:repeat(3,1fr);counter-reset:s}
.step{padding:30px 26px}
.step .n{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;margin-bottom:20px;color:var(--gold2);
 background:rgba(245,179,1,.08);border:1px solid var(--line2);box-shadow:inset 0 0 18px rgba(245,179,1,.12)}
.step .num{position:absolute;top:18px;inset-inline-end:22px;font-size:46px;font-weight:800;line-height:1;color:rgba(255,215,106,.08)}
.step h3{font-size:20px;margin-bottom:8px}
.step p{color:var(--muted);font-size:15px}
/* products */
.tabs{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:28px}
.tab{padding:9px 16px;border-radius:999px;border:1px solid var(--line);color:var(--muted);font-weight:600;font-size:14px;background:var(--card);transition:.2s}
.tab:hover{color:var(--text);border-color:var(--line2)}
.tab[aria-pressed=true]{color:#1a1200;background:linear-gradient(135deg,var(--gold2),var(--gold));border-color:transparent}
.products{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.prod{display:flex;flex-direction:column;gap:14px;padding:20px}
.prod[hidden]{display:none}
.prod .top{display:flex;gap:13px;align-items:center}
.prod .pic{width:50px;height:50px;border-radius:14px;object-fit:cover;flex:none;background:#111;border:1px solid var(--line)}
.prod .em{width:50px;height:50px;border-radius:14px;display:grid;place-items:center;font-size:25px;flex:none;background:rgba(245,179,1,.08);border:1px solid var(--line)}
.prod h3{font-size:16px;line-height:1.35;font-weight:700;word-break:break-word}
.prod .meta{color:var(--muted);font-size:13px;margin-top:2px}
.prod .row{display:flex;align-items:baseline;gap:9px;margin-top:auto;flex-wrap:wrap}
.prod .row b{font-size:24px;font-weight:800;color:var(--gold2)}
.prod .row s{color:var(--muted);font-size:14px}
.badge{margin-inline-start:auto;align-self:center;font-size:11px;font-weight:800;padding:4px 9px;border-radius:999px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
body[dir=rtl] .badge{letter-spacing:0}
.badge.sale{background:rgba(245,179,1,.14);color:var(--gold2);border:1px solid var(--line2)}
.badge.out{background:rgba(220,60,60,.14);color:#ff9a9a;border:1px solid rgba(220,60,60,.35)}
.prod.soldout{opacity:.6}
.prod.soldout .btn{filter:grayscale(.7)}
.more{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:10px;padding:24px;border-style:dashed}
.more p{color:var(--muted);font-size:14px}
/* payments */
.pays{display:flex;flex-wrap:wrap;gap:14px;justify-content:center}
.pay{display:flex;align-items:center;gap:12px;padding:16px 22px;font-weight:700}
.pay .dot{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:13px;font-weight:800;flex:none}
.pay .bn{background:#f0b90b;color:#1a1200}
.pay .us{background:#26a17b;color:#fff}
.pay .sc{background:linear-gradient(135deg,#1e6bd6,#0b3d91);color:#fff}
.pay .wl{background:rgba(245,179,1,.12);color:var(--gold2);border:1px solid var(--line2)}
.pay small{display:block;color:var(--muted);font-weight:500;font-size:12px}
/* features */
.feats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
.feat{padding:26px}
.feat .ic{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;font-size:26px;margin-bottom:16px;background:rgba(245,179,1,.08);border:1px solid var(--line2)}
.feat h3{font-size:18px;margin-bottom:6px}
.feat p{color:var(--muted);font-size:15px}
/* faq */
.faq{max-width:820px;margin:0 auto;display:grid;gap:12px}
details{background:var(--card);border:1px solid var(--line);border-radius:16px;transition:border-color .2s,background .2s}
details[open]{border-color:var(--line2);background:var(--card2)}
summary{cursor:pointer;font-weight:700;list-style:none;padding:18px 20px;display:flex;justify-content:space-between;gap:16px;align-items:center}
summary::-webkit-details-marker{display:none}
summary:after{content:"";width:10px;height:10px;flex:none;border-inline-end:2px solid var(--gold);border-bottom:2px solid var(--gold);transform:rotate(45deg);transition:transform .25s;margin-top:-4px}
details[open] summary:after{transform:rotate(225deg);margin-top:4px}
details p{color:var(--muted);padding:0 20px 18px;white-space:pre-line}
/* final cta */
.final{position:relative;overflow:hidden;text-align:center;padding:64px 24px;border-radius:28px;border:1px solid var(--line2);
 background:radial-gradient(60% 120% at 50% 0%,rgba(245,179,1,.22),transparent 70%),linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01))}
.final h2{font-size:clamp(28px,4.4vw,46px);font-weight:800;line-height:1.15}
.final p{color:var(--muted);margin:12px auto 28px;max-width:520px}
.final .cta{justify-content:center}
/* footer */
footer{border-top:1px solid var(--line);padding:40px 0 48px;color:var(--muted);font-size:14px}
footer .wrap{display:grid;grid-template-columns:1.2fr 1fr;gap:28px;align-items:start}
footer .brand{color:var(--text);margin-bottom:10px}
footer .fl{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}
footer .fl a{padding:8px 14px;border-radius:10px;border:1px solid var(--line);transition:.2s}
footer .fl a:hover{color:var(--text);border-color:var(--gold)}
footer .copy{grid-column:1/-1;border-top:1px solid rgba(255,215,106,.08);padding-top:18px;font-size:13px}
/* floating telegram button */
.fab{position:fixed;bottom:18px;inset-inline-end:16px;z-index:30;width:58px;height:58px;border-radius:50%;display:none;place-items:center;color:#1a1200;
 background:linear-gradient(135deg,var(--gold2),var(--gold));box-shadow:0 12px 30px rgba(245,179,1,.4);opacity:0;transform:scale(.6);pointer-events:none;transition:opacity .25s,transform .25s}
.fab.show{opacity:1;transform:none;pointer-events:auto}
.fab:after{content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(245,179,1,.45);animation:pulse 2.4s ease-out infinite}
@keyframes pulse{from{transform:scale(.9);opacity:1}to{transform:scale(1.35);opacity:0}}
/* reveal */
.js .reveal{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s ease;transition-delay:var(--d,0s)}
.js .reveal.in{opacity:1;transform:none}
/* responsive */
@media (max-width:980px){
 .hero .wrap{grid-template-columns:1fr;gap:34px;text-align:center}
 .hero .sub{margin-inline:auto}.cta,.trust,.stats{justify-content:center}
 .visual{width:min(100%,360px);order:-1}
 .tiles{grid-template-columns:repeat(2,1fr)}
 .steps{grid-template-columns:1fr}
 .feats{grid-template-columns:repeat(2,1fr)}
}
@media (max-width:720px){
 .links a.l{display:none}
 nav .btn.sm{display:none}
 .hero{padding:36px 0 40px}
 .visual{width:min(100%,300px)}
 .chip{font-size:12px;padding:8px 11px}
 .chip.c1{inset-inline-start:0}.chip.c2{inset-inline-end:-2%}.chip.c3{display:none}
 section{padding:64px 0}
 .head{margin-bottom:28px}
 .cta .btn{flex:1 1 100%}
 .tiles{grid-template-columns:1fr 1fr;gap:10px}.tile{padding:14px 12px;gap:10px}.mono{width:40px;height:40px;font-size:20px}.tile b{font-size:14px}
 .feats{grid-template-columns:1fr}
 .pay{flex:1 1 100%}
 footer .wrap{grid-template-columns:1fr}footer .fl{justify-content:flex-start}
 .fab{display:grid}
 .final{padding:48px 18px}
}
@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}.js .reveal{opacity:1;transform:none}html{scroll-behavior:auto}}
`;
}

// content is only hidden for the reveal animation once this runs (no-JS visitors see everything)
const JS_HEAD = `document.documentElement.classList.add('js')`;

// reveal-on-scroll (with a safety timer) + category tabs
const JS = `(()=>{const r=matchMedia('(prefers-reduced-motion: reduce)').matches;const els=document.querySelectorAll('.reveal');const all=()=>els.forEach(e=>e.classList.add('in'));
if(r||!('IntersectionObserver' in window)){all()}else{const o=new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting){x.target.classList.add('in');o.unobserve(x.target)}}),{threshold:.08,rootMargin:'0px 0px -30px 0px'});els.forEach(e=>o.observe(e));setTimeout(all,2500)}
const tabs=document.querySelectorAll('.tab');tabs.forEach(t=>t.addEventListener('click',()=>{const f=t.dataset.f;tabs.forEach(x=>x.setAttribute('aria-pressed',String(x===t)));
document.querySelectorAll('.prod').forEach(p=>{p.hidden=!(f==='all'||p.dataset.c===f);if(!p.hidden)p.classList.add('in')})}));
const fab=document.querySelector('.fab'),hero=document.querySelector('.hero');if(fab&&hero){const t=()=>fab.classList.toggle('show',scrollY>hero.offsetTop+hero.offsetHeight-120);addEventListener('scroll',t,{passive:true});t()}})();`;

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

interface PayBadge { cls: string; mark: string; name: string; note: string }

function paymentBadges(s: AppSettings, ui: Record<string, string>): PayBadge[] {
  const p = s.payments;
  const all: (PayBadge & { on: boolean })[] = [
    { on: p.binance_pay.enabled || p.binance_id.enabled, cls: 'bn', mark: 'B', name: 'Binance', note: 'Binance Pay' },
    { on: p.nowpayments.enabled, cls: 'us', mark: '₮', name: 'USDT', note: 'BEP20' },
    { on: p.shamcash.enabled, cls: 'sc', mark: 'SC', name: 'ShamCash', note: p.shamcash.currency === 'SYP' ? 'SYP' : 'USD' },
  ];
  // until the owner enables methods, show the supported ones
  const list = all.some((m) => m.on) ? all.filter((m) => m.on) : all;
  return [...list, { cls: 'wl', mark: '$', name: ui.pay_wallet, note: 'USD' }];
}

function Page(props: { s: AppSettings; lang: Lang; groups: Group[]; origin: string }) {
  const { s, lang, groups, origin } = props;
  const L = s.landing;
  const ui = UI[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title = (lang === 'ar' ? L.title_ar : L.title_en) || L.title_en;
  const subtitle = (lang === 'ar' ? L.subtitle_ar : L.subtitle_en) || L.subtitle_en;
  const cta = (lang === 'ar' ? L.cta_ar : L.cta_en) || L.cta_en;
  const tagline = (lang === 'ar' ? s.brand.tagline_ar : s.brand.tagline_en) || s.brand.tagline_en;
  const footer = (lang === 'ar' ? L.footer_ar : L.footer_en) || '';
  const logo = safeUrl(s.brand.logo_url) || '/assets/logo.jpg';
  const heroImg = safeUrl(L.hero_image_url);
  const channel = safeUrl(s.brand.channel_url);
  const group = safeUrl(s.brand.group_url);
  const website = safeUrl(s.brand.website_url);
  const logoAbs = logo.startsWith('http') ? logo : `${origin}${logo}`;
  const bot = botLink(s);
  const support = s.brand.support_username ? `https://t.me/${s.brand.support_username.replace(/^@/, '')}` : '';
  const home = lang === 'ar' ? '/ar' : '/';
  const otherLangHref = lang === 'ar' ? '/' : '/ar';
  const pageTitle = `${s.brand.name} — ${tagline}`;
  const description = L.seo_description || subtitle;

  const items = groups.flatMap((g) => g.items);
  const hasProducts = items.length > 0;
  const multiCat = groups.length > 1;
  const groupKey = (g: Group) => g.category?.id ?? 'other';

  // marquee: category names, then product names, else the built-in list
  const marquee: string[] = [];
  for (const g of groups) if (g.category) marquee.push(`${g.category.emoji ? `${g.category.emoji} ` : ''}${loc(g.category, 'name', lang)}`);
  for (const v of items) if (marquee.length < 18) marquee.push(loc(v.product, 'name', lang));
  const marqueeList = (marquee.length >= 6 ? marquee : FALLBACK_SERVICES).slice(0, 18);

  const pays = paymentBadges(s, ui);
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

  return (
    <html lang={lang} dir={dir}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{pageTitle}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#050507" />
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
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: JS_HEAD }} />
        <style dangerouslySetInnerHTML={{ __html: css(L.accent_color || '#F5B301') }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      </head>
      <body dir={dir}>
        <div class="bg" aria-hidden="true"><div class="glow" /><div class="grid" /><div class="noise" /></div>

        <nav>
          <div class="wrap">
            <a class="brand" href={home}>
              <img src={logo} alt="" width="40" height="40" />
              <span>{s.brand.name}</span>
            </a>
            <div class="links">
              <a class="l" href={hasProducts ? '#products' : '#offer'}>{ui.nav_products}</a>
              <a class="l" href="#how">{ui.nav_how}</a>
              {L.faq.length > 0 && <a class="l" href="#faq">{ui.nav_faq}</a>}
              <a class="lang" href={otherLangHref} hreflang={lang === 'ar' ? 'en' : 'ar'}>{ui.switch}</a>
              <a class="btn sm" href={bot}><TgIcon size={16} />{cta}</a>
            </div>
          </div>
        </nav>

        <main>
          <header class="hero">
            <div class="wrap">
              <div>
                <span class="kicker">{tagline}</span>
                <h1><span class="gold">{title}</span></h1>
                <p class="sub">{subtitle}</p>
                <div class="cta">
                  <a class="btn" href={bot}><TgIcon size={20} />{cta}</a>
                  <a class="btn ghost" href={hasProducts ? '#products' : '#offer'}>
                    {hasProducts ? ui.see_products : ui.see_offer}<Icon name="arrow" size={18} />
                  </a>
                </div>
                <div class="trust">
                  <span><Icon name="bolt" size={17} />{ui.trust_instant}</span>
                  <span><Icon name="shield" size={17} />{ui.trust_warranty}</span>
                  <span><Icon name="lock" size={17} />{ui.trust_secure}</span>
                  <span><Icon name="headset" size={17} />{ui.trust_support}</span>
                </div>
                {hasProducts && (
                  <div class="stats">
                    <div><b class="gold">{items.length}+</b><small>{ui.stat_products}</small></div>
                    {groups.length > 1 && <div><b class="gold">{groups.length}</b><small>{ui.stat_categories}</small></div>}
                    <div><b class="gold">24/7</b><small>{ui.stat_delivery}</small></div>
                  </div>
                )}
              </div>
              <div class="visual" aria-hidden="true">
                <div class="halo" />
                <div class="ring" />
                <div class="ring2" />
                <div class="logo"><img src={heroImg || logo} alt="" width="220" height="220" /></div>
                <div class="chip c1"><Icon name="bolt" size={16} />{ui.chip_delivery}</div>
                <div class="chip c2"><Icon name="shield" size={16} />{ui.chip_warranty}</div>
                <div class="chip c3"><Icon name="wallet" size={16} />{ui.chip_wallet}</div>
              </div>
            </div>
          </header>

          <div class="marquee" aria-label={ui.offer_title}>
            <div class="track">
              {[...marqueeList, ...marqueeList].map((m, i) => (
                <span aria-hidden={i >= marqueeList.length ? 'true' : undefined}><i />{m}</span>
              ))}
            </div>
          </div>

          {!hasProducts && (
            <section id="offer">
              <div class="wrap">
                <div class="head reveal">
                  <span class="kicker">{ui.offer_kicker}</span>
                  <h2>{ui.offer_title}</h2>
                  <p>{ui.offer_text}</p>
                </div>
                <div class="tiles">
                  {FALLBACK_TILES.map((t, i) => (
                    <a class="card tile reveal" href={bot} style={`--d:${(i % 4) * 0.05}s`}>
                      <span class="mono">{t.icon}</span>
                      <span><b>{t.name}</b><small>{ui[`kind_${t.kind}`]}</small></span>
                    </a>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section id="how">
            <div class="wrap">
              <div class="head reveal">
                <span class="kicker">{ui.how_kicker}</span>
                <h2>{ui.how_title}</h2>
              </div>
              <div class="steps">
                {([['grid', ui.step1_t, ui.step1_d], ['wallet', ui.step2_t, ui.step2_d], ['gift', ui.step3_t, ui.step3_d]] as const).map(([icon, t, d], i) => (
                  <div class="card step reveal" style={`--d:${i * 0.08}s`}>
                    <span class="num">0{i + 1}</span>
                    <div class="n"><Icon name={icon} size={24} /></div>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {hasProducts && (
            <section id="products">
              <div class="wrap">
                <div class="head reveal">
                  <span class="kicker">{ui.products_kicker}</span>
                  <h2>{ui.products_title}</h2>
                </div>
                {multiCat && (
                  <div class="tabs reveal" role="group" aria-label={ui.products_title}>
                    <button type="button" class="tab" data-f="all" aria-pressed="true">{ui.all}</button>
                    {groups.map((g) => (
                      <button type="button" class="tab" data-f={groupKey(g)} aria-pressed="false">
                        {g.category?.emoji ? `${g.category.emoji} ` : ''}{g.category ? loc(g.category, 'name', lang) : ui.other}
                      </button>
                    ))}
                  </div>
                )}
                <div class="products">
                  {groups.flatMap((g) =>
                    g.items.map((v, i) => {
                      const p = v.product;
                      const name = loc(p, 'name', lang);
                      const duration = loc(p, 'duration', lang);
                      const img = safeUrl(p.image_url);
                      const showOrig = v.pricing.originalUnitPrice != null && v.pricing.unitPrice != null && v.pricing.originalUnitPrice > v.pricing.unitPrice + 0.001;
                      const meta = [duration, p.warranty_days > 0 ? `${p.warranty_days}${ui.days}` : ''].filter(Boolean).join(' · ');
                      return (
                        <article class={`card prod reveal${v.pricing.soldOut ? ' soldout' : ''}`} data-c={groupKey(g)} style={`--d:${(i % 4) * 0.05}s`}>
                          <div class="top">
                            {img ? <img class="pic" src={img} alt="" loading="lazy" width="50" height="50" /> : <div class="em">{p.emoji || g.category?.emoji || '✦'}</div>}
                            <div>
                              <h3>{name}</h3>
                              {meta && <div class="meta">{meta}</div>}
                            </div>
                          </div>
                          <div class="row">
                            <b>{fmtUsd(v.pricing.unitPrice)}</b>
                            {showOrig && <s>{fmtUsd(v.pricing.originalUnitPrice)}</s>}
                            {v.pricing.soldOut ? <span class="badge out">{ui.sold_out}</span> : showOrig ? <span class="badge sale">{ui.sale}</span> : null}
                          </div>
                          <a class={`btn sm block${v.pricing.soldOut ? ' ghost' : ''}`} href={botLink(s, `p_${p.id}`)}><TgIcon size={16} />{ui.buy}</a>
                        </article>
                      );
                    }),
                  )}
                  <div class="card more reveal">
                    <span class="kicker">{s.brand.name}</span>
                    <b>{ui.more_in_bot}</b>
                    <p>{ui.more_in_bot_text}</p>
                    <a class="btn sm" href={bot}><TgIcon size={16} />{ui.open_bot}</a>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section id="payments" style="padding-top:0">
            <div class="wrap">
              <div class="head reveal">
                <span class="kicker">{ui.pay_kicker}</span>
                <h2>{ui.pay_title}</h2>
              </div>
              <div class="pays">
                {pays.map((m, i) => (
                  <div class="card pay reveal" style={`--d:${i * 0.05}s`}>
                    <span class={`dot ${m.cls}`}>{m.mark}</span>
                    <div>{m.name}<small>{m.note}</small></div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {L.features.length > 0 && (
            <section id="features" style="padding-top:0">
              <div class="wrap">
                <div class="head reveal">
                  <span class="kicker">{ui.features_kicker}</span>
                  <h2>{ui.features_title}</h2>
                </div>
                <div class="feats">
                  {L.features.map((f, i) => (
                    <div class="card feat reveal" style={`--d:${(i % 4) * 0.06}s`}>
                      <div class="ic">{f.icon}</div>
                      <h3>{(lang === 'ar' ? f.title_ar : f.title_en) || f.title_en}</h3>
                      <p>{(lang === 'ar' ? f.text_ar : f.text_en) || f.text_en}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {L.faq.length > 0 && (
            <section id="faq" style="padding-top:0">
              <div class="wrap">
                <div class="head reveal">
                  <span class="kicker">{ui.faq_kicker}</span>
                  <h2>{ui.faq_title}</h2>
                </div>
                <div class="faq">
                  {L.faq.map((f, i) => (
                    <details class="reveal" open={i === 0}>
                      <summary>{(lang === 'ar' ? f.q_ar : f.q_en) || f.q_en}</summary>
                      <p>{(lang === 'ar' ? f.a_ar : f.a_en) || f.a_en}</p>
                    </details>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section style="padding-top:0">
            <div class="wrap">
              <div class="final reveal">
                <h2><span class="gold">{ui.ready}</span></h2>
                <p>{ui.ready_text}</p>
                <div class="cta">
                  <a class="btn" href={bot}><TgIcon size={20} />{cta}</a>
                  {channel && <a class="btn ghost" href={channel}>{ui.channel}</a>}
                </div>
              </div>
            </div>
          </section>
        </main>

        <footer>
          <div class="wrap">
            <div>
              <a class="brand" href={home}>
                <img src={logo} alt="" width="40" height="40" />
                <span>{s.brand.name}</span>
              </a>
              <div>{tagline}</div>
              {footer && <div style="margin-top:6px">{footer}</div>}
            </div>
            <div class="fl">
              {channel && <a href={channel}>{ui.channel}</a>}
              {group && <a href={group}>{ui.group}</a>}
              {support && <a href={support}>{ui.support}</a>}
              {website && <a href={website}>Web</a>}
              <a href={bot}>Telegram</a>
              <a href={otherLangHref} hreflang={lang === 'ar' ? 'en' : 'ar'}>{ui.switch}</a>
            </div>
            <div class="copy">© {new Date().getFullYear()} {s.brand.name}. {ui.rights}</div>
          </div>
        </footer>

        <a class="fab" href={bot} aria-label={cta}><TgIcon size={26} /></a>
        <script dangerouslySetInnerHTML={{ __html: JS }} />
      </body>
    </html>
  );
}

async function render(c: Context<HonoEnv>, forced?: Lang) {
  const s = await getSettings(c.env);
  if (!s.landing.enabled) return c.redirect(botLink(s) === '#' ? '/admin/' : botLink(s), 302);
  const lang = langOf(c, forced);
  const groups = await loadShowcase(c.env, s);
  const origin = baseUrl(s, c.req.raw);
  const body = await (<Page s={s} lang={lang} groups={groups} origin={origin} />).toString();
  return c.html(`<!doctype html>${body}`, 200, { 'Cache-Control': CACHE });
}

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
