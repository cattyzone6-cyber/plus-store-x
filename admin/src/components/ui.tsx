import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { ChevronLeft, ChevronRight, Loader2, Lock, Unlock, Upload, X } from 'lucide-react';
import { uploadImage } from '../lib/api';
import { useTx } from '../lib/i18n';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Buttons & inputs
// ─────────────────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gold text-black hover:bg-[#ffc727] font-semibold',
  secondary: 'bg-ink-800 text-zinc-100 border border-ink-700 hover:bg-ink-700',
  ghost: 'text-ink-300 hover:bg-ink-800 hover:text-zinc-100',
  danger: 'bg-red-600/90 text-white hover:bg-red-600',
  success: 'bg-emerald-600/90 text-white hover:bg-emerald-600',
};

export function Button({
  variant = 'secondary', size = 'md', loading, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'min-h-9 px-2.5 py-1 text-xs sm:min-h-0' : 'min-h-10 px-3.5 py-2 text-sm sm:min-h-0',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('input', props.className)} />;
}

export function NumberInput({ value, onChange, allowNull, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null | undefined; onChange: (v: number | null) => void; allowNull?: boolean }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    if ((value ?? null) !== (text === '' ? null : Number(text))) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      {...rest}
      type="number"
      step={rest.step ?? 'any'}
      className={cx('input', rest.className)}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === '') onChange(allowNull ? null : 0);
        else if (!isNaN(Number(e.target.value))) onChange(Number(e.target.value));
      }}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('input min-h-[90px] font-[inherit]', props.className)} />;
}

