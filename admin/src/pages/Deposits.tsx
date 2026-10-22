import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Image as ImageIcon, X } from 'lucide-react';
import { api, apiBlobUrl, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd, dt, label, DEPOSIT_STATUS_TONE } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, NumberInput, PageHeader, Pagination, Select, Spinner, Table, Tabs, Textarea } from '../components/ui';

interface Deposit {
  id: string; user_id: number; method: string; amount_usd: number; fee_usd: number; pay_amount: number | null; pay_currency: string | null;
  credited_amount: number | null; status: string; external_id: string | null; reference: string | null; pay_address: string | null;
  proof_file_id: string | null; proof_text: string | null; order_id: number | null; meta: Record<string, unknown>;
  expires_at: string | null; created_at: string; paid_at: string | null; review_note: string | null;
}

function Proof({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    apiBlobUrl(`/deposits/${id}/proof`).then((x) => { u = x; setUrl(x); }).catch((e) => setErr((e as Error).message));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id]);
  if (err) return <div className="text-xs text-red-300">{err}</div>;
  if (!url) return <Spinner />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="proof" className="max-h-[50vh] w-full rounded-lg object-contain" /></a>;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-ink-400">{k}</span><span className="text-end">{children}</span></div>;
}

function ReviewDialog({ d, onClose }: { d: Deposit; onClose: () => void }) {
  const tx = useTx();
  const { run, busy } = useAction();
  const [credit, setCredit] = useState<number | null>(Number(d.amount_usd));
  const [note, setNote] = useState('');
  const inv = ['/deposits', '/dashboard', '/users'];
  const pending = ['pending', 'confirming'].includes(d.status);
  return (
    <Dialog open onClose={onClose} title={<>{tx('Deposit', 'شحنة')} <span dir="ltr">{d.reference ?? d.id.slice(0, 8)}</span></>} wide
      footer={pending ? <>
        <Button variant="danger" loading={busy === 'reject'} onClick={() => void run('reject', () => api(`/deposits/${d.id}/reject`, { body: { note: note || undefined } }), { success: tx('Rejected', 'تم الرفض'), invalidate: inv }).then((r) => r && onClose())}><X className="h-4 w-4" /> {tx('Reject', 'رفض')}</Button>
        <Button variant="success" loading={busy === 'approve'} onClick={() => { if (confirm(tx(`Credit ${usd(credit)} to user ${d.user_id}?`, `إضافة ${usd(credit)} إلى محفظة الزبون ${d.user_id}؟`))) void run('approve', () => api(`/deposits/${d.id}/approve`, { body: { credit_usd: credit ?? undefined } }), { success: tx('Approved — wallet credited', 'تمت الموافقة — أُضيف الرصيد'), invalidate: inv }).then((r) => r && onClose()); }}><Check className="h-4 w-4" /> {tx('Approve', 'موافقة')}</Button>
      </> : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>{d.proof_file_id ? <Proof id={d.id} /> : <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-ink-700 text-sm text-ink-400"><ImageIcon className="me-2 h-4 w-4" /> {tx('No screenshot', 'لا توجد صورة')}</div>}</div>
        <div className="space-y-2 text-sm">
          <Row k={tx('Customer', 'الزبون')}><Link className="text-gold" dir="ltr" to={`/users/${d.user_id}`}>{d.user_id}</Link></Row>
          <Row k={tx('Method', 'الطريقة')}>{label(d.method)}</Row>
          <Row k={tx('Requested', 'المطلوب')}>{usd(d.amount_usd)}</Row>
          {d.pay_amount != null && <Row k={tx('To pay', 'المبلغ للدفع')}><span dir="ltr">{d.pay_amount} {d.pay_currency}</span></Row>}
          {d.proof_text && <div><span className="text-ink-400">{tx('Transaction ID / note', 'رقم العملية / ملاحظة')}</span><div dir="ltr" className="mt-1 break-all rounded bg-ink-900 p-2 text-start font-mono text-xs">{d.proof_text}</div></div>}
          {d.external_id && <Row k={tx('External', 'المعرّف الخارجي')}><code dir="ltr" className="break-all text-xs">{d.external_id}</code></Row>}
          {d.order_id && <Row k={tx('For order', 'للطلب')}><Link className="text-gold" dir="ltr" to={`/orders/${d.order_id}`}>#{d.order_id}</Link></Row>}
          <Row k={tx('Status', 'الحالة')}><Badge tone={DEPOSIT_STATUS_TONE[d.status]}>{label(d.status)}</Badge></Row>
          <Row k={tx('Created', 'أُنشئت')}>{dt(d.created_at)}</Row>
          {pending && (
            <>
              <Field label={tx('Credit to wallet ($)', 'المبلغ المضاف للمحفظة ($)')} hint={tx('Change it if the customer sent a different amount', 'عدّله إذا أرسل الزبون مبلغاً مختلفاً')}><NumberInput dir="ltr" value={credit} onChange={setCredit} /></Field>
              <Field label={tx('Reject reason (sent to customer)', 'سبب الرفض (يُرسل للزبون)')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </>
          )}
          {d.review_note && <div className="text-xs text-ink-400">{tx('Note:', 'ملاحظة:')} {d.review_note}</div>}
        </div>
      </div>
    </Dialog>
  );
}

export default function Deposits() {
  const tx = useTx();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'review' | 'all'>(params.get('review') ? 'review' : 'all');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Deposit | null>(null);
  const list = useApi<Paged<Deposit>>(`/deposits${qs({ review: tab === 'review' ? 'true' : undefined, status, method, q, page, limit: 30 })}`, { refetchInterval: tab === 'review' ? 20_000 : undefined });

  return (
    <>
      <PageHeader title={tx('Deposits', 'الشحنات')} sub={tx('Wallet top-ups. Crypto deposits confirm automatically; ShamCash needs review.', 'شحن المحافظ. شحنات العملات الرقمية تتأكد تلقائياً، وشام كاش تحتاج مراجعة.')} />
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} tabs={[{ value: 'review', label: tx('To review', 'للمراجعة') }, { value: 'all', label: tx('All deposits', 'كل الشحنات') }]} />
      <Card>
        {tab === 'all' && (
          <div className="mb-3 grid gap-2 sm:flex sm:flex-wrap">
            <Input placeholder={tx('User id, reference, tx id…', 'رقم الزبون، المرجع، رقم العملية…')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="sm:max-w-xs" />
            <div className="grid grid-cols-2 gap-2 sm:contents">
              <Select className="sm:max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: tx('Any status', 'كل الحالات') }, ...['pending', 'confirming', 'paid', 'expired', 'rejected', 'cancelled', 'failed'].map((s) => ({ value: s, label: label(s) }))]} />
              <Select className="sm:max-w-[180px]" value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: '', label: tx('Any method', 'كل الطرق') }, ...['binance_pay', 'binance_id', 'nowpayments', 'shamcash', 'admin'].map((s) => ({ value: s, label: label(s) }))]} />
            </div>
          </div>
        )}
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={[tx('Reference', 'المرجع'), tx('Customer', 'الزبون'), tx('Method', 'الطريقة'), tx('Amount', 'المبلغ'), tx('Status', 'الحالة'), tx('Created', 'التاريخ'), '']} empty={!list.data?.items.length}>
              {list.data!.items.map((d) => (
                <tr key={d.id}>
                  {/* the reference opens the review too, so phones need no sideways scroll to reach the button */}
                  <td className="td whitespace-nowrap"><button type="button" dir="ltr" onClick={() => setOpen(d)} className="font-mono text-xs text-gold hover:underline">{d.reference ?? d.id.slice(0, 8)}</button>{d.proof_file_id && <ImageIcon className="ms-1 inline h-3.5 w-3.5 text-gold" />}</td>
                  <td className="td"><Link to={`/users/${d.user_id}`} dir="ltr" className="text-xs hover:text-gold">{d.user_id}</Link></td>
                  <td className="td">{label(d.method)}</td>
                  <td className="td whitespace-nowrap">{usd(d.amount_usd)}{d.credited_amount != null && Number(d.credited_amount) !== Number(d.amount_usd) && <div className="text-xs text-ink-400">{tx('credited', 'أُضيف')} {usd(d.credited_amount)}</div>}</td>
                  <td className="td"><Badge tone={DEPOSIT_STATUS_TONE[d.status]}>{label(d.status)}</Badge></td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(d.created_at)}</td>
                  <td className="td text-end"><Button size="sm" variant={tab === 'review' ? 'primary' : 'ghost'} onClick={() => setOpen(d)}>{tab === 'review' ? tx('Review', 'مراجعة') : tx('Open', 'فتح')}</Button></td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} limit={list.data!.limit} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
      {open && <ReviewDialog d={open} onClose={() => setOpen(null)} />}
    </>
  );
}
