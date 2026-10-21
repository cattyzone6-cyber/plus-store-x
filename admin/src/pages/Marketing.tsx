import { useState, type ReactNode } from 'react';
import { Pencil, Plus, Trash2, Wand2, Flag, Users } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { usd, dt, fromLocalInput, toLocalInput } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, NumberInput, PageHeader, Pagination, Select, Switch, Table, Textarea } from '../components/ui';

type Row = Record<string, unknown> & { id: string };
type FieldType = 'text' | 'number' | 'textarea' | 'switch' | 'select' | 'datetime' | 'targets';
interface FieldDef { key: string; label: string; type: FieldType; options?: { value: string; label: string }[]; hint?: string; rtl?: boolean; full?: boolean; showIf?: (r: Row) => boolean; nullable?: boolean }
interface KindDef { title: string; sub: string; path: string; fields: FieldDef[]; defaults: Record<string, unknown>; columns: { label: string; render: (r: Row) => ReactNode }[] }

const KINDS: Record<'promos' | 'redeem' | 'giveaways' | 'freebies', KindDef> = {
  promos: {
    title: 'Promo codes', sub: 'Checkout discounts customers type before paying.', path: '/promo-codes',
    defaults: { kind: 'percent', value: 10, scope: 'all', target_ids: [], min_order: 0, per_user_limit: 1, is_active: true },
    fields: [
      { key: 'code', label: 'Code', type: 'text', hint: 'Letters, numbers, - and _' },
      { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'percent', label: 'Percent %' }, { value: 'fixed', label: 'Fixed $' }] },
      { key: 'value', label: 'Value', type: 'number' },
      { key: 'min_order', label: 'Min order ($)', type: 'number' },
      { key: 'scope', label: 'Applies to', type: 'select', options: [{ value: 'all', label: 'Everything' }, { value: 'category', label: 'Some categories' }, { value: 'product', label: 'Some products' }] },
      { key: 'target_ids', label: 'Targets', type: 'targets', showIf: (r) => r.scope !== 'all', full: true },
      { key: 'max_uses', label: 'Max uses (total)', type: 'number', nullable: true, hint: 'Empty = unlimited' },
      { key: 'per_user_limit', label: 'Uses per customer', type: 'number', hint: '0 = unlimited' },
      { key: 'starts_at', label: 'Starts', type: 'datetime' },
      { key: 'expires_at', label: 'Expires', type: 'datetime' },
      { key: 'note', label: 'Internal note', type: 'text', full: true },
      { key: 'is_active', label: 'Active', type: 'switch' },
    ],
    columns: [
      { label: 'Code', render: (r) => <code className="text-gold">{String(r.code)}</code> },
      { label: 'Discount', render: (r) => (r.kind === 'percent' ? `${r.value}%` : usd(r.value as number)) },
      { label: 'Scope', render: (r) => String(r.scope) },
      { label: 'Uses', render: (r) => `${r.uses}${r.max_uses ? ` / ${r.max_uses}` : ''}` },
      { label: 'Expires', render: (r) => dt(r.expires_at as string) },
      { label: 'Status', render: (r) => (r.is_active ? <Badge tone="green">active</Badge> : <Badge>off</Badge>) },
    ],
  },
  redeem: {
    title: 'Redeem codes', sub: 'Gift codes that add balance to the customer wallet (/redeem).', path: '/redeem-codes',
    defaults: { amount: 5, max_uses: 1, is_active: true },
    fields: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'amount', label: 'Amount ($)', type: 'number' },
      { key: 'max_uses', label: 'Max uses', type: 'number', hint: 'Each customer can use a code once' },
      { key: 'expires_at', label: 'Expires', type: 'datetime' },
      { key: 'note', label: 'Internal note', type: 'text', full: true },
      { key: 'is_active', label: 'Active', type: 'switch' },
    ],
    columns: [
      { label: 'Code', render: (r) => <code className="text-gold">{String(r.code)}</code> },
      { label: 'Amount', render: (r) => usd(r.amount as number) },
      { label: 'Uses', render: (r) => `${r.uses} / ${r.max_uses}` },
      { label: 'Expires', render: (r) => dt(r.expires_at as string) },
      { label: 'Note', render: (r) => <span className="text-xs text-ink-400">{String(r.note ?? '')}</span> },
      { label: 'Status', render: (r) => (r.is_active ? <Badge tone="green">active</Badge> : <Badge>off</Badge>) },
    ],
  },
  giveaways: {
    title: 'Giveaways', sub: 'Customers join from the bot; winners are drawn automatically when it ends.', path: '/giveaways',
    defaults: { prize_type: 'balance', prize_amount: 5, winners_count: 1, min_spent: 0, status: 'active', ends_at: new Date(Date.now() + 3 * 86400_000).toISOString() },
    fields: [
      { key: 'title_en', label: 'Title (EN)', type: 'text' },
      { key: 'title_ar', label: 'Title (AR)', type: 'text', rtl: true },
      { key: 'description_en', label: 'Description (EN)', type: 'textarea' },
      { key: 'description_ar', label: 'Description (AR)', type: 'textarea', rtl: true },
      { key: 'prize_type', label: 'Prize', type: 'select', options: [{ value: 'balance', label: 'Wallet balance' }, { value: 'text', label: 'Text (code / account)' }] },
      { key: 'prize_amount', label: 'Prize amount ($)', type: 'number', showIf: (r) => r.prize_type === 'balance', nullable: true },
      { key: 'prize_text', label: 'Prize text', type: 'textarea', showIf: (r) => r.prize_type === 'text', hint: 'Sent to every winner' },
      { key: 'winners_count', label: 'Winners', type: 'number' },
      { key: 'min_spent', label: 'Min spent to join ($)', type: 'number' },
      { key: 'ends_at', label: 'Ends', type: 'datetime' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'ended', label: 'Ended' }, { value: 'cancelled', label: 'Cancelled' }] },
    ],
    columns: [
      { label: 'Title', render: (r) => String(r.title_en) },
      { label: 'Prize', render: (r) => (r.prize_type === 'balance' ? usd(r.prize_amount as number) : 'text') },
      { label: 'Winners', render: (r) => String(r.winners_count) },
      { label: 'Ends', render: (r) => dt(r.ends_at as string) },
      { label: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{String(r.status)}</Badge> },
    ],
  },
  freebies: {
    title: 'Freebies', sub: 'Free resources customers can open from the bot.', path: '/freebies',
    defaults: { is_active: true, sort: 0 },
    fields: [
      { key: 'title_en', label: 'Title (EN)', type: 'text' },
      { key: 'title_ar', label: 'Title (AR)', type: 'text', rtl: true },
      { key: 'content_en', label: 'Content (EN)', type: 'textarea', hint: 'Telegram HTML: links, <b>, <code>…' },
      { key: 'content_ar', label: 'Content (AR)', type: 'textarea', rtl: true },
      { key: 'sort', label: 'Sort', type: 'number' },
      { key: 'is_active', label: 'Active', type: 'switch' },
    ],
    columns: [
      { label: 'Title', render: (r) => String(r.title_en) },
      { label: 'Claims', render: (r) => String(r.claims ?? 0) },
      { label: 'Sort', render: (r) => String(r.sort) },
      { label: 'Status', render: (r) => (r.is_active ? <Badge tone="green">active</Badge> : <Badge>off</Badge>) },
    ],
  },
};

