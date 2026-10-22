import { describe, expect, it } from 'vitest';
import { matchCount, searchWords } from '../src/services/search';
import { inlineResults } from '../src/bot/handlers/search';
import type { GroupView, ProductView } from '../src/services/catalog';
import { DEFAULT_EMOJIS, type EmojiResolver } from '../src/lib/emoji';
import { render } from '../src/lib/i18n';
import { en } from '../src/lib/i18n/en';

describe('search query words', () => {
  it('lowercases, splits and drops filter characters', () => {
    expect(searchWords('  CapCut  1M ')).toEqual(['capcut', '1m']);
    expect(searchWords('chat%gpt_plus,(x)')).toEqual(['chat', 'gpt', 'plus']);
    expect(searchWords('a')).toEqual([]);
    expect(searchWords('%_')).toEqual([]);
    expect(searchWords('شات جي بي تي')).toEqual(['شات', 'جي', 'بي', 'تي']);
  });

  it('keeps at most 5 distinct words', () => {
    expect(searchWords('aa bb aa cc dd ee ff gg')).toEqual(['aa', 'bb', 'cc', 'dd', 'ee']);
  });

  it('matches each word on its own', () => {
    const words = searchWords('capcut 1m');
    expect(matchCount('CapCut Pro 1M 1600 AI credit', words)).toBe(2);
    expect(matchCount('CapCut Pro 12M', words)).toBe(1); // "1m" is not in "12m"
    expect(matchCount('ChatGPT Plus 1M', words)).toBe(1);
    expect(matchCount('Netflix', words)).toBe(0);
  });
});

describe('inline results', () => {
  const em: EmojiResolver = { premium: false, char: (k) => DEFAULT_EMOJIS[k] ?? '', iconId: () => undefined, html: (k) => DEFAULT_EMOJIS[k] ?? '' };
  const tt = (key: string, vars: Record<string, unknown> = {}) => render((en as Record<string, string>)[key] ?? key, vars, em);
  const id = '123e4567-e89b-12d3-a456-426614174000';

  it('builds article cards with deep links', () => {
    const pack = {
      product: { id, name_en: 'CapCut Pro 1M', name_ar: null, emoji: null, image_url: null, description_en: '<b>x</b>' },
      pricing: { unitPrice: 2.5, originalUnitPrice: null, soldOut: false, available: 4 },
    } as unknown as ProductView;
    const group = {
      group: { id, name_en: 'ChatGPT Plus', name_ar: 'شات جي بي تي بلس', emoji: '🤖', image_url: 'https://x.test/a.png', description_en: null },
      packs: [pack], fromPrice: 13.5, inStock: true,
    } as unknown as GroupView;
    const out = inlineResults({ groups: [group], packs: [pack] }, 'en', 'PlusStoreXBot', tt, em);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(`g${id}`);
    expect(new TextEncoder().encode(out[0].id).length).toBeLessThanOrEqual(64);
    expect(out[0].description).toBe('from $13.50 · in stock');
    expect(out[0].thumbnail_url).toBe('https://x.test/a.png');
    expect(out[0].reply_markup?.inline_keyboard[0][0]).toMatchObject({ url: `https://t.me/PlusStoreXBot?start=g_${id}` });
    expect(out[1].description).toBe('$2.50 · 4 available');
    const msg = (out[1].input_message_content as { message_text: string }).message_text;
    expect(msg).toContain('<b>CapCut Pro 1M</b>');
    expect(msg).toContain('&lt;b&gt;x&lt;/b&gt;'); // description escaped
    expect(msg).not.toMatch(/\{[a-z_:]+\}/);
    expect(out[1].thumbnail_url).toBeUndefined();
  });
});
