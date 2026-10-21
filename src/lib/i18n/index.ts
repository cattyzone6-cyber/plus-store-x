import type { Lang } from '../../types';
import type { AppSettings } from '../settings';
import { en } from './en';
import { ar } from './ar';
import { payEn } from './pay_en';
import { payAr } from './pay_ar';
import type { EmojiResolver } from '../emoji';

export type TextKey = keyof typeof en;
export const DICTS: Record<Lang, Record<string, string>> = {
  en: { ...payEn, ...en },
  ar: { ...payAr, ...ar },
};

/**
 * Translate a key. Texts are Telegram HTML.
 *  - `{name}` placeholders are replaced from `vars` (values are HTML-escaped unless passed through `raw()`).
 *  - `{e:key}` placeholders are replaced by the emoji library (custom emoji when premium is enabled).
 * Admin overrides in settings.texts win over the built-in dictionaries.
 */
export function t(
  s: AppSettings,
  lang: Lang,
  key: TextKey | string,
  vars: Record<string, unknown> = {},
  emoji?: EmojiResolver,
): string {
  const template = s.texts?.[key]?.[lang] || DICTS[lang]?.[key] || s.texts?.[key]?.en || DICTS.en[key] || key;
  return render(template, vars, emoji);
}

const RAW = Symbol('raw');
export interface RawHtml { [RAW]: true; html: string }
/** Mark a value as already-safe HTML so it is not escaped. */
export function raw(html: string): RawHtml {
  return { [RAW]: true, html };
}

export function render(template: string, vars: Record<string, unknown> = {}, emoji?: EmojiResolver): string {
  return template.replace(/\{(e:)?([a-zA-Z0-9_]+)\}/g, (m, isEmoji, name) => {
    if (isEmoji) return emoji ? emoji.html(name) : '';
    if (!(name in vars)) return m;
    const v = vars[name];
    if (v && typeof v === 'object' && RAW in (v as object)) return (v as RawHtml).html;
    return escapeHtml(v == null ? '' : String(v));
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Pick the localized column of a row, e.g. pick(row, 'name', 'ar') → row.name_ar || row.name_en */
export function pick<T extends Record<string, unknown>>(row: T, field: string, lang: Lang): string {
  const v = row[`${field}_${lang}`] as string | null | undefined;
  return (v && v.trim()) || ((row[`${field}_en`] as string | null | undefined) ?? '') || '';
}
