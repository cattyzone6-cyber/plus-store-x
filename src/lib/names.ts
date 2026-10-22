// Reads provider product names like "Capcut pro 1M 1600 Ai credit FW" to find:
//  - the PRODUCT they belong to ("CapCut Pro"), so packs of the same product group together
//  - the duration (30 days) and warranty (full / none / N days) when the provider gives none
// The pack itself keeps its full name for customers (Telegram buttons have no room for a
// product → pack hierarchy in the text); this only drives grouping and suggestions.

/** Brand spellings. The owner can add or override words in Settings → Catalog. */
export const BRAND_WORDS: Record<string, string> = {
  chatgpt: 'ChatGPT', gpt: 'GPT', openai: 'OpenAI', capcut: 'CapCut', elevenlabs: 'ElevenLabs', youtube: 'YouTube',
  tiktok: 'TikTok', icloud: 'iCloud', ios: 'iOS', ai: 'AI', api: 'API', vpn: 'VPN', nordvpn: 'NordVPN', expressvpn: 'ExpressVPN',
  hma: 'HMA', n8n: 'n8n', veo: 'VEO', svip: 'SVIP', vip: 'VIP', edu: 'EDU', linkedin: 'LinkedIn', openart: 'OpenArt',
  deepseek: 'DeepSeek', github: 'GitHub', copilot: 'Copilot', posthog: 'PostHog', autocad: 'AutoCAD', ilovepdf: 'iLovePDF',
  playstation: 'PlayStation', psn: 'PSN', hbo: 'HBO', max: 'Max', x: 'X', '3ds': '3ds', gmail: 'Gmail', pdf: 'PDF',
  // short common words that providers write in capitals
  pro: 'Pro', go: 'Go', plus: 'Plus', one: 'One', box: 'Box', top: 'Top', app: 'App', web: 'Web', ultra: 'Ultra',
};

const UNIT_DAYS: Record<string, number> = {
  h: 1 / 24, hr: 1 / 24, hrs: 1 / 24, hour: 1 / 24, hours: 1 / 24,
  d: 1, day: 1, days: 1, w: 7, wk: 7, week: 7, weeks: 7,
  m: 30, mo: 30, mon: 30, month: 30, months: 30,
  y: 365, yr: 365, yrs: 365, year: 365, years: 365,
};
const UNIT_RE = 'h|hrs?|hours?|d|days?|w|wk|weeks?|m|mo|mon|months?|y|yrs?|years?';

/** Words that end the product name (plan / delivery details follow them). */
const STOP_WORDS = new Set([
  'for', 'with', 'via', 'has', 'have', 'does', 'without', 'and', '+', 'account', 'accounts', 'key', 'keys', 'code', 'codes',
  'link', 'invite', 'invitation', 'subscription', 'sub', 'slot', 'slots', 'redeem', 'personal', 'individual', 'team',
  'family', 'fam', 'shared', 'private', 'ready', 'upgrade', 'full', 'no', 'warranty', 'fw', 'nw', 'pw', 'lifetime',
  'random', 'official', 'original', 'new', 'trial', 'seat', 'seats', 'member', 'members', 'profile', 'profiles',
  'credit', 'credits', 'token', 'tokens', 'activation', 'login', 'email',
]);
/** Words dropped from the start ("Redeem Notion Business", "Slot Notion Business…"). */
const LEADING_NOISE = new Set(['redeem', 'slot', 'official', 'buy', 'new', 'admin', 'full', 'fam']);

function isWarrantyToken(t: string): boolean {
  return /^(fw|nw|pw|w\d+d|\d+dw|warranty)$/i.test(t);
}

function isDurationToken(t: string): boolean {
  return new RegExp(`^\\d+(\\.\\d+)?-?(${UNIT_RE})$`, 'i').test(t);
}

function isUnitWord(t: string | undefined): boolean {
  return !!t && new RegExp(`^(${UNIT_RE})[,.]?$`, 'i').test(t);
}

