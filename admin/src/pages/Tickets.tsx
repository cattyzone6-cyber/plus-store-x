import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd, dt, label, ORDER_STATUS_TONE } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Loading, NumberInput, PageHeader, Pagination, Select, Table, Tabs, Textarea } from '../components/ui';
import type { Order } from './Orders';

interface Ticket {
  id: number; user_id: number; order_id: number | null; kind: string; message: string | null; status: string;
  resolution: string | null; resolution_note: string | null; refund_amount: number | null; created_at: string; resolved_at: string | null;
}

function TicketDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const tx = useTx();
  const q = useApi<{ ticket: Ticket; user: { id: number; first_name: string | null; username: string | null } | null; order: Order | null }>(`/tickets/${id}`);
  const { run, busy } = useAction();
  const [resolution, setResolution] = useState('replaced');
  const [note, setNote] = useState('');
  const [items, setItems] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  useEffect(() => {
    if (q.data?.ticket) setResolution(q.data.ticket.kind === 'refund' ? 'refunded' : q.data.ticket.kind === 'support' ? 'answered' : 'replaced');
  }, [q.data?.ticket]);
  const heading = <>{tx('Ticket', 'تذكرة')} <span dir="ltr">#{id}</span></>;
  if (q.isLoading) return <Dialog open onClose={onClose} title={heading}><Loading /></Dialog>;
  if (q.error) return <Dialog open onClose={onClose} title={heading}><ErrorBox error={q.error} /></Dialog>;
  const { ticket: t, user, order } = q.data!;
  const open = t.status === 'open';
  const inWarranty = order?.warranty_until ? new Date(order.warranty_until) > new Date() : false;

  return (
    <Dialog open onClose={onClose} title={<>{heading} — {label(t.kind)}</>} wide
      footer={open ? <Button variant="primary" loading={busy === 'res'} onClick={() => void run('res', () => api(`/tickets/${t.id}/resolve`, {
        body: { resolution, note: note || undefined, replacement_text: resolution === 'replaced' ? items : undefined, refund_amount: resolution === 'refunded' ? amount ?? undefined : undefined },
      }), { success: tx('Resolved — the customer was notified', 'تم الحل — وصل إشعار للزبون'), invalidate: ['/tickets', '/dashboard'] }).then((r) => r && onClose())}>{tx('Resolve', 'حل التذكرة')}</Button> : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm">
          <div><span className="text-ink-400">{tx('Customer:', 'الزبون:')}</span> {user ? <Link className="text-gold" to={`/users/${user.id}`}>{user.first_name ?? user.id}{user.username && <span dir="ltr"> (@{user.username})</span>}</Link> : <span dir="ltr">{t.user_id}</span>}</div>
          <div><span className="text-ink-400">{tx('Opened:', 'فُتحت:')}</span> {dt(t.created_at)}</div>
          <div dir="auto" className="whitespace-pre-wrap break-words rounded-lg bg-ink-900 p-3">{t.message || <span className="text-ink-400">{tx('No message', 'لا توجد رسالة')}</span>}</div>
          {order && (
            <div className="rounded-lg border border-ink-700 p-3">
              <Link to={`/orders/${order.id}`} dir="ltr" className="font-mono text-xs text-gold">{order.code}</Link> <Badge tone={ORDER_STATUS_TONE[order.status]}>{label(order.status)}</Badge>
              <div>{order.product_name} <span dir="ltr">× {order.quantity}</span> — {usd(order.total)}</div>
              <div className="text-xs text-ink-400">{tx('Warranty until', 'الضمان حتى')} {dt(order.warranty_until)} {inWarranty ? <Badge tone="green">{tx('in warranty', 'ضمن الضمان')}</Badge> : <Badge tone="red">{tx('expired', 'منتهي')}</Badge>}</div>
              {order.delivery.length > 0 && <pre dir="ltr" className="mt-2 max-h-32 overflow-auto rounded bg-ink-900 p-2 text-start text-xs">{order.delivery.join('\n')}</pre>}
            </div>
          )}
          {!open && <div className="text-ink-400">{tx('Resolved as', 'الحل:')} <b>{t.resolution ? label(t.resolution) : '—'}</b> {t.resolution_note && `— ${t.resolution_note}`}</div>}
        </div>
        {open && (
          <div className="space-y-3">
            <Field label={tx('Resolution', 'طريقة الحل')}>
              <Select value={resolution} onChange={(e) => setResolution(e.target.value)} options={[
                { value: 'replaced', label: tx('Replace (send new items)', 'استبدال (إرسال عناصر جديدة)') }, { value: 'refunded', label: tx('Refund to wallet', 'استرداد إلى المحفظة') },
                { value: 'answered', label: tx('Answer (message only)', 'رد (رسالة فقط)') }, { value: 'rejected', label: tx('Reject', 'رفض') },
              ]} />
            </Field>
            {resolution === 'replaced' && <Field label={tx('Replacement items (one per line)', 'العناصر البديلة (عنصر في كل سطر)')} hint={tx('Leave empty to take from stock automatically if available', 'اتركه فارغاً للأخذ من المخزون تلقائياً إن توفر')}><Textarea dir="ltr" rows={5} value={items} onChange={(e) => setItems(e.target.value)} className="font-mono text-xs" /></Field>}
            {resolution === 'refunded' && <Field label={tx('Refund amount ($)', 'مبلغ الاسترداد ($)')} hint={tx('Empty = one unit price', 'فارغ = سعر وحدة واحدة')}><NumberInput dir="ltr" allowNull value={amount} onChange={setAmount} /></Field>}
            <Field label={tx('Message to customer', 'رسالة للزبون')}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default function Tickets() {
  const tx = useTx();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const openId = params.get('open');
  const list = useApi<Paged<Ticket>>(`/tickets${qs({ status: status === 'open' ? 'open' : undefined, kind, page, limit: 30 })}`, { refetchInterval: 30_000 });

  return (
    <>
      <PageHeader title={tx('Tickets', 'التذاكر')} sub={tx('Replacement requests (warranty), refund requests and support messages from the bot.', 'طلبات الاستبدال (الضمان) وطلبات الاسترداد ورسائل الدعم من البوت.')} />
      <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} tabs={[{ value: 'open', label: tx('Open', 'مفتوحة') }, { value: 'all', label: tx('All', 'الكل') }]} />
      <Card>
        <Select className="mb-3 sm:max-w-[200px]" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: tx('All kinds', 'كل الأنواع') }, { value: 'replacement', label: label('replacement') }, { value: 'refund', label: label('refund') }, { value: 'support', label: label('support') }]} />
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={['#', tx('Kind', 'النوع'), tx('Customer', 'الزبون'), tx('Order', 'الطلب'), tx('Message', 'الرسالة'), tx('Status', 'الحالة'), tx('Date', 'التاريخ'), '']} empty={!list.data?.items.length}>
              {list.data!.items.map((t) => (
                <tr key={t.id}>
                  {/* the number opens the ticket too, so phones need no sideways scroll */}
                  <td className="td"><button type="button" dir="ltr" onClick={() => setParams({ open: String(t.id) })} className="text-gold hover:underline">#{t.id}</button></td>
                  <td className="td"><Badge tone={t.kind === 'refund' ? 'red' : t.kind === 'replacement' ? 'gold' : 'blue'}>{label(t.kind)}</Badge></td>
                  <td className="td"><Link className="text-xs hover:text-gold" dir="ltr" to={`/users/${t.user_id}`}>{t.user_id}</Link></td>
                  <td className="td">{t.order_id ? <Link className="text-xs text-gold" dir="ltr" to={`/orders/${t.order_id}`}>#{t.order_id}</Link> : '—'}</td>
                  <td className="td max-w-[280px] truncate" dir="auto">{t.message}</td>
                  <td className="td"><Badge tone={t.status === 'open' ? 'gold' : 'gray'}>{label(t.resolution ?? t.status)}</Badge></td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(t.created_at)}</td>
                  <td className="td text-end"><Button size="sm" variant={t.status === 'open' ? 'primary' : 'ghost'} onClick={() => setParams({ open: String(t.id) })}>{tx('Open', 'فتح')}</Button></td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} limit={list.data!.limit} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
      {openId && <TicketDialog id={Number(openId)} onClose={() => setParams({})} />}
    </>
  );
}
