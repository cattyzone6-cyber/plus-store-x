import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, MessageSquare, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi, useIsOwner } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd, dt, label, ORDER_STATUS_TONE, DEPOSIT_STATUS_TONE } from '../lib/format';
import { ActionBar, Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, NumberInput, PageHeader, Stat, Switch, Table, Tabs, Textarea } from '../components/ui';
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
  const tx = useTx();
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
  const patch = (body: Record<string, unknown>, success = tx('Saved', 'تم الحفظ')) => run('patch', () => api(`/users/${u.id}`, { method: 'PATCH', body }), { success, invalidate: inv });

  const actions = <>
    <Button onClick={() => setMsg(true)}><MessageSquare className="h-4 w-4" /> {tx('Message', 'مراسلة')}</Button>
    {owner && <Button variant="primary" onClick={() => { setAmount(null); setBal(true); }}><Wallet className="h-4 w-4" /> {tx('Adjust balance', 'تعديل الرصيد')}</Button>}
    <Button variant={u.is_banned ? 'success' : 'danger'} loading={busy === 'patch'} onClick={() => {
      if (u.is_banned) void patch({ is_banned: false, ban_reason: null }, tx('Unbanned', 'أُلغي الحظر'));
      else { const reason = prompt(tx('Ban reason (optional)', 'سبب الحظر (اختياري)')); if (reason !== null) void patch({ is_banned: true, ban_reason: reason || null }, tx('Banned', 'تم الحظر')); }
    }}><Ban className="h-4 w-4" /> {u.is_banned ? tx('Unban', 'إلغاء الحظر') : tx('Ban', 'حظر')}</Button>
  </>;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2"><Link to="/users" aria-label={tx('Back', 'رجوع')} className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-800 hover:text-white"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link><span className="min-w-0 truncate">{[u.first_name, u.last_name].filter(Boolean).join(' ') || u.id}</span>{u.is_banned && <Badge tone="red">{tx('banned', 'محظور')}</Badge>}</span>}
        sub={<>
          {u.username && <a className="text-gold" dir="ltr" href={`https://t.me/${u.username}`} target="_blank" rel="noreferrer">@{u.username}</a>}
          {' · '}{tx('ID', 'الرقم')} <code dir="ltr">{u.id}</code> · {tx('joined', 'انضم')} {dt(u.joined_at)} · {u.lang.toUpperCase()}{u.blocked_bot && tx(' · blocked the bot', ' · حظر البوت')}
        </>}
        actions={<div className="hidden flex-wrap gap-2 sm:flex">{actions}</div>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={tx('Balance', 'الرصيد')} value={usd(u.balance)} tone="gold" />
        <Stat label={tx('Spent', 'الإنفاق')} value={usd(u.total_spent)} sub={tx(`${u.orders_count} orders`, `${u.orders_count} طلب`)} />
        <Stat label={tx('Deposited', 'الشحن')} value={usd(u.total_deposited)} />
        <Stat label={tx('Points', 'النقاط')} value={u.points} />
        <Stat label={tx('Referrals', 'الإحالات')} value={u.referrals_count} sub={tx(`earned ${usd(u.referral_earned)}`, `الربح ${usd(u.referral_earned)}`)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={tx('Personal discount', 'خصم شخصي')}>
          <div className="flex items-end gap-2">
            <Field label={tx('Discount %', 'الخصم %')} className="flex-1" hint={tx('Applied to every pack (max with discount levels)', 'يُطبّق على كل الباقات (الأعلى بينه وبين مستويات الخصم)')}><NumberInput dir="ltr" value={discount ?? u.discount_percent} onChange={setDiscount} disabled={!owner} /></Field>
            {owner && <Button variant="primary" disabled={discount == null} onClick={() => void patch({ discount_percent: discount ?? 0 }).then(() => setDiscount(null))}>{tx('Save', 'حفظ')}</Button>}
          </div>
          {d.referrer && <p className="mt-3 text-sm text-ink-400">{tx('Referred by', 'أحاله')} <Link className="text-gold" to={`/users/${d.referrer.id}`}>{d.referrer.first_name ?? d.referrer.id}</Link></p>}
          {u.ban_reason && <p className="mt-2 text-sm text-red-300">{tx('Ban reason:', 'سبب الحظر:')} {u.ban_reason}</p>}
        </Card>
        <Card title={tx('Admin note', 'ملاحظة الإدارة')} actions={note !== null && <Button size="sm" variant="primary" onClick={() => void patch({ note: note || null }).then(() => setNote(null))}>{tx('Save', 'حفظ')}</Button>}>
          <Textarea value={note ?? u.note ?? ''} onChange={(e) => setNote(e.target.value)} />
        </Card>
      </div>

      <div className="mt-4">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'orders', label: tx(`Orders (${d.orders.length})`, `الطلبات (${d.orders.length})`) }, { value: 'deposits', label: tx('Deposits', 'الشحنات') }, { value: 'ledger', label: tx('Wallet ledger', 'سجل المحفظة') },
          { value: 'points', label: tx('Points', 'النقاط') }, { value: 'referrals', label: tx(`Referrals (${d.referrals.length})`, `الإحالات (${d.referrals.length})`) }, { value: 'tickets', label: tx('Tickets', 'التذاكر') },
        ]} />
        <Card>
          {tab === 'orders' && (
            <Table head={[tx('Order', 'الطلب'), tx('Pack', 'الباقة'), tx('Total', 'الإجمالي'), tx('Status', 'الحالة'), tx('Date', 'التاريخ')]} empty={!d.orders.length}>
              {d.orders.map((o) => (
                <tr key={o.id}>
                  <td className="td whitespace-nowrap"><Link className="font-mono text-xs text-gold" dir="ltr" to={`/orders/${o.id}`}>{o.code}</Link></td>
                  <td className="td">{o.product_name} <span dir="ltr">× {o.quantity}</span></td>
                  <td className="td">{usd(o.total)}</td>
                  <td className="td"><Badge tone={ORDER_STATUS_TONE[o.status]}>{label(o.status)}</Badge></td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(o.created_at)}</td>
                </tr>
              ))}
            </Table>
          )}
          {tab === 'deposits' && (
            <Table head={[tx('Method', 'الطريقة'), tx('Amount', 'المبلغ'), tx('Credited', 'المضاف'), tx('Status', 'الحالة'), tx('Date', 'التاريخ')]} empty={!d.deposits.length}>
              {d.deposits.map((x) => (
                <tr key={x.id}><td className="td">{label(x.method)}</td><td className="td">{usd(x.amount_usd)}</td><td className="td">{usd(x.credited_amount)}</td><td className="td"><Badge tone={DEPOSIT_STATUS_TONE[x.status]}>{label(x.status)}</Badge></td><td className="td whitespace-nowrap text-xs text-ink-400">{dt(x.created_at)}</td></tr>
              ))}
            </Table>
          )}
          {tab === 'ledger' && (
            <Table head={[tx('Type', 'النوع'), tx('Amount', 'المبلغ'), tx('Balance after', 'الرصيد بعدها'), tx('Note', 'ملاحظة'), tx('Date', 'التاريخ')]} empty={!d.ledger.length}>
              {d.ledger.map((l) => (
                <tr key={l.id}><td className="td">{label(l.type)}</td><td className={`td ${l.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{usd(l.amount)}</td><td className="td">{usd(l.balance_after)}</td><td className="td text-xs text-ink-400">{l.note ?? <span dir="ltr">{l.ref_id}</span>}</td><td className="td whitespace-nowrap text-xs text-ink-400">{dt(l.created_at)}</td></tr>
              ))}
            </Table>
          )}
          {tab === 'points' && (
            <Table head={[tx('Reason', 'السبب'), tx('Points', 'النقاط'), tx('Ref', 'المرجع'), tx('Date', 'التاريخ')]} empty={!d.points.length}>
              {d.points.map((p) => <tr key={p.id}><td className="td">{label(p.reason)}</td><td className="td" dir="ltr">{p.delta > 0 ? `+${p.delta}` : p.delta}</td><td className="td text-xs" dir="ltr">{p.ref_id}</td><td className="td whitespace-nowrap text-xs text-ink-400">{dt(p.created_at)}</td></tr>)}
            </Table>
          )}
          {tab === 'referrals' && (
            <Table head={[tx('Customer', 'الزبون'), tx('Deposited', 'الشحن'), tx('Joined', 'الانضمام')]} empty={!d.referrals.length}>
              {d.referrals.map((r) => <tr key={r.id}><td className="td"><Link className="hover:text-gold" to={`/users/${r.id}`}>{r.first_name ?? r.id}</Link>{r.username && <span className="ms-1 text-xs text-ink-400" dir="ltr">@{r.username}</span>}</td><td className="td">{usd(r.total_deposited)}</td><td className="td whitespace-nowrap text-xs text-ink-400">{dt(r.joined_at)}</td></tr>)}
            </Table>
          )}
          {tab === 'tickets' && (
            <Table head={['#', tx('Kind', 'النوع'), tx('Message', 'الرسالة'), tx('Status', 'الحالة'), tx('Date', 'التاريخ')]} empty={!d.tickets.length}>
              {d.tickets.map((t) => <tr key={t.id}><td className="td"><Link className="text-gold" dir="ltr" to={`/tickets?open=${t.id}`}>#{t.id}</Link></td><td className="td">{label(t.kind)}</td><td className="td max-w-[300px] truncate">{t.message}</td><td className="td">{label(t.status)}</td><td className="td whitespace-nowrap text-xs text-ink-400">{dt(t.created_at)}</td></tr>)}
            </Table>
          )}
        </Card>
      </div>

      <ActionBar>{actions}</ActionBar>

      <Dialog open={bal} onClose={() => setBal(false)} title={tx('Adjust balance', 'تعديل الرصيد')}
        footer={<><Button onClick={() => setBal(false)}>{tx('Cancel', 'إلغاء')}</Button><Button variant="primary" disabled={!amount} loading={busy === 'bal'} onClick={() => void run('bal', () => api(`/users/${u.id}/balance`, { body: { amount, note: balNote || undefined, notify } }), { success: tx('Balance updated', 'تم تحديث الرصيد'), invalidate: inv }).then((r) => r && setBal(false))}>{tx('Apply', 'تطبيق')}</Button></>}>
        <div className="space-y-3">
          <Field label={tx('Amount ($)', 'المبلغ ($)')} hint={tx('Positive adds, negative removes', 'الموجب يضيف، والسالب يخصم')}><NumberInput dir="ltr" allowNull value={amount} onChange={setAmount} /></Field>
          <Field label={tx('Reason', 'السبب')}><Input value={balNote} onChange={(e) => setBalNote(e.target.value)} /></Field>
          <Switch checked={notify} onChange={setNotify} label={tx('Notify the customer', 'إشعار الزبون')} />
        </div>
      </Dialog>

      <Dialog open={msg} onClose={() => setMsg(false)} title={tx('Message customer', 'مراسلة الزبون')}
        footer={<><Button onClick={() => setMsg(false)}>{tx('Cancel', 'إلغاء')}</Button><Button variant="primary" disabled={!text.trim()} loading={busy === 'msg'} onClick={() => void run('msg', () => api(`/users/${u.id}/message`, { body: { text } }), { success: tx('Sent', 'تم الإرسال') }).then((r) => { if (r) { setMsg(false); setText(''); } })}>{tx('Send', 'إرسال')}</Button></>}>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('Sent by the bot as plain text', 'يرسلها البوت كنص عادي')} />
      </Dialog>
    </>
  );
}
