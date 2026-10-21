import { describe, expect, it } from 'vitest';
import { buildMainMenu, cb, chunkLines, discountPercent, loc, MAX_CALLBACK_BYTES, priceHtml, priceText, visibleMenu } from '../src/bot/ui';
import { customEmojis } from '../src/bot/admin';
import { referralLink } from '../src/bot/handlers/profile';
import { COMMANDS } from '../src/bot/commands';
import { DEFAULT_SETTINGS, deepMerge, type AppSettings } from '../src/lib/settings';
import { button } from '../src/lib/telegram';
import type { EmojiResolver } from '../src/lib/emoji';
import { DEFAULT_EMOJIS } from '../src/lib/emoji';
import { en } from '../src/lib/i18n/en';
import { ar } from '../src/lib/i18n/ar';
import { render } from '../src/lib/i18n';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

function settings(over: unknown = {}): AppSettings {
  return deepMerge(structuredClone(DEFAULT_SETTINGS), over);
}

function resolver(premium: boolean, ids: Record<string, string> = {}): EmojiResolver {
  return {
    premium,
    char: (k) => DEFAULT_EMOJIS[k] ?? '',
    iconId: (k) => (premium ? ids[k] : undefined),
    html: (k) => (premium && ids[k] ? `<tg-emoji emoji-id="${ids[k]}">${DEFAULT_EMOJIS[k]}</tg-emoji>` : DEFAULT_EMOJIS[k] ?? ''),
  };
}

describe('callback data', () => {
  it('fits Telegram 64-byte limit for the longest patterns', () => {
    const samples = [
      cb('p', UUID), cb('q', UUID, 25), cb('qc', UUID), cb('dep', 'check', UUID), cb('dep', 'proof', UUID),
      cb('dep', 'a', 'binance_pay', 5000), cb('pay', 9_999_999_999, 'nowpayments'), cb('gw', 'j', UUID),
      cb('api', 'rv', UUID), `adm:dep_ok:${UUID}`, `adm:tk_rep:${9_999_999_999}`,
    ];
    for (const s of samples) expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(MAX_CALLBACK_BYTES);
  });

  it('throws when too long', () => {
    expect(() => cb('x'.repeat(70))).toThrow();
  });
});

describe('main menu', () => {
  it('groups buttons by row and hides disabled features', () => {
    const s = settings({ features: { freebies: false } });
    const kb = buildMainMenu(s, resolver(false), 'en');
    const texts = kb.map((r) => r.map((b) => b.text));
    expect(texts.flat().some((t) => t.includes('Freebies'))).toBe(false);
    // deposit + profile share row 3 in the defaults
    expect(texts.find((r) => r.some((t) => t.includes('Deposit')))?.some((t) => t.includes('My Profile'))).toBe(true);
    expect(kb[0][0].callback_data).toBe('shop');
  });

  it('website / channel appear only when configured, as url buttons', () => {
    const base = settings({ bot: { main_menu: [{ id: 'website', enabled: true, style: 'primary', row: 1 }] } });
    expect(visibleMenu(base)).toHaveLength(0);
    const withUrl = settings({ brand: { website_url: 'https://x.test' }, bot: { main_menu: [{ id: 'website', enabled: true, style: 'primary', row: 1 }] } });
    const kb = buildMainMenu(withUrl, resolver(false), 'ar');
    expect(kb[0][0].url).toBe('https://x.test');
    expect(kb[0][0].text).toContain('الموقع');
  });
});

describe('button builder', () => {
  it('prefixes the plain emoji without premium', () => {
    const b = button({ text: 'Shop', emoji: 'shop', data: 'shop', style: 'primary' }, resolver(false, { shop: '111' }));
    expect(b.text).toBe(`${DEFAULT_EMOJIS.shop} Shop`);
    expect(b.icon_custom_emoji_id).toBeUndefined();
    expect(b.style).toBe('primary');
  });

  it('uses icon_custom_emoji_id with premium', () => {
    const b = button({ text: 'Shop', emoji: 'shop', data: 'shop', style: 'default' }, resolver(true, { shop: '111' }));
    expect(b.text).toBe('Shop');
    expect(b.icon_custom_emoji_id).toBe('111');
    expect(b.style).toBeUndefined();
  });
});

describe('formatting helpers', () => {
  it('price with and without discount', () => {
    expect(priceHtml(12.83, 13.5)).toBe('<s>$13.50</s> <b>$12.83</b>');
    expect(priceHtml(5, 5)).toBe('<b>$5.00</b>');
    expect(priceText(1.9, 2)).toBe('$2.00 → $1.90');
    expect(discountPercent(12.83, 13.5)).toBe(5);
  });

  it('loc falls back to english', () => {
    expect(loc({ name_en: 'A', name_ar: null }, 'name', 'ar')).toBe('A');
    expect(loc({ name_en: 'A', name_ar: 'ب' }, 'name', 'ar')).toBe('ب');
  });

  it('chunks long lists', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(30)}`);
    const chunks = chunkLines(lines, 1000);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
  });

  it('referral link', () => {
    expect(referralLink('PlusStoreXBot', 42)).toBe('https://t.me/PlusStoreXBot?start=ref_42');
  });
});

describe('custom emoji capture', () => {
  it('extracts ids and fallback chars from entities', () => {
    const text = 'hi 🔥 and ⭐';
    const found = customEmojis({
      text,
      entities: [
        { type: 'custom_emoji', offset: 3, length: 2, custom_emoji_id: '5368324170671202286' },
        { type: 'custom_emoji', offset: 10, length: 1, custom_emoji_id: '5368324170671202287' },
        { type: 'bold', offset: 0, length: 2 },
      ],
    });
    expect(found).toEqual([
      { id: '5368324170671202286', fallback: '🔥' },
      { id: '5368324170671202287', fallback: '⭐' },
    ]);
  });
});

describe('i18n dictionaries', () => {
  it('every english key has an arabic translation', () => {
    const missing = Object.keys(en).filter((k) => !(k in ar));
    expect(missing).toEqual([]);
  });

  it('arabic texts keep the same placeholders as english', () => {
    const vars = (s: string) => (s.match(/\{[a-z_:]+\}/gi) ?? []).sort().join(',');
    const mismatched = Object.entries(en).filter(([k, v]) => ar[k] && vars(ar[k]!) !== vars(v)).map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  it('only uses emoji keys that exist in the library', () => {
    const used = new Set<string>();
    for (const v of [...Object.values(en), ...Object.values(ar)]) for (const m of v.matchAll(/\{e:([a-z_]+)\}/g)) used.add(m[1]);
    expect([...used].filter((k) => !(k in DEFAULT_EMOJIS))).toEqual([]);
  });

  it('renders without leftover placeholders for the welcome screen', () => {
    const html = render(en.welcome, { brand: 'Plus Store X', name: 'Ali', tagline: '', menu: '', links: '' }, resolver(false));
    expect(html).not.toMatch(/\{[a-z_:]+\}/);
  });

  it('every command has both descriptions', () => {
    for (const c of COMMANDS) {
      expect(c.en.length).toBeGreaterThan(2);
      expect(c.ar.length).toBeGreaterThan(2);
    }
  });
});
