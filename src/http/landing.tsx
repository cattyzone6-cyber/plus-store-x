import { Hono } from 'hono';
import type { Context } from 'hono';
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

interface Group {
  category: CategoryRow | null;
  items: ProductView[];
}

async function loadShowcase(env: Env, s: AppSettings): Promise<Group[]> {
  if (!s.landing.show_products) return [];
  try {
    let views = await listAllProducts(env, s, null, { featuredOnly: true });
    if (!views.length) views = (await listAllProducts(env, s, null)).slice(0, 12);
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
    products: 'Popular products',
    features: 'Why us',
    faq: 'FAQ',
    buy: 'Buy in Telegram',
    sold_out: 'Sold out',
    other: 'More',
    join_channel: 'Channel',
    join_group: 'Community',
    support: 'Support',
    switch: 'العربية',
    ready: 'Ready to start?',
    ready_text: 'Open the bot, top up your wallet and get your product in seconds.',
    rights: 'All rights reserved.',
  },
  ar: {
    products: 'المنتجات الأكثر طلباً',
    features: 'لماذا نحن',
    faq: 'الأسئلة الشائعة',
    buy: 'اشترِ عبر تيليجرام',
    sold_out: 'نفدت الكمية',
    other: 'المزيد',
    join_channel: 'القناة',
    join_group: 'المجتمع',
    support: 'الدعم',
    switch: 'English',
    ready: 'جاهز للبدء؟',
    ready_text: 'افتح البوت، اشحن محفظتك واحصل على منتجك خلال ثوانٍ.',
    rights: 'جميع الحقوق محفوظة.',
  },
};

function css(accentRaw: string): string {
  // only a plain hex color may reach the stylesheet
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(accentRaw) ? accentRaw : '#F5B301';
  return `
:root{--gold:${accent};--gold2:#ffd76a;--bg:#07070a;--card:rgba(255,255,255,.04);--line:rgba(255,215,106,.18);--text:#f4f1e8;--muted:#a9a397}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:Inter,Cairo,system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55;overflow-x:hidden}
body[dir=rtl]{font-family:Cairo,Inter,system-ui,sans-serif}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
.glow{position:fixed;inset:-20vmax;z-index:-1;pointer-events:none;background:
 radial-gradient(40vmax 40vmax at 20% 10%,rgba(245,179,1,.16),transparent 60%),
 radial-gradient(35vmax 35vmax at 85% 30%,rgba(255,215,106,.10),transparent 60%),
 radial-gradient(45vmax 45vmax at 50% 100%,rgba(245,179,1,.08),transparent 60%);
 animation:drift 18s ease-in-out infinite alternate}
@keyframes drift{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(2vmax,-2vmax,0) scale(1.08)}}
nav{position:sticky;top:0;z-index:10;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);background:rgba(7,7,10,.65);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;height:64px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.2px;min-width:0}
.brand img{width:38px;height:38px;border-radius:10px;object-fit:cover;box-shadow:0 0 0 1px var(--line)}
.brand span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.navlinks{display:flex;gap:8px;align-items:center}
.pill{border:1px solid var(--line);padding:7px 12px;border-radius:999px;font-size:14px;color:var(--muted);transition:.2s}
.pill:hover{color:var(--text);border-color:var(--gold)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:14px 26px;border-radius:14px;font-weight:700;
 background:linear-gradient(135deg,var(--gold),var(--gold2));color:#1a1300;box-shadow:0 10px 30px rgba(245,179,1,.25);transition:transform .15s,box-shadow .2s}
.btn:hover{transform:translateY(-2px);box-shadow:0 14px 40px rgba(245,179,1,.35)}
.btn.sm{padding:9px 16px;border-radius:11px;font-size:14px}
.btn.ghost{background:transparent;color:var(--gold);border:1px solid var(--line);box-shadow:none}
header.hero{padding:72px 0 48px;text-align:center}
.hero .logo{width:132px;height:132px;margin:0 auto 26px;border-radius:30px;object-fit:cover;box-shadow:0 0 0 1px var(--line),0 0 60px rgba(245,179,1,.25);animation:float 6s ease-in-out infinite}
@keyframes float{50%{transform:translateY(-8px)}}
.hero h1{font-size:clamp(30px,6vw,56px);line-height:1.12;font-weight:800;max-width:860px;margin:0 auto 18px;
 background:linear-gradient(180deg,#fff,#f3dc9a 60%,var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:clamp(16px,2.4vw,20px);color:var(--muted);max-width:680px;margin:0 auto 30px}
.hero .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.hero-img{margin:40px auto 0;max-width:900px;border-radius:22px;border:1px solid var(--line);overflow:hidden}
section{padding:56px 0}
h2{font-size:clamp(24px,4vw,34px);margin-bottom:26px;text-align:center}
h2:after{content:"";display:block;width:64px;height:3px;margin:12px auto 0;border-radius:3px;background:linear-gradient(90deg,transparent,var(--gold),transparent)}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:transform .2s,border-color .2s}
.card:hover{transform:translateY(-3px);border-color:rgba(255,215,106,.45)}
.feat .ic{font-size:30px;margin-bottom:10px}
.feat h3{font-size:18px;margin-bottom:6px}
.feat p{color:var(--muted);font-size:15px}
.cat{margin-bottom:34px}
.cat h3{font-size:20px;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.prod{display:flex;flex-direction:column;gap:10px}
.prod .top{display:flex;gap:12px;align-items:center}
.prod img{width:46px;height:46px;border-radius:12px;object-fit:cover;flex:none;background:#111}
.prod .em{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-size:24px;background:rgba(245,179,1,.08);flex:none}
.prod h4{font-size:16px;line-height:1.3;word-break:break-word}
.prod .meta{color:var(--muted);font-size:13px}
.price{display:flex;align-items:baseline;gap:8px;margin-top:auto}
.price b{font-size:22px;color:var(--gold2)}
.price s{color:var(--muted);font-size:14px}
.soldout{opacity:.55}
.tag{font-size:12px;padding:3px 8px;border-radius:999px;background:rgba(220,60,60,.15);color:#ff8f8f;border:1px solid rgba(220,60,60,.3)}
details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:10px}
summary{cursor:pointer;font-weight:700;list-style:none}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";float:right;color:var(--gold)}
body[dir=rtl] summary:after{float:left}
details[open] summary:after{content:"–"}
details p{color:var(--muted);margin-top:10px;white-space:pre-line}
.final{text-align:center;padding:48px 20px;border-radius:24px;border:1px solid var(--line);
 background:linear-gradient(135deg,rgba(245,179,1,.12),rgba(255,255,255,.02))}
.final p{color:var(--muted);margin:8px 0 22px}
footer{border-top:1px solid var(--line);padding:28px 0 40px;color:var(--muted);font-size:14px}
footer .wrap{display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:center}
footer .links{display:flex;gap:14px;flex-wrap:wrap}
.reveal{opacity:0;transform:translateY(14px);transition:opacity .6s ease,transform .6s ease}
.reveal.in{opacity:1;transform:none}
@media (max-width:640px){.navlinks .pill.hide-sm{display:none}header.hero{padding:48px 0 32px}.hero .logo{width:104px;height:104px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.reveal{opacity:1;transform:none}}
`;
}

