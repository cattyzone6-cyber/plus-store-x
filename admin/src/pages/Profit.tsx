import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd, num } from '../lib/format';
import { Badge, Card, ErrorBox, Input, Loading, PageHeader, Table, Tabs, cx } from '../components/ui';

interface Totals {
  revenue: number; cost: number; profit: number; margin_percent: number | null;
  orders: number; units: number; refunds: number; avg_order: number | null;
}
interface Day { day: string; revenue: number; cost: number; profit: number; orders: number }
interface ProductRow { key: string; name: string; kind: 'product' | 'pack'; units: number; revenue: number; cost: number; profit: number; margin_percent: number | null }
interface PackRow { product_id: string | null; name: string; units: number; revenue: number; profit: number }
interface ProviderRow { provider_id: string | null; name: string; orders: number; revenue: number; cost: number; profit: number }
interface ProfitData {
  totals: Totals; previous: Totals; by_day: Day[];
  by_product: ProductRow[]; by_pack: PackRow[]; by_provider: ProviderRow[];
}

type Preset = 'today' | '7d' | '30d' | '90d' | 'month' | 'custom';

const DAY = 86400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfUtcDay = (t: number) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

/** [from, to) in UTC days; `to` is the start of the day after the last one shown. */
function presetRange(p: Exclude<Preset, 'custom'>): { from: number; to: number } {
  const today = startOfUtcDay(Date.now());
  const to = today + DAY;
  if (p === 'month') { const d = new Date(today); d.setUTCDate(1); return { from: d.getTime(), to }; }
  const days = { today: 1, '7d': 7, '30d': 30, '90d': 90 }[p];
  return { from: today - (days - 1) * DAY, to };
}

const n = (v: number | string | null | undefined) => Number(v ?? 0);
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

/** ▲/▼ change against the previous period of the same length. `upIsBad` flips the colour (cost, refunds). */
function Delta({ cur, prev, upIsBad }: { cur: number; prev: number; upIsBad?: boolean }) {
  const tx = useTx();
  if (!prev && !cur) return <span className="text-ink-400">—</span>;
  if (!prev) return <span className="text-ink-400">{tx('new', 'جديد')}</span>;
  const change = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(change) < 0.05) return <span className="text-ink-400">= 0%</span>;
  const up = change > 0;
  const good = upIsBad ? !up : up;
  return <span className={good ? 'text-emerald-400' : 'text-red-400'} dir="ltr">{up ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%</span>;
}

function Kpi({ label, value, cur, prev, upIsBad, tone }: { label: string; value: ReactNode; cur: number; prev: number; upIsBad?: boolean; tone?: 'gold' | 'green' | 'red' }) {
  const tx = useTx();
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <div className={cx('mt-1 text-xl font-semibold sm:text-2xl', tone === 'gold' && 'text-gold', tone === 'green' && 'text-emerald-400', tone === 'red' && 'text-red-400')}>{value}</div>
      <div className="mt-0.5 flex flex-wrap gap-1 text-xs"><Delta cur={cur} prev={prev} upIsBad={upIsBad} /><span className="text-ink-400">{tx('vs previous period', 'مقارنة بالفترة السابقة')}</span></div>
    </div>
  );
}

