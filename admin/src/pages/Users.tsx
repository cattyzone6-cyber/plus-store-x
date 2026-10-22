import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../lib/api';
import { useApi, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd, dt, ago } from '../lib/format';
import { Badge, Card, ErrorBox, Input, Loading, PageHeader, Pagination, Select, Table } from '../components/ui';

export interface User {
  id: number; username: string | null; first_name: string | null; last_name: string | null; lang: string; balance: number; points: number;
  referrer_id: number | null; referral_earned: number; referrals_count: number; discount_percent: number; total_spent: number;
  total_deposited: number; orders_count: number; is_banned: boolean; ban_reason: string | null; blocked_bot: boolean;
  note: string | null; joined_at: string; last_seen_at: string;
}

export default function Users() {
  const tx = useTx();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('joined_at');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi<Paged<User>>(`/users${qs({ q, sort, page, limit: 30, banned: filter === 'banned' ? 'true' : undefined, with_balance: filter === 'balance' ? 'true' : undefined })}`);

  return (
    <>
      <PageHeader title={tx('Customers', 'الزبائن')} sub={tx('Telegram customers', 'زبائن تيليجرام')} />
      <Card>
        <div className="mb-3 grid gap-2 sm:flex sm:flex-wrap">
          <Input placeholder={tx('ID, @username or name…', 'الرقم أو @المعرّف أو الاسم…')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="sm:max-w-xs" />
          <div className="grid grid-cols-2 gap-2 sm:contents">
            <Select className="sm:max-w-[200px]" value={sort} onChange={(e) => setSort(e.target.value)} options={[
              { value: 'joined_at', label: tx('Newest', 'الأحدث') }, { value: 'last_seen_at', label: tx('Recently active', 'نشط مؤخراً') }, { value: 'total_spent', label: tx('Top spenders', 'الأكثر إنفاقاً') },
              { value: 'balance', label: tx('Highest balance', 'الأعلى رصيداً') }, { value: 'orders_count', label: tx('Most orders', 'الأكثر طلبات') },
            ]} />
            <Select className="sm:max-w-[180px]" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} options={[{ value: '', label: tx('Everyone', 'الجميع') }, { value: 'balance', label: tx('With balance', 'لديهم رصيد') }, { value: 'banned', label: tx('Banned', 'محظورون') }]} />
          </div>
        </div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={[tx('Customer', 'الزبون'), tx('Balance', 'الرصيد'), tx('Spent', 'الإنفاق'), tx('Orders', 'الطلبات'), tx('Lang', 'اللغة'), tx('Joined', 'الانضمام'), tx('Seen', 'آخر ظهور')]} empty={!list.data?.items.length}>
              {list.data!.items.map((u) => (
                <tr key={u.id}>
                  <td className="td max-w-[220px]">
                    <Link to={`/users/${u.id}`} className="block truncate hover:text-gold">{[u.first_name, u.last_name].filter(Boolean).join(' ') || u.id}</Link>
                    <div className="truncate text-xs text-ink-400" dir="ltr">{u.username ? `@${u.username} · ` : ''}{u.id}</div>
                    <div className="flex gap-1">{u.is_banned && <Badge tone="red">{tx('banned', 'محظور')}</Badge>}{u.blocked_bot && <Badge>{tx('blocked bot', 'حظر البوت')}</Badge>}{u.discount_percent > 0 && <Badge tone="gold"><span dir="ltr">−{u.discount_percent}%</span></Badge>}</div>
                  </td>
                  <td className="td">{usd(u.balance)}</td>
                  <td className="td">{usd(u.total_spent)}</td>
                  <td className="td">{u.orders_count}</td>
                  <td className="td uppercase text-xs">{u.lang}</td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(u.joined_at)}</td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{ago(u.last_seen_at)}</td>
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