function Targets({ scope, value, onChange }: { scope: string; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const cats = useApi<{ categories: { id: string; name_en: string }[] }>(scope === 'category' ? '/categories' : null);
  const prods = useApi<Paged<{ id: string; name_en: string }>>(scope === 'product' ? `/products${qs({ q, limit: 100 })}` : null);
  const items = scope === 'category' ? cats.data?.categories ?? [] : prods.data?.items ?? [];
  return (
    <div>
      {scope === 'product' && <Input placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />}
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-ink-700 p-2">
        {items.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(i.id)} onChange={(e) => onChange(e.target.checked ? [...value, i.id] : value.filter((x) => x !== i.id))} />
            {i.name_en}
          </label>
        ))}
      </div>
      <div className="mt-1 text-xs text-ink-400">{value.length} selected</div>
    </div>
  );
}

function EditDialog({ def, row, onClose }: { def: KindDef; row: Row | null; onClose: () => void }) {
  const [f, setF] = useState<Row>((row ?? { ...def.defaults, id: '' }) as Row);
  const { run, busy } = useAction();
  const save = async () => {
    const payload: Record<string, unknown> = {};
    for (const fd of def.fields) {
      let v = f[fd.key];
      if (fd.type === 'text' || fd.type === 'textarea') v = typeof v === 'string' && v.trim() !== '' ? v : fd.key === 'code' ? v : null;
      if (v === undefined) continue;
      if (v === null && ['code', 'title_en', 'content_en', 'ends_at'].includes(fd.key)) continue;
      payload[fd.key] = v;
    }
    const ok = await run('save', () => row ? api(`${def.path}/${row.id}`, { method: 'PATCH', body: payload }) : api(def.path, { body: payload }), { success: 'Saved', invalidate: [def.path] });
    if (ok) onClose();
  };
  return (
    <Dialog open onClose={onClose} title={row ? `Edit` : `New`} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy === 'save'} onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {def.fields.filter((fd) => !fd.showIf || fd.showIf(f)).map((fd) => {
          const v = f[fd.key];
          const set = (nv: unknown) => setF({ ...f, [fd.key]: nv });
          let input: ReactNode;
          switch (fd.type) {
            case 'number': input = <NumberInput allowNull={fd.nullable} value={(v as number | null) ?? null} onChange={set} />; break;
            case 'textarea': input = <Textarea dir={fd.rtl ? 'rtl' : undefined} value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} />; break;
            case 'switch': input = <Switch checked={!!v} onChange={set} />; break;
            case 'select': input = <Select value={String(v ?? '')} onChange={(e) => set(e.target.value)} options={fd.options ?? []} />; break;
            case 'datetime': input = <Input type="datetime-local" value={toLocalInput(v as string)} onChange={(e) => set(fromLocalInput(e.target.value))} />; break;
            case 'targets': input = <Targets scope={String(f.scope)} value={(v as string[]) ?? []} onChange={set} />; break;
            default: input = <Input dir={fd.rtl ? 'rtl' : undefined} value={(v as string) ?? ''} onChange={(e) => set(fd.key === 'code' ? e.target.value.toUpperCase() : e.target.value)} />;
          }
          return <Field key={fd.key} label={fd.label} hint={fd.hint} className={fd.full || fd.type === 'textarea' ? 'sm:col-span-2' : ''}>{input}</Field>;
        })}
      </div>
    </Dialog>
  );
}