/** Profit bars (green / red below zero) with the revenue line on top. Hover or tap a day for details. */
function DailyChart({ data }: { data: Day[] }) {
  const tx = useTx();
  const [sel, setSel] = useState<number | null>(null);
  const W = Math.max(data.length * 10, 10);
  const H = 120;
  const max = Math.max(...data.map((d) => Math.max(n(d.revenue), n(d.profit))), 0.01);
  const min = Math.min(...data.map((d) => n(d.profit)), 0);
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const zero = y(0);
  const line = data.map((d, i) => `${i * 10 + 5},${y(n(d.revenue)).toFixed(2)}`).join(' ');
  const active = sel != null ? data[sel] : null;

  return (
    <div>
      <div className="mb-2 flex min-h-[2.5rem] flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {active ? (
          <>
            <span className="font-semibold text-zinc-100" dir="ltr">{active.day}</span>
            <span className="text-ink-300">{tx('Revenue', 'الإيرادات')} <span className="text-gold">{usd(active.revenue)}</span></span>
            <span className="text-ink-300">{tx('Cost', 'التكلفة')} {usd(active.cost)}</span>
            <span className="text-ink-300">{tx('Profit', 'الربح')} <span className={n(active.profit) < 0 ? 'text-red-400' : 'text-emerald-400'}>{usd(active.profit)}</span></span>
            <span className="text-ink-300">{tx(`${num(active.orders)} orders`, `${num(active.orders)} طلب`)}</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-ink-300"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />{tx('Profit', 'الربح')}</span>
            <span className="flex items-center gap-1.5 text-ink-300"><span className="inline-block h-0.5 w-4 bg-gold" />{tx('Revenue', 'الإيرادات')}</span>
            <span className="text-ink-400">{tx('Tap a day for details', 'اضغط على يوم لعرض التفاصيل')}</span>
          </>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-48 w-full touch-manipulation" style={{ direction: 'ltr' }} onMouseLeave={() => setSel(null)}>
        <line x1={0} x2={W} y1={zero} y2={zero} stroke="#3f3f46" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const p = n(d.profit);
          const top = p >= 0 ? y(p) : zero;
          const h = Math.abs(y(p) - zero);
          return (
            <g key={d.day}>
              {sel === i && <rect x={i * 10} y={0} width={10} height={H} fill="#ffffff" opacity={0.05} />}
              <rect x={i * 10 + 1.5} y={top} width={7} height={Math.max(h, p === 0 ? 0 : 0.5)} rx={0.8} fill={p < 0 ? '#ef4444' : '#10b981'} opacity={sel == null || sel === i ? 0.9 : 0.5} />
            </g>
          );
        })}
        {data.length > 1 && <polyline points={line} fill="none" stroke="#F5B301" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {data.length === 1 && <circle cx={5} cy={y(n(data[0].revenue))} r={1.5} fill="#F5B301" />}
        {data.map((d, i) => (
          <rect key={`hit-${d.day}`} x={i * 10} y={0} width={10} height={H} fill="transparent" onMouseEnter={() => setSel(i)} onClick={() => setSel(sel === i ? null : i)} />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-400" dir="ltr">
        <span>{data[0]?.day}</span>
        {data.length > 2 && <span>{data[Math.floor(data.length / 2)]?.day}</span>}
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}

/** A table on wider screens, stacked cards on phones. */
function Responsive<T>({ rows, head, row, card, rowKey }: { rows: T[]; head: ReactNode[]; row: (r: T) => ReactNode; card: (r: T) => ReactNode; rowKey: (r: T, i: number) => string }) {
  const tx = useTx();
  if (!rows.length) return <div className="text-sm text-ink-400">{tx('No sales in this period', 'لا مبيعات في هذه الفترة')}</div>;
  return (
    <>
      <div className="-m-4 hidden sm:block"><Table head={head}>{rows.map((r, i) => <tr key={rowKey(r, i)} className="hover:bg-ink-800/40">{row(r)}</tr>)}</Table></div>
      <div className="space-y-2 sm:hidden">{rows.map((r, i) => <div key={rowKey(r, i)} className="rounded-lg border border-ink-700 p-3 text-sm">{card(r)}</div>)}</div>
    </>
  );
}

const profitTone = (v: number) => (v < 0 ? 'text-red-400' : 'text-emerald-400');

export default function Profit() {
  const tx = useTx();
  const [preset, setPreset] = useState<Preset>('30d');
  const [custom, setCustom] = useState(() => { const r = presetRange('30d'); return { from: isoDay(r.from), to: isoDay(r.to - DAY) }; });
  const [showAll, setShowAll] = useState(false);

  const range = useMemo(() => {
    if (preset !== 'custom') return presetRange(preset);
    const from = Date.parse(`${custom.from}T00:00:00Z`);
    const to = Date.parse(`${custom.to}T00:00:00Z`) + DAY;
    return isFinite(from) && isFinite(to) && from < to ? { from, to } : null;
  }, [preset, custom]);
  const tooLong = range != null && range.to - range.from > 366 * DAY;
  const path = range && !tooLong ? `/profit?from=${new Date(range.from).toISOString()}&to=${new Date(range.to).toISOString()}` : null;
  const q = useApi<ProfitData>(path);

  const presets: { value: Preset; label: string }[] = [
    { value: 'today', label: tx('Today', 'اليوم') },
    { value: '7d', label: tx('7 days', '7 أيام') },
    { value: '30d', label: tx('30 days', '30 يوماً') },
    { value: '90d', label: tx('90 days', '90 يوماً') },
    { value: 'month', label: tx('This month', 'هذا الشهر') },
    { value: 'custom', label: tx('Custom', 'مخصّص') },
  ];

  const d = q.data;
  const t = d?.totals;
  const p = d?.previous;
  const limit = showAll ? 50 : 10;

  return (
    <>
      <PageHeader
        title={tx('Profit', 'الأرباح')}
        sub={tx('Delivered orders only · revenue after refunds · days in UTC', 'الطلبات المُسلّمة فقط · الإيرادات بعد الاسترداد · الأيام بتوقيت UTC')}
      />
      <Tabs value={preset} onChange={setPreset} tabs={presets} />
      {preset === 'custom' && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-400">{tx('From', 'من')}<Input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="mt-1 block" /></label>
          <label className="text-xs text-ink-400">{tx('To', 'إلى')}<Input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="mt-1 block" /></label>
          {!range && <span className="text-xs text-red-400">{tx('Pick a valid range', 'اختر فترة صحيحة')}</span>}
          {tooLong && <span className="text-xs text-red-400">{tx('The range can be at most 366 days', 'أقصى مدة للفترة 366 يوماً')}</span>}
        </div>
      )}

      {q.error ? <ErrorBox error={q.error} /> : !d || !t || !p ? (path ? <Loading /> : null) : (
        <div className={cx(q.isFetching && 'opacity-70 transition-opacity')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={tx('Revenue', 'الإيرادات')} value={usd(t.revenue)} cur={n(t.revenue)} prev={n(p.revenue)} tone="gold" />
            <Kpi label={tx('Cost', 'التكلفة')} value={usd(t.cost)} cur={n(t.cost)} prev={n(p.cost)} upIsBad />
            <Kpi label={tx('Profit', 'الربح')} value={usd(t.profit)} cur={n(t.profit)} prev={n(p.profit)} tone={n(t.profit) < 0 ? 'red' : 'green'} />
            <Kpi label={tx('Margin', 'هامش الربح')} value={pct(t.margin_percent)} cur={n(t.margin_percent)} prev={n(p.margin_percent)} />
            <Kpi label={tx('Orders', 'الطلبات')} value={num(t.orders)} cur={n(t.orders)} prev={n(p.orders)} />
            <Kpi label={tx('Average order', 'متوسط الطلب')} value={usd(t.avg_order)} cur={n(t.avg_order)} prev={n(p.avg_order)} />
            <Kpi label={tx('Refunds', 'المبالغ المستردة')} value={usd(t.refunds)} cur={n(t.refunds)} prev={n(p.refunds)} upIsBad />
            <Kpi label={tx('Units sold', 'الوحدات المباعة')} value={num(t.units)} cur={n(t.units)} prev={n(p.units)} />
          </div>

          {n(t.orders) === 0 ? (
            <Card className="mt-4"><div className="py-10 text-center text-sm text-ink-400">{tx('No sales in this period', 'لا مبيعات في هذه الفترة')}</div></Card>
          ) : (
            <>
              <Card title={tx('Profit by day', 'الربح حسب اليوم')} className="mt-4"><DailyChart data={d.by_day} /></Card>

              <Card
                title={tx('Top products', 'أفضل المنتجات')}
                className="mt-4"
                actions={d.by_product.length > 10 || d.by_pack.length > 10 ? (
                  <button className="text-xs text-gold hover:underline" onClick={() => setShowAll(!showAll)}>{showAll ? tx('Show top 10', 'عرض أفضل 10') : tx('Show top 50', 'عرض أفضل 50')}</button>
                ) : undefined}
              >
                <Responsive
                  rows={d.by_product.slice(0, limit)}
                  rowKey={(r) => r.key}
                  head={[tx('Product', 'المنتج'), tx('Sold', 'المباع'), tx('Revenue', 'الإيرادات'), tx('Cost', 'التكلفة'), tx('Profit', 'الربح'), tx('Margin', 'الهامش')]}
                  row={(r) => (
                    <>
                      <td className="td"><span className="flex items-center gap-2"><span className="truncate">{r.name}</span>{r.kind === 'pack' && <Badge>{tx('pack', 'باقة')}</Badge>}</span></td>
                      <td className="td">{num(r.units)}</td>
                      <td className="td">{usd(r.revenue)}</td>
                      <td className="td text-ink-300">{usd(r.cost)}</td>
                      <td className={cx('td font-medium', profitTone(n(r.profit)))}>{usd(r.profit)}</td>
                      <td className="td">{pct(r.margin_percent)}</td>
                    </>
                  )}
                  card={(r) => (
                    <>
                      <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-medium">{r.name}</span><span className={cx('shrink-0 font-semibold', profitTone(n(r.profit)))}>{usd(r.profit)}</span></div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-400">
                        <span>{tx(`${num(r.units)} sold`, `${num(r.units)} مباع`)}</span>
                        <span>{tx('Revenue', 'الإيرادات')} {usd(r.revenue)}</span>
                        <span>{tx('Cost', 'التكلفة')} {usd(r.cost)}</span>
                        <span>{tx('Margin', 'الهامش')} {pct(r.margin_percent)}</span>
                      </div>
                    </>
                  )}
                />
              </Card>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Card title={tx('Top packs', 'أفضل الباقات')}>
                  <Responsive
                    rows={d.by_pack.slice(0, limit)}
                    rowKey={(r, i) => r.product_id ?? `${r.name}-${i}`}
                    head={[tx('Pack', 'الباقة'), tx('Sold', 'المباع'), tx('Revenue', 'الإيرادات'), tx('Profit', 'الربح')]}
                    row={(r) => (
                      <>
                        <td className="td">{r.product_id ? <Link to={`/products/${r.product_id}`} className="hover:text-gold">{r.name}</Link> : r.name}</td>
                        <td className="td">{num(r.units)}</td>
                        <td className="td">{usd(r.revenue)}</td>
                        <td className={cx('td font-medium', profitTone(n(r.profit)))}>{usd(r.profit)}</td>
                      </>
                    )}
                    card={(r) => (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          {r.product_id ? <Link to={`/products/${r.product_id}`} className="min-w-0 truncate font-medium hover:text-gold">{r.name}</Link> : <span className="min-w-0 truncate font-medium">{r.name}</span>}
                          <span className={cx('shrink-0 font-semibold', profitTone(n(r.profit)))}>{usd(r.profit)}</span>
                        </div>
                        <div className="mt-1 flex gap-3 text-xs text-ink-400"><span>{tx(`${num(r.units)} sold`, `${num(r.units)} مباع`)}</span><span>{tx('Revenue', 'الإيرادات')} {usd(r.revenue)}</span></div>
                      </>
                    )}
                  />
                </Card>

                <Card title={tx('Providers', 'المزوّدون')}>
                  <Responsive
                    rows={d.by_provider}
                    rowKey={(r) => r.provider_id ?? 'own'}
                    head={[tx('Provider', 'المزوّد'), tx('Orders', 'الطلبات'), tx('Revenue', 'الإيرادات'), tx('Cost', 'التكلفة'), tx('Profit', 'الربح')]}
                    row={(r) => (
                      <>
                        <td className="td">{r.provider_id ? r.name : tx('Own stock / manual', 'مخزون خاص / يدوي')}</td>
                        <td className="td">{num(r.orders)}</td>
                        <td className="td">{usd(r.revenue)}</td>
                        <td className="td text-ink-300">{usd(r.cost)}</td>
                        <td className={cx('td font-medium', profitTone(n(r.profit)))}>{usd(r.profit)}</td>
                      </>
                    )}
                    card={(r) => (
                      <>
                        <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-medium">{r.provider_id ? r.name : tx('Own stock / manual', 'مخزون خاص / يدوي')}</span><span className={cx('shrink-0 font-semibold', profitTone(n(r.profit)))}>{usd(r.profit)}</span></div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-400"><span>{tx(`${num(r.orders)} orders`, `${num(r.orders)} طلب`)}</span><span>{tx('Revenue', 'الإيرادات')} {usd(r.revenue)}</span><span>{tx('Cost', 'التكلفة')} {usd(r.cost)}</span></div>
                      </>
                    )}
                  />
                </Card>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