const JS = `(()=>{const o=new IntersectionObserver(e=>e.forEach(x=>{if(x.isIntersecting){x.target.classList.add('in');o.unobserve(x.target)}}),{threshold:.12});document.querySelectorAll('.reveal').forEach(el=>o.observe(el))})();`;

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
  const channel = safeUrl(s.brand.channel_url);
  const group = safeUrl(s.brand.group_url);
  const heroImg = safeUrl(L.hero_image_url);
  const logoAbs = logo.startsWith('http') ? logo : `${origin}${logo}`;
  const bot = botLink(s);
  const support = s.brand.support_username ? `https://t.me/${s.brand.support_username.replace(/^@/, '')}` : '';
  const otherLangHref = lang === 'ar' ? '/' : '/ar';
  const pageTitle = `${s.brand.name} — ${tagline}`;

  return (
    <html lang={lang} dir={dir}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{pageTitle}</title>
        <meta name="description" content={L.seo_description || subtitle} />
        <meta name="theme-color" content="#07070a" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={L.seo_description || subtitle} />
        <meta property="og:image" content={logoAbs} />
        <meta property="og:url" content={`${origin}${lang === 'ar' ? '/ar' : '/'}`} />
        <meta name="twitter:card" content="summary" />
        <link rel="icon" href={logo} />
        <link rel="apple-touch-icon" href={logo} />
        <link rel="alternate" hreflang="en" href={`${origin}/`} />
        <link rel="alternate" hreflang="ar" href={`${origin}/ar`} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: css(L.accent_color || '#F5B301') }} />
      </head>
      <body dir={dir}>
        <div class="glow" />
        <nav>
          <div class="wrap">
            <a class="brand" href={lang === 'ar' ? '/ar' : '/'}>
              <img src={logo} alt={s.brand.name} width="38" height="38" />
              <span>{s.brand.name}</span>
            </a>
            <div class="navlinks">
              {groups.length > 0 && <a class="pill hide-sm" href="#products">{ui.products}</a>}
              <a class="pill" href={otherLangHref}>{ui.switch}</a>
              <a class="btn sm" href={bot}>{cta}</a>
            </div>
          </div>
        </nav>

        <header class="hero">
          <div class="wrap">
            <img class="logo" src={logo} alt={s.brand.name} width="132" height="132" />
            <h1>{title}</h1>
            <p>{subtitle}</p>
            <div class="cta">
              <a class="btn" href={bot}>✈️ {cta}</a>
              {channel && <a class="btn ghost" href={channel}>📢 {ui.join_channel}</a>}
            </div>
            {heroImg && (
              <div class="hero-img reveal"><img src={heroImg} alt="" loading="lazy" /></div>
            )}
          </div>
        </header>

        {L.features.length > 0 && (
          <section id="features">
            <div class="wrap">
              <h2>{ui.features}</h2>
              <div class="grid">
                {L.features.map((f) => (
                  <div class="card feat reveal">
                    <div class="ic">{f.icon}</div>
                    <h3>{(lang === 'ar' ? f.title_ar : f.title_en) || f.title_en}</h3>
                    <p>{(lang === 'ar' ? f.text_ar : f.text_en) || f.text_en}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {groups.length > 0 && (
          <section id="products">
            <div class="wrap">
              <h2>{ui.products}</h2>
              {groups.map((g) => (
                <div class="cat">
                  <h3>
                    {g.category?.emoji && <span>{g.category.emoji}</span>}
                    {g.category ? pick(g.category as unknown as Record<string, unknown>, 'name', lang) : ui.other}
                  </h3>
                  <div class="grid">
                    {g.items.map((v) => {
                      const p = v.product;
                      const name = pick(p as unknown as Record<string, unknown>, 'name', lang);
                      const duration = pick(p as unknown as Record<string, unknown>, 'duration', lang);
                      const showOrig = v.pricing.originalUnitPrice != null && v.pricing.unitPrice != null && v.pricing.originalUnitPrice > v.pricing.unitPrice + 0.001;
                      return (
                        <div class={`card prod reveal${v.pricing.soldOut ? ' soldout' : ''}`}>
                          <div class="top">
                            {safeUrl(p.image_url) ? <img src={safeUrl(p.image_url)} alt="" loading="lazy" /> : <div class="em">{p.emoji || '📦'}</div>}
                            <div>
                              <h4>{name}</h4>
                              <div class="meta">
                                {duration}
                                {duration && p.warranty_days > 0 ? ' · ' : ''}
                                {p.warranty_days > 0 ? `🛡️ ${p.warranty_days}${lang === 'ar' ? ' يوم' : 'd'}` : ''}
                              </div>
                            </div>
                          </div>
                          <div class="price">
                            <b>{fmtUsd(v.pricing.unitPrice)}</b>
                            {showOrig && <s>{fmtUsd(v.pricing.originalUnitPrice)}</s>}
                            {v.pricing.soldOut && <span class="tag">{ui.sold_out}</span>}
                          </div>
                          <a class="btn sm" href={botLink(s, `p_${p.id}`)}>{ui.buy}</a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {L.faq.length > 0 && (
          <section id="faq">
            <div class="wrap" style="max-width:820px">
              <h2>{ui.faq}</h2>
              {L.faq.map((f) => (
                <details class="reveal">
                  <summary>{(lang === 'ar' ? f.q_ar : f.q_en) || f.q_en}</summary>
                  <p>{(lang === 'ar' ? f.a_ar : f.a_en) || f.a_en}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <section>
          <div class="wrap">
            <div class="final reveal">
              <h2 style="margin-bottom:0">{ui.ready}</h2>
              <p>{ui.ready_text}</p>
              <a class="btn" href={bot}>✈️ {cta}</a>
            </div>
          </div>
        </section>

        <footer>
          <div class="wrap">
            <div>
              © {new Date().getFullYear()} {s.brand.name}. {ui.rights}
              {footer && <div style="margin-top:6px">{footer}</div>}
            </div>
            <div class="links">
              {channel && <a href={channel}>{ui.join_channel}</a>}
              {group && <a href={group}>{ui.join_group}</a>}
              {support && <a href={support}>{ui.support}</a>}
              <a href={bot}>Telegram</a>
            </div>
          </div>
        </footer>
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
