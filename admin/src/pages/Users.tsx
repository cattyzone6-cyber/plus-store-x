import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../lib/api';
import { useApi, type Paged } from '../lib/hooks';
import { usd, dt, ago } from '../lib/format';
import { Badge, Card, ErrorBox, Input, Loading, PageHeader, Pagination, Select, Table } from '../components/ui';

export interface User {
  id: number; username: string | null; first_name: string | null; last_name: string | null; lang: string; balance: number; points: number;
  referrer_id: number | null; referral_earned: number; referrals_count: number; discount_percent: number; total_spent: number;
  total_deposited: number; orders_count: number; is_banned: boolean; ban_reason: string | null; blocked_bot: boolean;
  note: string | null; joined_at: string; last_seen_at: string;
}

export default function Users() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('joined_at');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi<Paged<User>>(`/users${qs({ q, sort, page, limit: 30, banned: filter === 'banned' ? 'true' : undefined, with_balance: filter === 'balance' ? 'true' : undefined })}`);

  return (
    <>
      <PageHeader title="Users" sub="Telegram customers" />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input placeholder="ID, @username or name…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select className="max-w-[200px]" value={sort} onChange={(e) => setSort(e.target.value)} options={[
            { value: 'joined_at', label: 'Newest' }, { value: 'last_seen_at', label: 'Recently active' }, { value: 'total_spent', label: 'Top spenders' },
            { value: 'balance', label: 'Highest balance' }, { value: 'orders_count', label: 'Most orders' },
          ]} />
          <Select className="max-w-[180px]" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} options={[{ value: '', label: 'Everyone' }, { value: 'balance', label: 'With balance' }, { value: 'banned', label: 'Banned' }]} />
        </div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={['User', 'Balance', 'Spent', 'Orders', 'Lang', 'Joined', 'Seen']} empty={!list.data?.items.length}>
              {list.data!.items.map((u) => (
                <tr key={u.id}>
                  <td className="td">
                    <Link to={`/users/${u.id}`} className="hover:text-gold">{[u.first_name, u.last_name].filter(Boolean).join(' ') || u.id}</Link>
                    <div className="text-xs text-ink-400">{u.username ? `@${u.username} · ` : ''}{u.id}</div>
                    <div className="flex gap-1">{u.is_banned && <Badge tone="red">banned</Badge>}{u.blocked_bot && <Badge>blocked bot</Badge>}{u.discount_percent > 0 && <Badge tone="gold">−{u.discount_percent}%</Badge>}</div>
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
