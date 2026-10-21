import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../lib/api';
import { useApi, useIsOwner, type Paged } from '../lib/hooks';
import { usd, dt, label, ORDER_STATUS_TONE } from '../lib/format';
import { Badge, Card, ErrorBox, Input, Loading, PageHeader, Pagination, Select, Table } from '../components/ui';

export interface Order {
  id: number; code: string; user_id: number; product_id: string | null; product_name: string; quantity: number;
  unit_price: number; total: number; discount_amount: number; promo_code: string | null; status: string; inputs: Record<string, unknown>;
  provider_id: string | null; provider_order_ref: string | null; provider_status: string | null; cost_total: number | null;
  delivery: string[]; delivered_qty: number; refunded_amount: number; points_awarded: number; warranty_until: string | null;
  channel: string; error: string | null; admin_note: string | null; created_at: string; paid_at: string | null; delivered_at: string | null;
}

const STATUSES = ['paid', 'processing', 'awaiting_provider', 'manual_pending', 'delivered', 'partially_delivered', 'failed', 'refunded', 'partially_refunded', 'cancelled', 'pending_payment'];

export default function Orders({ manual }: { manual?: boolean }) {
  const [status, setStatus] = useState(manual ? 'manual_pending,failed' : '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const owner = useIsOwner();
  const list = useApi<Paged<Order>>(`/orders${qs({ status, q, page, limit: 30 })}`, { refetchInterval: manual ? 20_000 : undefined });

  return (
    <>
      <PageHeader title={manual ? 'Manual queue' : 'Orders'} sub={manual ? 'Orders waiting for a human: manual products and failed deliveries.' : undefined} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input placeholder="Code, product or user id…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select className="max-w-[220px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[
            { value: '', label: 'All paid orders' },
            ...(manual ? [{ value: 'manual_pending,failed', label: 'Manual + failed' }] : []),
            ...STATUSES.map((s) => ({ value: s, label: label(s) })),
          ]} />
        </div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={['Order', 'Product', 'User', 'Total', ...(owner ? ['Cost'] : []), 'Status', 'Date']} empty={!list.data?.items.length}>
              {list.data!.items.map((o) => (
                <tr key={o.id}>
                  <td className="td"><Link to={`/orders/${o.id}`} className="font-mono text-xs text-gold hover:underline">{o.code}</Link>{o.channel === 'api' && <Badge className="ms-1">api</Badge>}</td>
                  <td className="td max-w-[260px] truncate">{o.product_name} <span className="text-ink-400">× {o.quantity}</span></td>
                  <td className="td"><Link to={`/users/${o.user_id}`} className="text-xs hover:text-gold">{o.user_id}</Link></td>
                  <td className="td whitespace-nowrap">{usd(o.total)}{o.refunded_amount > 0 && <div className="text-xs text-ink-400">−{usd(o.refunded_amount)}</div>}</td>
                  {owner && <td className="td text-ink-400">{usd(o.cost_total)}</td>}
                  <td className="td"><Badge tone={ORDER_STATUS_TONE[o.status]}>{label(o.status)}</Badge>{o.error && <div className="max-w-[200px] truncate text-xs text-red-300" title={o.error}>{o.error}</div>}</td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(o.created_at)}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} limit={list.data!.limit} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
