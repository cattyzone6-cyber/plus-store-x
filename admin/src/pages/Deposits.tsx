import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Image as ImageIcon, X } from 'lucide-react';
import { api, apiBlobUrl, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
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

function ReviewDialog({ d, onClose }: { d: Deposit; onClose: () => void }) {
  const { run, busy } = useAction();
  const [credit, setCredit] = useState<number | null>(Number(d.amount_usd));
  const [note, setNote] = useState('');
  const inv = ['/deposits', '/dashboard', '/users'];
  const pending = ['pending', 'confirming'].includes(d.status);
  return (
    <Dialog open onClose={onClose} title={`Deposit ${d.reference ?? d.id.slice(0, 8)}`} wide
      footer={pending ? <>
        <Button variant="danger" loading={busy === 'reject'} onClick={() => void run('reject', () => api(`/deposits/${d.id}/reject`, { body: { note: note || undefined } }), { success: 'Rejected', invalidate: inv }).then((r) => r && onClose())}><X className="h-4 w-4" /> Reject</Button>
        <Button variant="success" loading={busy === 'approve'} onClick={() => { if (confirm(`Credit ${usd(credit)} to user ${d.user_id}?`)) void run('approve', () => api(`/deposits/${d.id}/approve`, { body: { credit_usd: credit ?? undefined } }), { success: 'Approved — wallet credited', invalidate: inv }).then((r) => r && onClose()); }}><Check className="h-4 w-4" /> Approve</Button>
      </> : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>{d.proof_file_id ? <Proof id={d.id} /> : <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-ink-700 text-sm text-ink-400"><ImageIcon className="me-2 h-4 w-4" /> No screenshot</div>}</div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-ink-400">User</span><Link className="text-gold" to={`/users/${d.user_id}`}>{d.user_id}</Link></div>
          <div className="flex justify-between"><span className="text-ink-400">Method</span><span>{label(d.method)}</span></div>
          <div className="flex justify-between"><span className="text-ink-400">Requested</span><span>{usd(d.amount_usd)}</span></div>
          {d.pay_amount != null && <div className="flex justify-between"><span className="text-ink-400">To pay</span><span>{d.pay_amount} {d.pay_currency}</span></div>}
          {d.proof_text && <div><span className="text-ink-400">Transaction ID / note</span><div className="mt-1 break-all rounded bg-ink-900 p-2 font-mono text-xs">{d.proof_text}</div></div>}
          {d.external_id && <div className="flex justify-between"><span className="text-ink-400">External</span><code className="text-xs">{d.external_id}</code></div>}
          {d.order_id && <div className="flex justify-between"><span className="text-ink-400">For order</span><Link className="text-gold" to={`/orders/${d.order_id}`}>#{d.order_id}</Link></div>}
          <div className="flex justify-between"><span className="text-ink-400">Status</span><Badge tone={DEPOSIT_STATUS_TONE[d.status]}>{d.status}</Badge></div>
          <div className="flex justify-between"><span className="text-ink-400">Created</span><span>{dt(d.created_at)}</span></div>
          {pending && (
            <>
              <Field label="Credit to wallet ($)" hint="Change it if the customer sent a different amount"><NumberInput value={credit} onChange={setCredit} /></Field>
              <Field label="Reject reason (sent to customer)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </>
          )}
          {d.review_note && <div className="text-xs text-ink-400">Note: {d.review_note}</div>}
        </div>
      </div>
    </Dialog>
  );
}

export default function Deposits() {
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
      <PageHeader title="Deposits" sub="Wallet top-ups. Crypto deposits confirm automatically; ShamCash needs review." />
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} tabs={[{ value: 'review', label: 'To review' }, { value: 'all', label: 'All deposits' }]} />
      <Card>
        {tab === 'all' && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Input placeholder="User id, reference, tx id…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
            <Select className="max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Any status' }, ...['pending', 'confirming', 'paid', 'expired', 'rejected', 'cancelled', 'failed'].map((s) => ({ value: s, label: s }))]} />
            <Select className="max-w-[180px]" value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: '', label: 'Any method' }, ...['binance_pay', 'binance_id', 'nowpayments', 'shamcash', 'admin'].map((s) => ({ value: s, label: label(s) }))]} />
          </div>
        )}
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={['Reference', 'User', 'Method', 'Amount', 'Status', 'Created', '']} empty={!list.data?.items.length}>
              {list.data!.items.map((d) => (
                <tr key={d.id}>
                  <td className="td font-mono text-xs">{d.reference ?? d.id.slice(0, 8)}{d.proof_file_id && <ImageIcon className="ms-1 inline h-3.5 w-3.5 text-gold" />}</td>
                  <td className="td"><Link to={`/users/${d.user_id}`} className="text-xs hover:text-gold">{d.user_id}</Link></td>
                  <td className="td">{label(d.method)}</td>
                  <td className="td whitespace-nowrap">{usd(d.amount_usd)}{d.credited_amount != null && Number(d.credited_amount) !== Number(d.amount_usd) && <div className="text-xs text-ink-400">credited {usd(d.credited_amount)}</div>}</td>
                  <td className="td"><Badge tone={DEPOSIT_STATUS_TONE[d.status]}>{d.status}</Badge></td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(d.created_at)}</td>
                  <td className="td text-end"><Button size="sm" variant={tab === 'review' ? 'primary' : 'ghost'} onClick={() => setOpen(d)}>{tab === 'review' ? 'Review' : 'Open'}</Button></td>
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
