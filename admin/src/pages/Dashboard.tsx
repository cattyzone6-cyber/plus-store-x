import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Hand, LifeBuoy, Wallet, Sparkles } from 'lucide-react';
import { useApi, useIsOwner } from '../lib/hooks';
import { usd, num, ago, label } from '../lib/format';
import { Badge, Card, ErrorBox, Loading, PageHeader, Stat, Tabs } from '../components/ui';

interface Stats {
  revenue: number; cost: number; orders: number; delivered: number; refunded: number;
  deposits: number; deposits_count: number; new_users: number;
  by_status: Record<string, number>; by_method: Record<string, number>;
  top_products: { product_id: string; product_name: string; qty: number; revenue: number }[];
  daily: { day: string; revenue: number; orders: number }[];
}
interface Overview {
  manual_orders: number; failed_orders: number; awaiting_provider: number; deposits_review: number; open_tickets: number;
  users_total: number; wallet_liability: number; new_provider_products: number;
  providers: { id: string; name: string; enabled: boolean; balance: number | null; low_balance_threshold: number | null; last_sync_at: string | null; last_sync_status: string | null }[];
}

function Bars({ data }: { data: { day: string; revenue: number }[] }) {
  if (!data.length) return <div className="py-10 text-center text-sm text-ink-400">No sales in this period</div>;
  const max = Math.max(...data.map((d) => Number(d.revenue)), 1);
  const w = 100 / data.length;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-40 w-full">
      {data.map((d, i) => {
        const h = (Number(d.revenue) / max) * 36;
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${usd(d.revenue)}`}</title>
            <rect x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} rx={0.6} fill="#F5B301" opacity={0.85} />
          </g>
        );
      })}
    </svg>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week');
  const q = useApi<{ today: Stats; week: Stats; month: Stats; overview: Overview }>('/dashboard', { refetchInterval: 60_000 });
  const owner = useIsOwner();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const s = d[period];
  const ov = d.overview;
  const profit = Number(s.revenue) - Number(s.cost);

  const queues = [
    { to: '/manual', icon: <Hand className="h-4 w-4" />, label: 'Manual / failed orders', n: ov.manual_orders + ov.failed_orders },
    { to: '/deposits?review=1', icon: <Wallet className="h-4 w-4" />, label: 'Deposits to review', n: ov.deposits_review },
    { to: '/tickets', icon: <LifeBuoy className="h-4 w-4" />, label: 'Open tickets', n: ov.open_tickets },
    ...(owner ? [{ to: '/providers', icon: <Sparkles className="h-4 w-4" />, label: 'New provider products', n: ov.new_provider_products }] : []),
  ];

  return (
    <>
      <PageHeader title="Dashboard" sub={`${num(ov.users_total)} customers · ${usd(ov.wallet_liability)} in wallets`} />
      <Tabs value={period} onChange={setPeriod} tabs={[{ value: 'today', label: 'Today' }, { value: 'week', label: '7 days' }, { value: 'month', label: '30 days' }]} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={usd(s.revenue)} sub={`${num(s.orders)} orders`} tone="gold" />
        {owner && <Stat label="Profit" value={usd(profit)} sub={`cost ${usd(s.cost)}`} tone={profit >= 0 ? 'green' : 'red'} />}
        <Stat label="Deposits" value={usd(s.deposits)} sub={`${num(s.deposits_count)} payments`} />
        <Stat label="New users" value={num(s.new_users)} sub={`refunded ${usd(s.refunded)}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Needs attention" className="lg:col-span-1">
          <div className="space-y-1">
            {queues.map((x) => (
              <Link key={x.to} to={x.to} className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-ink-800">
                <span className="flex items-center gap-2 text-ink-300">{x.icon}{x.label}</span>
                <Badge tone={x.n ? 'gold' : 'gray'}>{x.n}</Badge>
              </Link>
            ))}
            {ov.awaiting_provider > 0 && <div className="px-2 pt-2 text-xs text-ink-400">{ov.awaiting_provider} orders waiting on providers</div>}
          </div>
        </Card>
        <Card title="Revenue by day" className="lg:col-span-2"><Bars data={(period === 'today' ? d.week : s).daily} /></Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Top products" className="lg:col-span-2">
          {s.top_products.length === 0 ? <div className="text-sm text-ink-400">No sales yet</div> : (
            <div className="space-y-2">
              {s.top_products.map((p) => (
                <div key={p.product_id ?? p.product_name} className="flex items-center justify-between text-sm">
                  <Link to={p.product_id ? `/products/${p.product_id}` : '#'} className="truncate hover:text-gold">{p.product_name}</Link>
                  <span className="shrink-0 text-ink-400">{num(p.qty)} sold · <span className="text-zinc-100">{usd(p.revenue)}</span></span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Orders by status">
          <div className="space-y-1.5 text-sm">
            {Object.entries(s.by_status).length === 0 && <div className="text-ink-400">—</div>}
            {Object.entries(s.by_status).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="capitalize text-ink-300">{label(k)}</span><span>{v}</span></div>
            ))}
          </div>
          {Object.keys(s.by_method).length > 0 && (
            <>
              <div className="mb-1 mt-4 text-xs uppercase text-ink-400">Deposits by method</div>
              <div className="space-y-1.5 text-sm">
                {Object.entries(s.by_method).map(([k, v]) => (
                  <div key={k} className="flex justify-between"><span className="text-ink-300">{label(k)}</span><span>{usd(v)}</span></div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {owner && (
        <Card title="Providers" className="mt-4">
          {ov.providers.length === 0 ? <div className="text-sm text-ink-400">No providers yet — <Link to="/providers" className="text-gold">add one</Link>.</div> : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ov.providers.map((p) => {
                const low = p.balance != null && p.low_balance_threshold != null && Number(p.balance) < Number(p.low_balance_threshold);
                return (
                  <Link to={`/providers/${p.id}`} key={p.id} className="rounded-lg border border-ink-700 p-3 hover:border-gold/40">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{p.name}</span>
                      {!p.enabled ? <Badge>disabled</Badge> : p.last_sync_status === 'error' ? <Badge tone="red">sync error</Badge> : <Badge tone="green">ok</Badge>}
                    </div>
                    <div className={`mt-1 text-lg font-semibold ${low ? 'text-red-400' : ''}`}>{usd(p.balance)} {low && <AlertTriangle className="inline h-4 w-4" />}</div>
                    <div className="text-xs text-ink-400">synced {ago(p.last_sync_at)}</div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
