import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { usd, dt, label, ORDER_STATUS_TONE } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Loading, NumberInput, PageHeader, Pagination, Select, Table, Tabs, Textarea } from '../components/ui';
import type { Order } from './Orders';

interface Ticket {
  id: number; user_id: number; order_id: number | null; kind: string; message: string | null; status: string;
  resolution: string | null; resolution_note: string | null; refund_amount: number | null; created_at: string; resolved_at: string | null;
}

function TicketDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useApi<{ ticket: Ticket; user: { id: number; first_name: string | null; username: string | null } | null; order: Order | null }>(`/tickets/${id}`);
  const { run, busy } = useAction();
  const [resolution, setResolution] = useState('replaced');
  const [note, setNote] = useState('');
  const [items, setItems] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  useEffect(() => {
    if (q.data?.ticket) setResolution(q.data.ticket.kind === 'refund' ? 'refunded' : q.data.ticket.kind === 'support' ? 'answered' : 'replaced');
  }, [q.data?.ticket]);
  if (q.isLoading) return <Dialog open onClose={onClose} title={`Ticket #${id}`}><Loading /></Dialog>;
  if (q.error) return <Dialog open onClose={onClose} title={`Ticket #${id}`}><ErrorBox error={q.error} /></Dialog>;
  const { ticket: t, user, order } = q.data!;
  const open = t.status === 'open';
  const inWarranty = order?.warranty_until ? new Date(order.warranty_until) > new Date() : false;

  return (
    <Dialog open onClose={onClose} title={`Ticket #${t.id} — ${t.kind}`} wide
      footer={open ? <Button variant="primary" loading={busy === 'res'} onClick={() => void run('res', () => api(`/tickets/${t.id}/resolve`, {
        body: { resolution, note: note || undefined, replacement_text: resolution === 'replaced' ? items : undefined, refund_amount: resolution === 'refunded' ? amount ?? undefined : undefined },
      }), { success: 'Resolved — the customer was notified', invalidate: ['/tickets', '/dashboard'] }).then((r) => r && onClose())}>Resolve</Button> : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm">
          <div><span className="text-ink-400">Customer:</span> {user ? <Link className="text-gold" to={`/users/${user.id}`}>{user.first_name ?? user.id}{user.username ? ` (@${user.username})` : ''}</Link> : t.user_id}</div>
          <div><span className="text-ink-400">Opened:</span> {dt(t.created_at)}</div>
          <div className="whitespace-pre-wrap rounded-lg bg-ink-900 p-3">{t.message || <span className="text-ink-400">No message</span>}</div>
          {order && (
            <div className="rounded-lg border border-ink-700 p-3">
              <Link to={`/orders/${order.id}`} className="font-mono text-xs text-gold">{order.code}</Link> <Badge tone={ORDER_STATUS_TONE[order.status]}>{label(order.status)}</Badge>
              <div>{order.product_name} × {order.quantity} — {usd(order.total)}</div>
              <div className="text-xs text-ink-400">Warranty until {dt(order.warranty_until)} {inWarranty ? <Badge tone="green">in warranty</Badge> : <Badge tone="red">expired</Badge>}</div>
              {order.delivery.length > 0 && <pre className="mt-2 max-h-32 overflow-auto rounded bg-ink-900 p-2 text-xs">{order.delivery.join('\n')}</pre>}
            </div>
          )}
          {!open && <div className="text-ink-400">Resolved as <b>{t.resolution}</b> {t.resolution_note && `— ${t.resolution_note}`}</div>}
        </div>
        {open && (
          <div className="space-y-3">
            <Field label="Resolution">
              <Select value={resolution} onChange={(e) => setResolution(e.target.value)} options={[
                { value: 'replaced', label: 'Replace (send new items)' }, { value: 'refunded', label: 'Refund to wallet' },
                { value: 'answered', label: 'Answer (message only)' }, { value: 'rejected', label: 'Reject' },
              ]} />
            </Field>
            {resolution === 'replaced' && <Field label="Replacement items (one per line)" hint="Leave empty to take from stock automatically if available"><Textarea rows={5} value={items} onChange={(e) => setItems(e.target.value)} className="font-mono text-xs" /></Field>}
            {resolution === 'refunded' && <Field label="Refund amount ($)" hint="Empty = one unit price"><NumberInput allowNull value={amount} onChange={setAmount} /></Field>}
            <Field label="Message to customer"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default function Tickets() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const openId = params.get('open');
  const list = useApi<Paged<Ticket>>(`/tickets${qs({ status: status === 'open' ? 'open' : undefined, kind, page, limit: 30 })}`, { refetchInterval: 30_000 });

  return (
    <>
      <PageHeader title="Tickets" sub="Replacement requests (warranty), refund requests and support messages from the bot." />
      <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} tabs={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
      <Card>
        <Select className="mb-3 max-w-[200px]" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: 'All kinds' }, { value: 'replacement', label: 'Replacement' }, { value: 'refund', label: 'Refund' }, { value: 'support', label: 'Support' }]} />
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={['#', 'Kind', 'User', 'Order', 'Message', 'Status', 'Date', '']} empty={!list.data?.items.length}>
              {list.data!.items.map((t) => (
                <tr key={t.id}>
                  <td className="td">#{t.id}</td>
                  <td className="td"><Badge tone={t.kind === 'refund' ? 'red' : t.kind === 'replacement' ? 'gold' : 'blue'}>{t.kind}</Badge></td>
                  <td className="td"><Link className="text-xs hover:text-gold" to={`/users/${t.user_id}`}>{t.user_id}</Link></td>
                  <td className="td">{t.order_id ? <Link className="text-xs text-gold" to={`/orders/${t.order_id}`}>#{t.order_id}</Link> : '—'}</td>
                  <td className="td max-w-[280px] truncate">{t.message}</td>
                  <td className="td"><Badge tone={t.status === 'open' ? 'gold' : 'gray'}>{t.resolution ?? t.status}</Badge></td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(t.created_at)}</td>
                  <td className="td text-end"><Button size="sm" variant={t.status === 'open' ? 'primary' : 'ghost'} onClick={() => setParams({ open: String(t.id) })}>Open</Button></td>
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
