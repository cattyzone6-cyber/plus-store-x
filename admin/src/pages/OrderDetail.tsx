import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PackageCheck, RotateCcw, Undo2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi, useIsOwner } from '../lib/hooks';
import { usd, dt, label, ORDER_STATUS_TONE, DEPOSIT_STATUS_TONE } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Loading, NumberInput, PageHeader, Table, Textarea } from '../components/ui';
import type { Order } from './Orders';

interface Attempt { id: number; status: string; provider_id: string | null; idempotency_key: string | null; request: unknown; response: unknown; error: string | null; created_at: string }

export default function OrderDetail() {
  const { id } = useParams();
  const owner = useIsOwner();
  const q = useApi<{ order: Order; provider_name: string | null; attempts: Attempt[]; user: { id: number; username: string | null; first_name: string | null; balance: number } | null; deposits: { id: string; method: string; amount_usd: number; status: string }[]; tickets: { id: number; kind: string; status: string; message: string | null }[] }>(`/orders/${id}`);
  const { run, busy } = useAction();
  const [deliver, setDeliver] = useState(false);
  const [refund, setRefund] = useState(false);
  const [items, setItems] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [adminNote, setAdminNote] = useState<string | null>(null);
  const [showAttempt, setShowAttempt] = useState<Attempt | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { order: o, attempts, user, deposits, tickets, provider_name } = q.data!;
  const inv = [`/orders`, '/dashboard', '/manual'];
  const canDeliver = ['manual_pending', 'failed', 'processing', 'awaiting_provider', 'paid'].includes(o.status);
  const canRefund = !!o.paid_at && Number(o.refunded_amount) < Number(o.total);
  const canRetry = ['failed', 'manual_pending', 'processing', 'awaiting_provider'].includes(o.status);

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><Link to="/orders" className="text-ink-400 hover:text-white"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link><span className="font-mono">{o.code}</span><Badge tone={ORDER_STATUS_TONE[o.status]}>{label(o.status)}</Badge></span>}
        sub={`${o.product_name} × ${o.quantity} · ${dt(o.created_at)}`}
        actions={<>
          {canDeliver && <Button variant="success" onClick={() => setDeliver(true)}><PackageCheck className="h-4 w-4" /> Deliver</Button>}
          {canRetry && <Button loading={busy === 'retry'} onClick={() => { if (confirm('Run automatic fulfilment again? Provider purchases are idempotent per order + source.')) void run('retry', () => api(`/orders/${o.id}/retry`, { method: 'POST' }), { success: 'Fulfilment restarted', invalidate: inv }); }}><RotateCcw className="h-4 w-4" /> Retry</Button>}
          {canRefund && <Button variant="danger" onClick={() => { setAmount(null); setRefund(true); }}><Undo2 className="h-4 w-4" /> Refund</Button>}
          {o.status === 'pending_payment' && <Button loading={busy === 'cancel'} onClick={() => void run('cancel', () => api(`/orders/${o.id}/cancel`, { method: 'POST' }), { success: 'Cancelled', invalidate: inv })}><XCircle className="h-4 w-4" /> Cancel</Button>}
        </>}
      />

      {o.error && <div className="mb-4"><ErrorBox error={o.error} /></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Payment" className="lg:col-span-1">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-ink-400">Unit price</dt><dd>{usd(o.unit_price)}</dd></div>
            {o.discount_amount > 0 && <div className="flex justify-between"><dt className="text-ink-400">Promo {o.promo_code}</dt><dd>−{usd(o.discount_amount)}</dd></div>}
            <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="text-gold">{usd(o.total)}</dd></div>
            {o.refunded_amount > 0 && <div className="flex justify-between"><dt className="text-ink-400">Refunded</dt><dd>{usd(o.refunded_amount)}</dd></div>}
            {owner && <div className="flex justify-between"><dt className="text-ink-400">Cost</dt><dd>{usd(o.cost_total)}</dd></div>}
            {owner && o.cost_total != null && <div className="flex justify-between"><dt className="text-ink-400">Profit</dt><dd>{usd(Number(o.total) - Number(o.refunded_amount) - Number(o.cost_total))}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-400">Paid</dt><dd>{dt(o.paid_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Delivered</dt><dd>{dt(o.delivered_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Warranty until</dt><dd>{dt(o.warranty_until)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Points</dt><dd>{o.points_awarded}</dd></div>
          </dl>
        </Card>
        <Card title="Customer">
          {user ? (
            <div className="space-y-1 text-sm">
              <Link to={`/users/${user.id}`} className="font-medium text-gold hover:underline">{user.first_name ?? user.id}</Link>
              {user.username && <div className="text-ink-400">@{user.username}</div>}
              <div className="text-ink-400">ID {user.id} · balance {usd(user.balance)}</div>
            </div>
          ) : '—'}
          {Object.keys(o.inputs ?? {}).length > 0 && (
            <div className="mt-4">
              <div className="label">Inputs</div>
              {Object.entries(o.inputs).map(([k, v]) => <div key={k} className="text-sm"><span className="text-ink-400">{k}:</span> <code className="break-all">{Array.isArray(v) ? v.join(', ') : String(v)}</code></div>)}
            </div>
          )}
        </Card>
        <Card title="Provider">
          <div className="space-y-1 text-sm">
            <div><span className="text-ink-400">Provider:</span> {provider_name ?? '—'}</div>
            <div><span className="text-ink-400">Reference:</span> <code>{o.provider_order_ref ?? '—'}</code></div>
            <div><span className="text-ink-400">Status:</span> {o.provider_status ?? '—'}</div>
            <div><span className="text-ink-400">Channel:</span> {o.channel}</div>
          </div>
          {deposits.length > 0 && (
            <div className="mt-3">
              <div className="label">Deposits</div>
              {deposits.map((d) => <div key={d.id} className="flex justify-between text-sm"><span>{label(d.method)} {usd(d.amount_usd)}</span><Badge tone={DEPOSIT_STATUS_TONE[d.status]}>{d.status}</Badge></div>)}
            </div>
          )}
        </Card>
      </div>

      <Card title={`Delivered items (${o.delivery.length})`} className="mt-4">
        {o.delivery.length === 0 ? <p className="text-sm text-ink-400">Nothing delivered yet.</p> : (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-900 p-3 font-mono text-xs">{o.delivery.join('\n')}</pre>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Fulfilment attempts">
          <Table head={['When', 'Status', 'Error', '']} empty={!attempts.length}>
            {attempts.map((a) => (
              <tr key={a.id}>
                <td className="td whitespace-nowrap text-xs">{dt(a.created_at)}</td>
                <td className="td"><Badge tone={a.status === 'success' ? 'green' : a.status === 'pending' ? 'purple' : 'red'}>{a.status}</Badge></td>
                <td className="td max-w-[200px] truncate text-xs text-red-300" title={a.error ?? ''}>{a.error}</td>
                <td className="td text-end">{owner && <Button size="sm" variant="ghost" onClick={() => setShowAttempt(a)}>View</Button>}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Admin note" actions={adminNote !== null && <Button size="sm" variant="primary" loading={busy === 'note'} onClick={() => void run('note', () => api(`/orders/${o.id}/note`, { body: { note: adminNote || null } }), { success: 'Saved', invalidate: [`/orders/${o.id}`] }).then(() => setAdminNote(null))}>Save</Button>}>
          <Textarea value={adminNote ?? o.admin_note ?? ''} onChange={(e) => setAdminNote(e.target.value)} />
          {tickets.length > 0 && (
            <div className="mt-3">
              <div className="label">Tickets</div>
              {tickets.map((t) => <Link key={t.id} to={`/tickets?open=${t.id}`} className="block text-sm hover:text-gold">#{t.id} {t.kind} — {t.status}</Link>)}
            </div>
          )}
        </Card>
      </div>

      <Dialog open={deliver} onClose={() => setDeliver(false)} title={`Deliver ${o.code}`}
        footer={<><Button onClick={() => setDeliver(false)}>Cancel</Button><Button variant="success" loading={busy === 'deliver'} onClick={() => void run('deliver', () => api(`/orders/${o.id}/deliver`, { body: { text: items } }), { success: 'Delivered — the customer was notified', invalidate: inv }).then((r) => { if (r) { setDeliver(false); setItems(''); } })}>Deliver</Button></>}>
        <Field label={`Items (one per line, ${o.quantity} expected)`} hint="Leave empty for activations with nothing to send — the customer gets a 'completed' message.">
          <Textarea rows={8} value={items} onChange={(e) => setItems(e.target.value)} className="font-mono text-xs" />
        </Field>
      </Dialog>

      <Dialog open={refund} onClose={() => setRefund(false)} title={`Refund ${o.code}`}
        footer={<><Button onClick={() => setRefund(false)}>Cancel</Button><Button variant="danger" loading={busy === 'refund'} onClick={() => void run('refund', () => api(`/orders/${o.id}/refund`, { body: { amount, note: note || null } }), { success: 'Refunded to wallet', invalidate: inv }).then((r) => r && setRefund(false))}>Refund</Button></>}>
        <div className="space-y-3">
          <Field label="Amount ($)" hint={`Empty = everything left (${usd(Number(o.total) - Number(o.refunded_amount))})`}><NumberInput allowNull value={amount} onChange={setAmount} /></Field>
          <Field label="Note to the customer (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </Dialog>

      {showAttempt && (
        <Dialog open onClose={() => setShowAttempt(null)} title={`Attempt ${showAttempt.id}`} wide>
          <div className="mb-2 text-xs text-ink-400">Idempotency key: <code>{showAttempt.idempotency_key}</code></div>
          <div className="label">Request</div>
          <pre className="mb-3 max-h-60 overflow-auto rounded bg-ink-900 p-2 text-xs">{JSON.stringify(showAttempt.request, null, 2)}</pre>
          <div className="label">Response</div>
          <pre className="max-h-80 overflow-auto rounded bg-ink-900 p-2 text-xs">{JSON.stringify(showAttempt.response, null, 2)}</pre>
        </Dialog>
      )}
    </>
  );
}
