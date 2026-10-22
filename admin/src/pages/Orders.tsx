import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../lib/api';
import { useApi, useIsOwner, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
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
  const tx = useTx();
  const [status, setStatus] = useState(manual ? 'manual_pending,failed' : '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const owner = useIsOwner();
  const list = useApi<Paged<Order>>(`/orders${qs({ status, q, page, limit: 30 })}`, { refetchInterval: manual ? 20_000 : undefined });

  return (
    <>
      <PageHeader
        title={manual ? tx('Manual queue', 'التسليم اليدوي') : tx('Orders', 'الطلبات')}
        sub={manual ? tx('Orders waiting for a human: manual packs and failed deliveries.', 'طلبات تنتظر تدخّلاً: باقات يدوية وتسليمات فاشلة.') : undefined}
      />
      <Card>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Input placeholder={tx('Code, pack or user id…', 'الكود أو الباقة أو رقم الزبون…')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="sm:max-w-xs" />
          <Select className="sm:max-w-[220px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[
            { value: '', label: tx('All paid orders', 'كل الطلبات المدفوعة') },
            ...(manual ? [{ value: 'manual_pending,failed', label: tx('Manual + failed', 'يدوي + فاشل') }] : []),
            ...STATUSES.map((s) => ({ value: s, label: label(s) })),
          ]} />
        </div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={[tx('Order', 'الطلب'), tx('Pack', 'الباقة'), tx('User', 'الزبون'), tx('Total', 'الإجمالي'), ...(owner ? [tx('Cost', 'التكلفة')] : []), tx('Status', 'الحالة'), tx('Date', 'التاريخ')]} empty={!list.data?.items.length}>
              {list.data!.items.map((o) => (
                <tr key={o.id}>
                  <td className="td whitespace-nowrap"><Link to={`/orders/${o.id}`} dir="ltr" className="font-mono text-xs text-gold hover:underline">{o.code}</Link>{o.channel === 'api' && <Badge className="ms-1">{label('api')}</Badge>}</td>
                  <td className="td max-w-[260px] truncate">{o.product_name} <span className="text-ink-400" dir="ltr">× {o.quantity}</span></td>
                  <td className="td"><Link to={`/users/${o.user_id}`} dir="ltr" className="text-xs hover:text-gold">{o.user_id}</Link></td>
                  <td className="td whitespace-nowrap">{usd(o.total)}{o.refunded_amount > 0 && <div className="text-xs text-ink-400">{usd(-o.refunded_amount)}</div>}</td>
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
