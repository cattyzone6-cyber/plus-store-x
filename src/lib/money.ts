// All store money is USD. Internally we keep up to 4 decimals, display 2.

export type Rounding = 'none' | '0.01' | '0.05' | '0.09' | '0.49' | '0.99' | '1';

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Apply a "nice price" rounding rule (always rounds up so margin is never lost). */
export function applyRounding(n: number, rule: Rounding): number {
  if (!isFinite(n) || n <= 0) return 0;
  switch (rule) {
    case 'none':
      return round4(n);
    case '0.01':
      return Math.ceil(round4(n) * 100) / 100;
    case '0.05':
      return round2(Math.ceil(round4(n) * 20) / 20);
    case '1':
      return Math.ceil(round4(n));
    case '0.09':
    case '0.49':
    case '0.99': {
      // round up to the next value ending with the given cents, e.g. 0.09 → 4.09, 4.19, ...
      const cents = rule === '0.09' ? 0.09 : rule === '0.49' ? 0.49 : 0.99;
      const step = rule === '0.09' ? 0.1 : rule === '0.49' ? 0.5 : 1;
      const base = Math.floor(n / step) * step + cents;
      const v = base >= n - 1e-9 ? base : base + step;
      return round2(v);
    }
  }
}

export function fmtUsd(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `$${v.toFixed(2)}`;
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return isFinite(n) ? n : fallback;
}
