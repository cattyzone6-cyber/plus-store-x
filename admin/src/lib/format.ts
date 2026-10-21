export function usd(n: number | string | null | undefined, digits = 2): string {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(digits)}`;
}

export function num(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString();
}

export function dt(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ago(s: string | null | undefined): string {
  if (!s) return '—';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return `${Math.max(0, Math.floor(diff))}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** ISO → value for <input type="datetime-local"> */
export function toLocalInput(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(v).toISOString();
}

export const ORDER_STATUS_TONE: Record<string, 'gray' | 'gold' | 'green' | 'red' | 'blue' | 'purple'> = {
  pending_payment: 'gray',
  paid: 'blue',
  processing: 'blue',
  awaiting_provider: 'purple',
  manual_pending: 'gold',
  delivered: 'green',
  partially_delivered: 'gold',
  failed: 'red',
  refunded: 'gray',
  partially_refunded: 'gray',
  cancelled: 'gray',
};

export const DEPOSIT_STATUS_TONE: Record<string, 'gray' | 'gold' | 'green' | 'red' | 'blue'> = {
  pending: 'gold',
  confirming: 'blue',
  paid: 'green',
  expired: 'gray',
  rejected: 'red',
  cancelled: 'gray',
  failed: 'red',
};

export function label(s: string): string {
  return s.replace(/_/g, ' ');
}
