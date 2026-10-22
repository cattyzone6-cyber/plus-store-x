import { describe, expect, it } from 'vitest';
import { cleanProviderName, durationText, parseDurationDays, parseWarranty } from '../src/lib/names';

describe('cleanProviderName — product grouping', () => {
  const cases: [string, string][] = [
    ['Capcut pro 1M 1600 Ai credit FW', 'CapCut Pro'],
    ['CAPCUT PRO Personal 6-month warranty 150D', 'CapCut Pro'],
    ['CapCut Pro Team 3 Months - full warranty', 'CapCut Pro'],
    ['CAPCUT PRO PERSONAL 30D full warranty', 'CapCut Pro'],
    ['Chatgpt Pro $500 1 month, 3-day warranty', 'ChatGPT Pro'],
    ['CHATGPT PRO X200 1 MONTH (no warranty)', 'ChatGPT Pro'],
    ['Chatgpt plus 1M (Apple pay)Gmail NW', 'ChatGPT Plus'],
    ['Zoom - Zoom Pro 1M (W25D) Ready Account', 'Zoom Pro'],
    ['Microsoft 365 Family � 1 Year Invitation', 'Microsoft 365'],
    ['Gemini 18 Months', 'Gemini'],
    ['Express VPN 12 Months no warranty', 'Express VPN'],
    ['Runway Pro Redeem 1 year', 'Runway Pro'],
    ['redeem Notion Business 3 months', 'Notion Business'],
    ['Slot Notion Business has an official AI with a full 3-month warranty', 'Notion Business'],
    ['DUOLINGO SUPER Slot - 12 MONTHS (full warranty)', 'Duolingo Super'],
    ['Spotify Premium Family account, original owner, 6-month slot with full warranty', 'Spotify Premium'],
    ['VEO 4 Ultra x20 750K Credit Slot 1 month full warranty', 'VEO 4 Ultra'],
    ['Suno PRO 1 Month Warranty 3 Days', 'Suno Pro'],
    ['GPT GO 1 MONTH (24H warranty)', 'GPT Go'],
    ['Supercut Pro 10 Seat 12m', 'Supercut Pro'],
    ['Higgsfield 80cre 1 month warranty 5 days', 'Higgsfield'],
    ['ElevenLabs Creator 12m FW', 'ElevenLabs Creator'],
    ['Wispr Flow Pro 12m FW', 'Wispr Flow Pro'],
  ];
  for (const [raw, product] of cases) {
    it(raw, () => expect(cleanProviderName(raw).product).toBe(product));
  }

  it('groups different plans of the same product under one key', () => {
    const keys = new Set(['Capcut pro 1M 1600 Ai credit FW', 'CapCut Pro Team 3 Months - full warranty', 'CAPCUT PRO Personal 6-month warranty 150D']
      .map((n) => cleanProviderName(n).key));
    expect(keys.size).toBe(1);
  });

  it('owner word list overrides spelling', () => {
    expect(cleanProviderName('wispr flow pro 12m', { wispr: 'WISPR' }).product).toBe('WISPR Flow Pro');
  });
});

describe('duration and warranty', () => {
  it('reads durations', () => {
    expect(parseDurationDays('Capcut pro 1M 1600 Ai credit FW')).toBe(30);
    expect(parseDurationDays('Zoom Pro 1Y full warranty')).toBe(365);
    expect(parseDurationDays('Runway Pro 12m FW')).toBe(365);
    expect(parseDurationDays('CAPCUT PRO Personal 6-month warranty 150D')).toBe(180);
    expect(parseDurationDays('Express VPN 3 Days full warranty')).toBe(3);
    expect(parseDurationDays('Miro EDU Lifetime Access')).toBe(0);
    expect(parseDurationDays('Higgsfield 80cre 1 month warranty 5 days')).toBe(30);
    expect(parseDurationDays('Chatgpt Pro $500 1 month, 3-day warranty')).toBe(30);
  });
  it('reads warranty', () => {
    expect(parseWarranty('Runway Pro 12m FW')).toBe('full');
    expect(parseWarranty('Chatgpt plus 1M (Apple pay)Gmail NW')).toBe('none');
    expect(parseWarranty('Zoom - Zoom Pro 1M (W25D) Ready Account')).toBe(25);
    expect(parseWarranty('Chatgpt Pro $500 1 month, 3-day warranty')).toBe(3);
    expect(parseWarranty('Higgsfield 80cre 1 month warranty 5 days')).toBe(5);
    expect(parseWarranty('CAPCUT PRO Personal 6-month warranty 150D')).toBe(150);
    expect(parseWarranty('SUNO PREMIER 1 MONTH (3 DAYS warranty)')).toBe(3);
    expect(parseWarranty('Gemini 18 Months')).toBeNull();
  });
});

describe('token amounts and Arabic durations', () => {
  it('does not read token or credit amounts as months', () => {
    expect(parseDurationDays('API 100M Token Claude 3Day')).toBe(3);
    expect(parseDurationDays('API 10M Token codex (1Day Warranty)')).toBeNull();
    expect(parseDurationDays('Capcut pro 1M 1600 Ai credit FW')).toBe(30);
  });
  it('writes natural Arabic counts', () => {
    expect(durationText(365, 'ar')).toBe('سنة');
    expect(durationText(730, 'ar')).toBe('سنتان');
    expect(durationText(90, 'ar')).toBe('3 أشهر');
    expect(durationText(540, 'ar')).toBe('18 شهراً');
    expect(durationText(30, 'ar')).toBe('شهر');
    expect(durationText(9, 'ar')).toBe('9 أيام');
    expect(durationText(365, 'en')).toBe('1 year');
  });
});
