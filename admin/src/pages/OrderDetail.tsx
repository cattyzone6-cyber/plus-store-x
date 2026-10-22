import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PackageCheck, RotateCcw, Undo2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi, useIsOwner } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd, dt, label, ORDER_STATUS_TONE, DEPOSIT_STATUS_TONE } from '../lib/format';
import { ActionBar, Badge, Button, Card, Dialog, ErrorBox, Field, Loading, NumberInput, PageHeader, Table, Textarea } from '../components/ui';
import type { Order } from './Orders';

interface Attempt { id: number; status: string; provider_id: string | null; idempotency_key: string | null; request: unknown; response: unknown; error: string | null; created_at: string }

function Row({ k, children, strong }: { k: string; children: React.ReactNode; strong?: boolean }) {
  return <div className={`flex justify-between gap-3 ${strong ? 'font-semibold' : ''}`}><dt className={strong ? '' : 'text-ink-400'}>{k}</dt><dd className="text-end">{children}</dd></div>;
}

export default function OrderDetail() {
  const tx = useTx();
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

  const actions = <>
    {canDeliver && <Button variant="success" onClick={() => setDeliver(true)}><PackageCheck className="h-4 w-4" /> {tx('Deliver', 'تسليم')}</Button>}
    {canRetry && <Button loading={busy === 'retry'} onClick={() => { if (confirm(tx('Run automatic fulfilment again? Provider purchases are idempotent per order + source.', 'إعادة التنفيذ التلقائي؟ لن يُشترى من المزوّد مرتين لنفس الطلب والمصدر.'))) void run('retry', () => api(`/orders/${o.id}/retry`, { method: 'POST' }), { success: tx('Fulfilment restarted', 'أُعيد بدء التنفيذ'), invalidate: inv }); }}><RotateCcw className="h-4 w-4" /> {tx('Retry', 'إعادة')}</Button>}
    {canRefund && <Button variant="danger" onClick={() => { setAmount(null); setRefund(true); }}><Undo2 className="h-4 w-4" /> {tx('Refund', 'استرداد')}</Button>}
    {o.status === 'pending_payment' && <Button loading={busy === 'cancel'} onClick={() => void run('cancel', () => api(`/orders/${o.id}/cancel`, { method: 'POST' }), { success: tx('Cancelled', 'أُلغي الطلب'), invalidate: inv })}><XCircle className="h-4 w-4" /> {tx('Cancel', 'إلغاء')}</Button>}
  </>;
  const hasActions = canDeliver || canRetry || canRefund || o.status === 'pending_payment';

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2"><Link to="/orders" aria-label={tx('Back', 'رجوع')} className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-800 hover:text-white"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link><span className="font-mono" dir="ltr">{o.code}</span><Badge tone={ORDER_STATUS_TONE[o.status]}>{label(o.status)}</Badge></span>}
        sub={<>{o.product_name} <span dir="ltr">× {o.quantity}</span> · {dt(o.created_at)}</>}
        actions={<div className="hidden flex-wrap gap-2 sm:flex">{actions}</div>}
      />

      {o.error && <div className="mb-4"><ErrorBox error={o.error} /></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={tx('Payment', 'الدفع')} className="lg:col-span-1">
          <dl className="space-y-1.5 text-sm">
            <Row k={tx('Unit price', 'سعر الوحدة')}>{usd(o.unit_price)}</Row>
            {o.discount_amount > 0 && <Row k={tx('Promo', 'كود الخصم') + ' ' + (o.promo_code ?? '')}>{usd(-o.discount_amount)}</Row>}
            <Row k={tx('Total', 'الإجمالي')} strong><span className="text-gold">{usd(o.total)}</span></Row>
            {o.refunded_amount > 0 && <Row k={tx('Refunded', 'المسترد')}>{usd(o.refunded_amount)}</Row>}
            {owner && <Row k={tx('Cost', 'التكلفة')}>{usd(o.cost_total)}</Row>}
            {owner && o.cost_total != null && <Row k={tx('Profit', 'الربح')}>{usd(Number(o.total) - Number(o.refunded_amount) - Number(o.cost_total))}</Row>}
            <Row k={tx('Paid', 'تاريخ الدفع')}>{dt(o.paid_at)}</Row>
            <Row k={tx('Delivered', 'تاريخ التسليم')}>{dt(o.delivered_at)}</Row>
            <Row k={tx('Warranty until', 'الضمان حتى')}>{dt(o.warranty_until)}</Row>
            <Row k={tx('Points', 'النقاط')}>{o.points_awarded}</Row>
          </dl>
        </Card>
        <Card title={tx('Customer', 'الزبون')}>
          {user ? (
            <div className="space-y-1 text-sm">
              <Link to={`/users/${user.id}`} className="font-medium text-gold hover:underline">{user.first_name ?? user.id}</Link>
              {user.username && <div className="text-ink-400" dir="ltr">@{user.username}</div>}
              <div className="text-ink-400">{tx('ID', 'الرقم')} <span dir="ltr">{user.id}</span> · {tx('balance', 'الرصيد')} {usd(user.balance)}</div>
            </div>
          ) : '—'}
          {Object.keys(o.inputs ?? {}).length > 0 && (
            <div className="mt-4">
              <div className="label">{tx('Inputs', 'المدخلات')}</div>
              {Object.entries(o.inputs).map(([k, v]) => <div key={k} className="text-sm"><span className="text-ink-400">{k}:</span> <code className="break-all" dir="ltr">{Array.isArray(v) ? v.join(', ') : String(v)}</code></div>)}
            </div>
          )}
        </Card>
        <Card title={tx('Provider', 'المزوّد')}>
          <div className="space-y-1 text-sm">
            <div><span className="text-ink-400">{tx('Provider:', 'المزوّد:')}</span> {provider_name ?? '—'}</div>
            <div className="break-all"><span className="text-ink-400">{tx('Reference:', 'المرجع:')}</span> <code dir="ltr">{o.provider_order_ref ?? '—'}</code></div>
            <div><span className="text-ink-400">{tx('Status:', 'الحالة:')}</span> {o.provider_status ?? '—'}</div>
            <div><span className="text-ink-400">{tx('Channel:', 'القناة:')}</span> {label(o.channel)}</div>
          </div>
          {deposits.length > 0 && (
            <div className="mt-3">
              <div className="label">{tx('Deposits', 'الشحنات')}</div>
              {deposits.map((d) => <div key={d.id} className="flex justify-between gap-2 text-sm"><span>{label(d.method)} {usd(d.amount_usd)}</span><Badge tone={DEPOSIT_STATUS_TONE[d.status]}>{label(d.status)}</Badge></div>)}
            </div>
          )}
        </Card>
      </div>

      <Card title={tx(`Delivered items (${o.delivery.length})`, `العناصر المسلّمة (${o.delivery.length})`)} className="mt-4">
        {o.delivery.length === 0 ? <p className="text-sm text-ink-400">{tx('Nothing delivered yet.', 'لم يُسلَّم شيء بعد.')}</p> : (
          <pre dir="ltr" className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-900 p-3 text-start font-mono text-xs">{o.delivery.join('\n')}</pre>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={tx('Fulfilment attempts', 'محاولات التنفيذ')}>
          <Table head={[tx('When', 'الوقت'), tx('Status', 'الحالة'), tx('Error', 'الخطأ'), '']} empty={!attempts.length}>
            {attempts.map((a) => (
              <tr key={a.id}>
                <td className="td whitespace-nowrap text-xs">{dt(a.created_at)}</td>
                <td className="td"><Badge tone={a.status === 'success' ? 'green' : a.status === 'pending' ? 'purple' : 'red'}>{label(a.status)}</Badge></td>
                <td className="td max-w-[200px] truncate text-xs text-red-300" title={a.error ?? ''}>{a.error}</td>
                <td className="td text-end">{owner && <Button size="sm" variant="ghost" onClick={() => setShowAttempt(a)}>{tx('View', 'عرض')}</Button>}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={tx('Admin note', 'ملاحظة الإدارة')} actions={adminNote !== null && <Button size="sm" variant="primary" loading={busy === 'note'} onClick={() => void run('note', () => api(`/orders/${o.id}/note`, { body: { note: adminNote || null } }), { success: tx('Saved', 'تم الحفظ'), invalidate: [`/orders/${o.id}`] }).then(() => setAdminNote(null))}>{tx('Save', 'حفظ')}</Button>}>
          <Textarea value={adminNote ?? o.admin_note ?? ''} onChange={(e) => setAdminNote(e.target.value)} />
          {tickets.length > 0 && (
            <div className="mt-3">
              <div className="label">{tx('Tickets', 'التذاكر')}</div>
              {tickets.map((t) => <Link key={t.id} to={`/tickets?open=${t.id}`} className="block py-1 text-sm hover:text-gold"><span dir="ltr">#{t.id}</span> {label(t.kind)} — {label(t.status)}</Link>)}
            </div>
          )}
        </Card>
      </div>

      {hasActions && <ActionBar>{actions}</ActionBar>}

      <Dialog open={deliver} onClose={() => setDeliver(false)} title={tx(`Deliver ${o.code}`, `تسليم ${o.code}`)}
        footer={<><Button onClick={() => setDeliver(false)}>{tx('Cancel', 'إلغاء')}</Button><Button variant="success" loading={busy === 'deliver'} onClick={() => void run('deliver', () => api(`/orders/${o.id}/deliver`, { body: { text: items } }), { success: tx('Delivered — the customer was notified', 'تم التسليم — وصل إشعار للزبون'), invalidate: inv }).then((r) => { if (r) { setDeliver(false); setItems(''); } })}>{tx('Deliver', 'تسليم')}</Button></>}>
        <Field label={tx(`Items (one per line, ${o.quantity} expected)`, `العناصر (عنصر في كل سطر، المتوقع ${o.quantity})`)} hint={tx("Leave empty for activations with nothing to send — the customer gets a 'completed' message.", 'اتركه فارغاً للتفعيلات التي لا يوجد ما يُرسل فيها — يصل للزبون إشعار «تم التنفيذ».')}>
          <Textarea dir="ltr" rows={8} value={items} onChange={(e) => setItems(e.target.value)} className="font-mono text-xs" />
        </Field>
      </Dialog>

      <Dialog open={refund} onClose={() => setRefund(false)} title={tx(`Refund ${o.code}`, `استرداد ${o.code}`)}
        footer={<><Button onClick={() => setRefund(false)}>{tx('Cancel', 'إلغاء')}</Button><Button variant="danger" loading={busy === 'refund'} onClick={() => void run('refund', () => api(`/orders/${o.id}/refund`, { body: { amount, note: note || null } }), { success: tx('Refunded to wallet', 'أُعيد المبلغ إلى المحفظة'), invalidate: inv }).then((r) => r && setRefund(false))}>{tx('Refund', 'استرداد')}</Button></>}>
        <div className="space-y-3">
          <Field label={tx('Amount ($)', 'المبلغ ($)')} hint={tx(`Empty = everything left (${usd(Number(o.total) - Number(o.refunded_amount))})`, `فارغ = كامل المتبقي (${usd(Number(o.total) - Number(o.refunded_amount))})`)}><NumberInput dir="ltr" allowNull value={amount} onChange={setAmount} /></Field>
          <Field label={tx('Note to the customer (optional)', 'ملاحظة للزبون (اختياري)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </Dialog>

      {showAttempt && (
        <Dialog open onClose={() => setShowAttempt(null)} title={tx(`Attempt ${showAttempt.id}`, `المحاولة ${showAttempt.id}`)} wide>
          <div className="mb-2 break-all text-xs text-ink-400">{tx('Idempotency key:', 'مفتاح عدم التكرار:')} <code dir="ltr">{showAttempt.idempotency_key}</code></div>
          <div className="label">{tx('Request', 'الطلب')}</div>
          <pre dir="ltr" className="mb-3 max-h-60 overflow-auto rounded bg-ink-900 p-2 text-start text-xs">{JSON.stringify(showAttempt.request, null, 2)}</pre>
          <div className="label">{tx('Response', 'الرد')}</div>
          <pre dir="ltr" className="max-h-80 overflow-auto rounded bg-ink-900 p-2 text-start text-xs">{JSON.stringify(showAttempt.response, null, 2)}</pre>
        </Dialog>
      )}
    </>
  );
}