export function Select({ options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={cx('input', props.className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex cursor-pointer select-none items-center gap-2 text-sm', disabled && 'opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-gold' : 'bg-ink-600')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'start-[18px]' : 'start-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function Field({ label, hint, children, className, locked, onUnlock }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; locked?: boolean; onUnlock?: () => void }) {
  const tx = useTx();
  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {locked !== undefined && (
          locked ? (
            <button type="button" onClick={onUnlock} title={tx('Edited by admin — sync will not overwrite it. Click to take the provider value again on the next sync.', 'عدّلته الإدارة — المزامنة لن تستبدله. اضغط لأخذ قيمة المزوّد في المزامنة القادمة.')} className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase text-gold">
              <Lock className="h-3 w-3" /> {tx('locked', 'مقفل')}
            </button>
          ) : (
            <span title={tx('Synced from provider', 'يُزامن من المزوّد')} className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase text-ink-400"><Unlock className="h-3 w-3" /> {tx('synced', 'متزامن')}</span>
          )
        )}
      </div>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────────────────────

const TONES = {
  gray: 'bg-ink-700 text-ink-300',
  gold: 'bg-gold/15 text-gold',
  green: 'bg-emerald-500/15 text-emerald-400',
  red: 'bg-red-500/15 text-red-400',
  blue: 'bg-sky-500/15 text-sky-400',
  purple: 'bg-violet-500/15 text-violet-300',
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium', TONES[tone], className)}>{children}</span>;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'gold' | 'green' | 'red' }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold', tone === 'gold' && 'text-gold', tone === 'green' && 'text-emerald-400', tone === 'red' && 'text-red-400')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-gold', className)} />;
}

export function Loading() {
  return <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>;
}

export function Empty({ children }: { children?: ReactNode }) {
  const tx = useTx();
  return <div className="py-12 text-center text-sm text-ink-400">{children ?? tx('Nothing here yet', 'لا يوجد شيء بعد')}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error instanceof Error ? error.message : String(error)}</div>;
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink-400">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

/** Phones only: the page's main actions stay reachable at the bottom of the screen (put it last on the page). */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 -mb-4 mt-4 flex flex-wrap gap-2 border-t border-ink-700 bg-ink-900/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden [&>*]:flex-1">
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Table + pagination
// ─────────────────────────────────────────────────────────────────────────────

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    // phones: the table scrolls sideways inside the card and the first column stays put
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[640px] border-collapse text-start max-sm:[&_td:first-child]:sticky max-sm:[&_td:first-child]:start-0 max-sm:[&_td:first-child]:z-[1] max-sm:[&_td:first-child]:bg-ink-850 max-sm:[&_th:first-child]:sticky max-sm:[&_th:first-child]:start-0 max-sm:[&_th:first-child]:z-[1] max-sm:[&_th:first-child]:bg-ink-850">
        <thead className="border-b border-ink-700 bg-ink-900/60">
          <tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-ink-700/70">{children}</tbody>
      </table>
      {empty && <Empty />}
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const tx = useTx();
  const pages = Math.max(1, Math.ceil(total / limit));
  const count = <span>{total} {tx(total === 1 ? 'item' : 'items', 'عنصر')}</span>;
  if (pages <= 1) return <div className="px-3 py-2 text-xs text-ink-400">{count}</div>;
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-ink-400">
      {count}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></Button>
        <span dir="ltr">{page} / {pages}</span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4 rtl:rotate-180" /></Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-ink-700">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition', value === t.value ? 'border-gold text-gold' : 'border-transparent text-ink-400 hover:text-zinc-100')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dialog / drawer
// ─────────────────────────────────────────────────────────────────────────────

export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const tx = useTx();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx('card flex max-h-[94dvh] w-full flex-col rounded-b-none sm:max-h-[92vh] sm:rounded-xl', wide ? 'sm:max-w-4xl' : 'sm:max-w-lg')}>
        <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
          <h3 className="min-w-0 truncate font-semibold">{title}</h3>
          <button onClick={onClose} aria-label={tx('Close', 'إغلاق')} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-ink-800 hover:text-white sm:h-8 sm:w-8"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-ink-700 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] [&>*]:flex-1 sm:[&>*]:flex-none">{footer}</footer>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toasts
// ─────────────────────────────────────────────────────────────────────────────

interface ToastItem { id: number; text: string; tone: 'ok' | 'err' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'err') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = ++idRef.current;
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'err' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:end-4 sm:items-end">
        {items.map((i) => (
          <div key={i.id} className={cx('pointer-events-auto max-w-sm rounded-lg border px-4 py-2.5 text-sm shadow-xl', i.tone === 'ok' ? 'border-emerald-500/30 bg-ink-850 text-emerald-300' : 'border-red-500/30 bg-ink-850 text-red-300')}>
            {i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

// ─────────────────────────────────────────────────────────────────────────────
// Image upload field
// ─────────────────────────────────────────────────────────────────────────────

export function ImageInput({ value, onChange, placeholder }: { value: string | null | undefined; onChange: (url: string | null) => void; placeholder?: string }) {
  const tx = useTx();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      {value ? <img src={value} alt="" className="h-9 w-9 shrink-0 rounded border border-ink-700 object-cover" /> : null}
      <Input value={value ?? ''} placeholder={placeholder ?? tx('https://… or upload', 'https://… أو ارفع صورة')} onChange={(e) => onChange(e.target.value || null)} />
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            onChange(await uploadImage(f));
          } catch (err) {
            toast((err as Error).message, 'err');
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }}
      />
      <Button type="button" onClick={() => ref.current?.click()} loading={busy} title={tx('Upload', 'رفع')}><Upload className="h-4 w-4" /></Button>
    </div>
  );
}

export function StyleSelect({ value, onChange, allowInherit }: { value: string | null | undefined; onChange: (v: string | null) => void; allowInherit?: boolean }) {
  const tx = useTx();
  const opts = [
    ...(allowInherit ? [{ value: '', label: tx('Inherit', 'افتراضي القسم') }] : []),
    { value: 'default', label: tx('Default (gray)', 'عادي (رمادي)') },
    { value: 'primary', label: tx('Blue', 'أزرق') },
    { value: 'success', label: tx('Green', 'أخضر') },
    { value: 'danger', label: tx('Red', 'أحمر') },
  ];
  return <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} options={opts} />;
}

export function StyleDot({ style }: { style: string | null | undefined }) {
  const c = style === 'primary' ? 'bg-sky-500' : style === 'success' ? 'bg-emerald-500' : style === 'danger' ? 'bg-red-500' : 'bg-ink-600';
  return <span className={cx('inline-block h-2.5 w-2.5 rounded-full', c)} />;
}