function casing(word: string, words: Record<string, string>): string {
  const key = word.toLowerCase();
  if (words[key]) return words[key];
  if (BRAND_WORDS[key]) return BRAND_WORDS[key];
  if (/^\d/.test(word)) return word;
  if (word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word; // GPT, VEO
  if (word === word.toUpperCase() || word === word.toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  return word.charAt(0).toUpperCase() + word.slice(1); // keep inner casing (OpenArt)
}

export interface CleanName {
  /** product the pack belongs to, nicely written ("CapCut Pro") */
  product: string;
  /** lowercase key used to group packs of the same product */
  key: string;
  /** duration in days when the name says it (1M → 30, 1Y → 365), else null */
  durationDays: number | null;
  /** 'full' | 'none' | number of days | null when the name says nothing */
  warranty: 'full' | 'none' | number | null;
}

/** Parse a provider name. `words` = owner word list (lowercase → spelling). */
export function cleanProviderName(raw: string, words: Record<string, string> = {}): CleanName {
  const name = raw.replace(/�/g, ' - ').replace(/[—–|]/g, ' - ').replace(/\s+/g, ' ').trim();

  // ── product: first segment, without brackets, until the first marker ──
  let segments = name.split(/\s+-\s+|,\s*/).map((s) => s.trim()).filter(Boolean);
  // "Zoom - Zoom Pro 1M" → use the more specific second segment
  if (segments.length > 1 && segments[1].toLowerCase().startsWith(segments[0].toLowerCase())) segments = segments.slice(1);
  const head = (segments[0] ?? name).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\([^)]*$/, ' ');
  const tokens = head.split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}$+]+|[^\p{L}\p{N}$+]+$/gu, '')).filter(Boolean);
  while (tokens.length > 1 && LEADING_NOISE.has(tokens[0].toLowerCase())) tokens.shift();

  const kept: string[] = [];
  for (let i = 0; i < tokens.length && kept.length < 4; i++) {
    const t = tokens[i];
    const lower = t.toLowerCase();
    if (kept.length && (STOP_WORDS.has(lower) || isWarrantyToken(t) || isDurationToken(t))) break;
    if (/^[x×]\d+$/i.test(t) || /^\$/.test(t) || /\$$/.test(t)) break; // x200, $500, 100$
    if (/^\d/.test(t)) {
      // "Microsoft 365", "VEO 4" stay; "Gemini 18 Months", "Supercut Pro 10 Seat", "Higgsfield 80cre" stop
      const number = /^\d+$/.test(t);
      if (!(kept.length === 1 && number && !isUnitWord(tokens[i + 1]))) break;
    }
    kept.push(t);
  }
  if (!kept.length && tokens.length) kept.push(tokens[0]);
  const product = kept.map((w) => casing(w, words)).join(' ').trim() || raw.trim();

  return { product, key: product.toLowerCase(), durationDays: parseDurationDays(name), warranty: parseWarranty(name) };
}

interface Span { days: number; start: number; end: number; warranty: boolean }

/**
 * Every "<number><unit>" in the name, classified as product duration or warranty:
 *  - "warranty 5 days", "(warranty 3 days)", "W25D", "1DW"          → warranty
 *  - "3-day warranty" (and "warranty" is not itself followed by a number) → warranty
 *  - anything else → duration ("1 month warranty 5 days": 1 month = duration, 5 days = warranty)
 */
function durationSpans(name: string): Span[] {
  const s = name.toLowerCase();
  const out: Span[] = [];
  for (const m of s.matchAll(/\bw(\d+)d\b|\b(\d+)dw\b/g)) {
    out.push({ days: Number(m[1] ?? m[2]), start: m.index!, end: m.index! + m[0].length, warranty: true });
  }
  const re = new RegExp(String.raw`(?:^|[^\w$])(\d+(?:\.\d+)?)\s*-?\s*(${UNIT_RE})\b`, 'g');
  for (const m of s.matchAll(re)) {
    const start = m.index! + m[0].indexOf(m[1]);
    const end = m.index! + m[0].length;
    if (out.some((o) => start >= o.start && start < o.end)) continue;
    const unit = UNIT_DAYS[m[2]];
    const n = Number(m[1]);
    if (!unit || !isFinite(n)) continue;
    const days = unit === 30 && n === 12 ? 365 : Math.max(1, Math.round(n * unit));
    const before = s.slice(Math.max(0, start - 12), start);
    const after = s.slice(end, end + 22);
    const warrantyBefore = /warranty\s*\(?\s*$/.test(before);
    const warrantyAfter = /^\.?\s*warranty\b/.test(after) && !/^\.?\s*warranty\s*\(?\s*\d/.test(after);
    out.push({ days, start, end, warranty: warrantyBefore || warrantyAfter });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** "1M" → 30, "6-month" → 180, "1 Year" → 365, "12m" → 365, "lifetime" → 0 (no expiry). */
export function parseDurationDays(name: string): number | null {
  if (/\blifetime\b/i.test(name)) return 0;
  return durationSpans(name).find((sp) => !sp.warranty)?.days ?? null;
}

/** "FW" / "full warranty" → 'full'; "NW" / "no warranty" → 'none'; "W25D" / "3-day warranty" → days. */
export function parseWarranty(name: string): 'full' | 'none' | number | null {
  const s = name.toLowerCase();
  if (/\b(nw|no warranty|without warranty|does not have warranty|non[- ]?warranty)\b/.test(s)) return 'none';
  const span = durationSpans(name).find((sp) => sp.warranty);
  if (span) return span.days;
  if (/\b(fw|full warranty|full[- ]warranty|warranty full)\b/.test(s)) return 'full';
  return null;
}

/** Human duration text for a pack ("1 month", "12 months", "30 days", "Lifetime"). */
export function durationText(days: number | null, lang: 'en' | 'ar'): string | null {
  if (days == null) return null;
  if (days === 0) return lang === 'ar' ? 'مدى الحياة' : 'Lifetime';
  if (days % 365 === 0) { const n = days / 365; return lang === 'ar' ? `${n} ${n === 1 ? 'سنة' : 'سنوات'}` : `${n} year${n === 1 ? '' : 's'}`; }
  if (days === 360) return lang === 'ar' ? '12 شهر' : '12 months';
  if (days % 30 === 0) { const n = days / 30; return lang === 'ar' ? `${n} ${n === 1 ? 'شهر' : 'أشهر'}` : `${n} month${n === 1 ? '' : 's'}`; }
  return lang === 'ar' ? `${days} يوم` : `${days} day${days === 1 ? '' : 's'}`;
}
