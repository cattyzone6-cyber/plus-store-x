import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, MessageSquare, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi, useIsOwner } from '../lib/hooks';
import { usd, dt, label, ORDER_STATUS_TONE, DEPOSIT_STATUS_TONE } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, NumberInput, PageHeader, Stat, Switch, Table, Tabs, Textarea } from '../components/ui';
import type { User } from './Users';

interface Detail {
  user: User;
  orders: { id: number; code: string; product_name: string; quantity: number; total: number; status: string; created_at: string }[];
  deposits: { id: string; method: string; amount_usd: number; credited_amount: number | null; status: string; created_at: string }[];
  ledger: { id: number; amount: number; balance_after: number; type: string; note: string | null; ref_id: string | null; created_at: string }[];
  points: { id: number; delta: number; reason: string; ref_id: string | null; created_at: string }[];
  tickets: { id: number; kind: string; status: string; message: string | null; created_at: string }[];
  referrer: { id: number; username: string | null; first_name: string | null } | null;
  referrals: { id: number; username: string | null; first_name: string | null; total_deposited: number; joined_at: string }[];
}

export default function UserDetail() {
  const { id } = useParams();
  const owner = useIsOwner();
  const q = useApi<Detail>(`/users/${id}`);
  const { run, busy } = useAction();
  const [tab, setTab] = useState<'orders' | 'deposits' | 'ledger' | 'points' | 'referrals' | 'tickets'>('orders');
  const [bal, setBal] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [balNote, setBalNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [msg, setMsg] = useState(false);
  const [text, setText] = useState('');
  const [discount, setDiscount] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const u = d.user;
  const inv = [`/users/${id}`, '/users'];
  const patch = (body: Record<string, unknown>, success = 'Saved') => run('patch', () => api(`/users/${u.id}`, { method: 'PATCH', body }), { success, invalidate: inv });

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><Link to="/users" className="text-ink-400 hover:text-white"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link>{[u.first_name, u.last_name].filter(Boolean).join(' ') || u.id}{u.is_banned && <Badge tone="red">banned</Badge>}</span>}
        sub={<>{u.username && <a className="text-gold" href={`https://t.me/${u.username}`} target="_blank" rel="noreferrer">@{u.username}</a>} · ID <code>{u.id}</code> · joined {dt(u.joined_at)} · {u.lang.toUpperCase()}{u.blocked_bot && ' · blocked the bot'}</>}
        actions={<>
          <Button onClick={() => setMsg(true)}><MessageSquare className="h-4 w-4" /> Message</Button>
          {owner && <Button variant="primary" onClick={() => { setAmount(null); setBal(true); }}><Wallet className="h-4 w-4" /> Adjust balance</Button>}
          <Button variant={u.is_banned ? 'success' : 'danger'} loading={busy === 'patch'} onClick={() => {
            if (u.is_banned) void patch({ is_banned: false, ban_reason: null }, 'Unbanned');
            else { const reason = prompt('Ban reason (optional)'); if (reason !== null) void patch({ is_banned: true, ban_reason: reason || null }, 'Banned'); }
          }}><Ban className="h-4 w-4" /> {u.is_banned ? 'Unban' : 'Ban'}</Button>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Balance" value={usd(u.balance)} tone="gold" />
        <Stat label="Spent" value={usd(u.total_spent)} sub={`${u.orders_count} orders`} />
        <Stat label="Deposited" value={usd(u.total_deposited)} />
        <Stat label="Points" value={u.points} />
        <Stat label="Referrals" value={u.referrals_count} sub={`earned ${usd(u.referral_earned)}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Personal discount">
          <div className="flex items-end gap-2">
            <Field label="Discount %" className="flex-1" hint="Applied to every product (max with discount levels)"><NumberInput value={discount ?? u.discount_percent} onChange={setDiscount} disabled={!owner} /></Field>
            {owner && <Button variant="primary" disabled={discount == null} onClick={() => void patch({ discount_percent: discount ?? 0 }).then(() => setDiscount(null))}>Save</Button>}
          </div>
          {d.referrer && <p className="mt-3 text-sm text-ink-400">Referred by <Link className="text-gold" to={`/users/${d.referrer.id}`}>{d.referrer.first_name ?? d.referrer.id}</Link></p>}
          {u.ban_reason && <p className="mt-2 text-sm text-red-300">Ban reason: {u.ban_reason}</p>}
        </Card>
        <Card title="Admin note" actions={note !== null && <Button size="sm" variant="primary" onClick={() => void patch({ note: note || null }).then(() => setNote(null))}>Save</Button>}>
          <Textarea value={note ?? u.note ?? ''} onChange={(e) => setNote(e.target.value)} />
        </Card>
      </div>

      <div className="mt-4">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'orders', label: `Orders (${d.orders.length})` }, { value: 'deposits', label: 'Deposits' }, { value: 'ledger', label: 'Wallet ledger' },
          { value: 'points', label: 'Points' }, { value: 'referrals', label: `Referrals (${d.referrals.length})` }, { value: 'tickets', label: 'Tickets' },
        ]} />
        <Card>
          {tab === 'orders' && (
            <Table head={['Order', 'Product', 'Total', 'Status', 'Date']} empty={!d.orders.length}>
              {d.orders.map((o) => (
                <tr key={o.id}>
                  <td className="td"><Link className="font-mono text-xs text-gold" to={`/orders/${o.id}`}>{o.code}</Link></td>
                  <td className="td">{o.product_name} × {o.quantity}</td>
                  <td className="td">{usd(o.total)}</td>
                  <td className="td"><Badge tone={ORDER_STATUS_TONE[o.status]}>{label(o.status)}</Badge></td>
                  <td className="td text-xs text-ink-400">{dt(o.created_at)}</td>
                </tr>
              ))}
            </Table>
          )}
          {tab === 'deposits' && (
            <Table head={['Method', 'Amount', 'Credited', 'Status', 'Date']} empty={!d.deposits.length}>
              {d.deposits.map((x) => (
                <tr key={x.id}><td className="td">{label(x.method)}</td><td className="td">{usd(x.amount_usd)}</td><td className="td">{usd(x.credited_amount)}</td><td className="td"><Badge tone={DEPOSIT_STATUS_TONE[x.status]}>{x.status}</Badge></td><td className="td text-xs text-ink-400">{dt(x.created_at)}</td></tr>
              ))}
            </Table>
          )}
          {tab === 'ledger' && (
            <Table head={['Type', 'Amount', 'Balance after', 'Note', 'Date']} empty={!d.ledger.length}>
              {d.ledger.map((l) => (
                <tr key={l.id}><td className="td">{label(l.type)}</td><td className={`td ${l.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{usd(l.amount)}</td><td className="td">{usd(l.balance_after)}</td><td className="td text-xs text-ink-400">{l.note ?? l.ref_id}</td><td className="td text-xs text-ink-400">{dt(l.created_at)}</td></tr>
              ))}
            </Table>
          )}
          {tab === 'points' && (
            <Table head={['Reason', 'Points', 'Ref', 'Date']} empty={!d.points.length}>
              {d.points.map((p) => <tr key={p.id}><td className="td">{p.reason}</td><td className="td">{p.delta > 0 ? `+${p.delta}` : p.delta}</td><td className="td text-xs">{p.ref_id}</td><td className="td text-xs text-ink-400">{dt(p.created_at)}</td></tr>)}
            </Table>
          )}
          {tab === 'referrals' && (
            <Table head={['User', 'Deposited', 'Joined']} empty={!d.referrals.length}>
              {d.referrals.map((r) => <tr key={r.id}><td className="td"><Link className="hover:text-gold" to={`/users/${r.id}`}>{r.first_name ?? r.id}</Link>{r.username && <span className="ms-1 text-xs text-ink-400">@{r.username}</span>}</td><td className="td">{usd(r.total_deposited)}</td><td className="td text-xs text-ink-400">{dt(r.joined_at)}</td></tr>)}
            </Table>
          )}
          {tab === 'tickets' && (
            <Table head={['#', 'Kind', 'Message', 'Status', 'Date']} empty={!d.tickets.length}>
              {d.tickets.map((t) => <tr key={t.id}><td className="td"><Link className="text-gold" to={`/tickets?open=${t.id}`}>#{t.id}</Link></td><td className="td">{t.kind}</td><td className="td max-w-[300px] truncate">{t.message}</td><td className="td">{t.status}</td><td className="td text-xs text-ink-400">{dt(t.created_at)}</td></tr>)}
            </Table>
          )}
        </Card>
      </div>

      <Dialog open={bal} onClose={() => setBal(false)} title="Adjust balance"
        footer={<><Button onClick={() => setBal(false)}>Cancel</Button><Button variant="primary" disabled={!amount} loading={busy === 'bal'} onClick={() => void run('bal', () => api(`/users/${u.id}/balance`, { body: { amount, note: balNote || undefined, notify } }), { success: 'Balance updated', invalidate: inv }).then((r) => r && setBal(false))}>Apply</Button></>}>
        <div className="space-y-3">
          <Field label="Amount ($)" hint="Positive adds, negative removes"><NumberInput allowNull value={amount} onChange={setAmount} /></Field>
          <Field label="Reason"><Input value={balNote} onChange={(e) => setBalNote(e.target.value)} /></Field>
          <Switch checked={notify} onChange={setNotify} label="Notify the customer" />
        </div>
      </Dialog>

      <Dialog open={msg} onClose={() => setMsg(false)} title="Message customer"
        footer={<><Button onClick={() => setMsg(false)}>Cancel</Button><Button variant="primary" disabled={!text.trim()} loading={busy === 'msg'} onClick={() => void run('msg', () => api(`/users/${u.id}/message`, { body: { text } }), { success: 'Sent' }).then((r) => { if (r) { setMsg(false); setText(''); } })}>Send</Button></>}>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Sent by the bot as plain text" />
      </Dialog>
    </>
  );
}