function GenerateDialog({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState<number | null>(10);
  const [amount, setAmount] = useState<number | null>(5);
  const [prefix, setPrefix] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const { run, busy } = useAction();
  return (
    <Dialog open onClose={onClose} title="Generate redeem codes" footer={!codes && <Button variant="primary" loading={busy === 'gen'} onClick={async () => {
      const r = await run('gen', () => api<{ codes: string[] }>('/redeem-codes/generate', { body: { count, amount, prefix } }), { success: 'Generated', invalidate: ['/redeem-codes'] });
      if (r) setCodes(r.codes);
    }}>Generate</Button>}>
      {codes ? (
        <>
          <Textarea rows={12} readOnly value={codes.join('\n')} className="font-mono text-xs" />
          <Button className="mt-2" onClick={() => void navigator.clipboard.writeText(codes.join('\n'))}>Copy all</Button>
        </>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Field label="How many"><NumberInput value={count} onChange={setCount} /></Field>
          <Field label="Amount ($)"><NumberInput value={amount} onChange={setAmount} /></Field>
          <Field label="Prefix"><Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></Field>
        </div>
      )}
    </Dialog>
  );
}

function EntriesDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApi<{ items: { user_id: number; is_winner: boolean; created_at: string }[] }>(`/giveaways/${id}/entries`);
  return (
    <Dialog open onClose={onClose} title="Entries">
      {q.isLoading ? <Loading /> : (
        <Table head={['User', 'Joined', '']} empty={!q.data?.items.length}>
          {(q.data?.items ?? []).map((e) => <tr key={e.user_id}><td className="td">{e.user_id}</td><td className="td text-xs text-ink-400">{dt(e.created_at)}</td><td className="td">{e.is_winner && <Badge tone="gold">winner</Badge>}</td></tr>)}
        </Table>
      )}
    </Dialog>
  );
}

export default function Marketing({ kind }: { kind: keyof typeof KINDS }) {
  const def = KINDS[kind];
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Row | null | undefined>(undefined);
  const [gen, setGen] = useState(false);
  const [entries, setEntries] = useState<string | null>(null);
  const { run } = useAction();
  const list = useApi<Paged<Row>>(`${def.path}${qs({ q, page, limit: 50 })}`);

  return (
    <>
      <PageHeader title={def.title} sub={def.sub} actions={<>
        {kind === 'redeem' && <Button onClick={() => setGen(true)}><Wand2 className="h-4 w-4" /> Bulk generate</Button>}
        <Button variant="primary" onClick={() => setEdit(null)}><Plus className="h-4 w-4" /> New</Button>
      </>} />
      <Card>
        <Input placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="mb-3 max-w-xs" />
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={[...def.columns.map((c) => c.label), '']} empty={!list.data?.items.length}>
              {list.data!.items.map((r) => (
                <tr key={r.id}>
                  {def.columns.map((c) => <td key={c.label} className="td">{c.render(r)}</td>)}
                  <td className="td whitespace-nowrap text-end">
                    {kind === 'giveaways' && <>
                      <Button size="sm" variant="ghost" title="Entries" onClick={() => setEntries(r.id)}><Users className="h-3.5 w-3.5" /></Button>
                      {r.status === 'active' && <Button size="sm" variant="ghost" title="End now & draw winners" onClick={() => { if (confirm('End now and draw winners?')) void run('end', () => api(`/giveaways/${r.id}/end`, { method: 'POST' }), { success: 'Winners will be drawn within a minute', invalidate: [def.path] }); }}><Flag className="h-3.5 w-3.5" /></Button>}
                    </>}
                    <Button size="sm" variant="ghost" onClick={() => setEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm('Delete?')) void run('del', () => api(`${def.path}/${r.id}`, { method: 'DELETE' }), { success: 'Deleted', invalidate: [def.path] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} limit={list.data!.limit} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
      {edit !== undefined && <EditDialog def={def} row={edit} onClose={() => setEdit(undefined)} />}
      {gen && <GenerateDialog onClose={() => setGen(false)} />}
      {entries && <EntriesDialog id={entries} onClose={() => setEntries(null)} />}
    </>
  );
}
