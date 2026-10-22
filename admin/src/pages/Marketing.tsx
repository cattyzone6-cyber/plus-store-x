import { useState, type ReactNode } from 'react';
import { Pencil, Plus, Trash2, Wand2, Flag, Users } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd, dt, label, fromLocalInput, toLocalInput } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, NumberInput, PageHeader, Pagination, Select, Switch, Table, Textarea } from '../components/ui';

type Row = Record<string, unknown> & { id: string };
type FieldType = 'text' | 'number' | 'textarea' | 'switch' | 'select' | 'datetime' | 'targets';
type Tx = (en: string, ar: string) => string;
interface FieldDef { key: string; label: string; type: FieldType; options?: { value: string; label: string }[]; hint?: string; rtl?: boolean; ltr?: boolean; full?: boolean; showIf?: (r: Row) => boolean; nullable?: boolean }
interface KindDef { title: string; sub: string; path: string; fields: FieldDef[]; defaults: Record<string, unknown>; columns: { label: string; render: (r: Row) => ReactNode }[] }
type Kind = 'promos' | 'redeem' | 'giveaways' | 'freebies';

function kindDef(kind: Kind, tx: Tx): KindDef {
  const active = (r: Row) => (r.is_active ? <Badge tone="green">{tx('active', 'نشط')}</Badge> : <Badge>{tx('off', 'متوقف')}</Badge>);
  const code = (r: Row) => <code className="text-gold" dir="ltr">{String(r.code)}</code>;
  const SCOPES: Record<string, string> = { all: tx('Everything', 'كل شيء'), category: tx('Some categories', 'أقسام محددة'), product: tx('Some packs', 'باقات محددة') };
  switch (kind) {
    case 'promos': return {
      title: tx('Promo codes', 'أكواد الخصم'), sub: tx('Checkout discounts customers type before paying.', 'خصومات يكتبها الزبون قبل الدفع.'), path: '/promo-codes',
      defaults: { kind: 'percent', value: 10, scope: 'all', target_ids: [], min_order: 0, per_user_limit: 1, is_active: true },
      fields: [
        { key: 'code', label: tx('Code', 'الكود'), type: 'text', ltr: true, hint: tx('Letters, numbers, - and _', 'أحرف وأرقام و - و _') },
        { key: 'kind', label: tx('Type', 'النوع'), type: 'select', options: [{ value: 'percent', label: tx('Percent %', 'نسبة %') }, { value: 'fixed', label: tx('Fixed $', 'مبلغ ثابت $') }] },
        { key: 'value', label: tx('Value', 'القيمة'), type: 'number' },
        { key: 'min_order', label: tx('Min order ($)', 'أقل قيمة طلب ($)'), type: 'number' },
        { key: 'scope', label: tx('Applies to', 'يُطبّق على'), type: 'select', options: Object.entries(SCOPES).map(([value, l]) => ({ value, label: l })) },
        { key: 'target_ids', label: tx('Targets', 'المحدد'), type: 'targets', showIf: (r) => r.scope !== 'all', full: true },
        { key: 'max_uses', label: tx('Max uses (total)', 'أقصى استخدام (إجمالي)'), type: 'number', nullable: true, hint: tx('Empty = unlimited', 'فارغ = بلا حد') },
        { key: 'per_user_limit', label: tx('Uses per customer', 'مرات الاستخدام لكل زبون'), type: 'number', hint: tx('0 = unlimited', '0 = بلا حد') },
        { key: 'starts_at', label: tx('Starts', 'يبدأ'), type: 'datetime' },
        { key: 'expires_at', label: tx('Expires', 'ينتهي'), type: 'datetime' },
        { key: 'note', label: tx('Internal note', 'ملاحظة داخلية'), type: 'text', full: true },
        { key: 'is_active', label: tx('Active', 'نشط'), type: 'switch' },
      ],
      columns: [
        { label: tx('Code', 'الكود'), render: code },
        { label: tx('Discount', 'الخصم'), render: (r) => (r.kind === 'percent' ? <span dir="ltr">{String(r.value)}%</span> : usd(r.value as number)) },
        { label: tx('Scope', 'النطاق'), render: (r) => SCOPES[String(r.scope)] ?? String(r.scope) },
        { label: tx('Uses', 'الاستخدام'), render: (r) => <span dir="ltr">{`${r.uses}${r.max_uses ? ` / ${r.max_uses}` : ''}`}</span> },
        { label: tx('Expires', 'ينتهي'), render: (r) => dt(r.expires_at as string) },
        { label: tx('Status', 'الحالة'), render: active },
      ],
    };
    case 'redeem': return {
      title: tx('Redeem codes', 'أكواد الهدايا'), sub: tx('Gift codes that add balance to the customer wallet (/redeem).', 'أكواد هدايا تضيف رصيداً لمحفظة الزبون (‎/redeem).'), path: '/redeem-codes',
      defaults: { amount: 5, max_uses: 1, is_active: true },
      fields: [
        { key: 'code', label: tx('Code', 'الكود'), type: 'text', ltr: true },
        { key: 'amount', label: tx('Amount ($)', 'المبلغ ($)'), type: 'number' },
        { key: 'max_uses', label: tx('Max uses', 'أقصى استخدام'), type: 'number', hint: tx('Each customer can use a code once', 'كل زبون يستخدم الكود مرة واحدة') },
        { key: 'expires_at', label: tx('Expires', 'ينتهي'), type: 'datetime' },
        { key: 'note', label: tx('Internal note', 'ملاحظة داخلية'), type: 'text', full: true },
        { key: 'is_active', label: tx('Active', 'نشط'), type: 'switch' },
      ],
      columns: [
        { label: tx('Code', 'الكود'), render: code },
        { label: tx('Amount', 'المبلغ'), render: (r) => usd(r.amount as number) },
        { label: tx('Uses', 'الاستخدام'), render: (r) => <span dir="ltr">{`${r.uses} / ${r.max_uses}`}</span> },
        { label: tx('Expires', 'ينتهي'), render: (r) => dt(r.expires_at as string) },
        { label: tx('Note', 'ملاحظة'), render: (r) => <span className="text-xs text-ink-400">{String(r.note ?? '')}</span> },
        { label: tx('Status', 'الحالة'), render: active },
      ],
    };
    case 'giveaways': return {
      title: tx('Giveaways', 'السحوبات'), sub: tx('Customers join from the bot; winners are drawn automatically when it ends.', 'ينضم الزبائن من البوت، ويُختار الفائزون تلقائياً عند الانتهاء.'), path: '/giveaways',
      defaults: { prize_type: 'balance', prize_amount: 5, winners_count: 1, min_spent: 0, status: 'active', ends_at: new Date(Date.now() + 3 * 86400_000).toISOString() },
      fields: [
        { key: 'title_en', label: tx('Title (EN)', 'العنوان (إنجليزي)'), type: 'text', ltr: true },
        { key: 'title_ar', label: tx('Title (AR)', 'العنوان (عربي)'), type: 'text', rtl: true },
        { key: 'description_en', label: tx('Description (EN)', 'الوصف (إنجليزي)'), type: 'textarea', ltr: true },
        { key: 'description_ar', label: tx('Description (AR)', 'الوصف (عربي)'), type: 'textarea', rtl: true },
        { key: 'prize_type', label: tx('Prize', 'الجائزة'), type: 'select', options: [{ value: 'balance', label: tx('Wallet balance', 'رصيد في المحفظة') }, { value: 'text', label: tx('Text (code / account)', 'نص (كود / حساب)') }] },
        { key: 'prize_amount', label: tx('Prize amount ($)', 'قيمة الجائزة ($)'), type: 'number', showIf: (r) => r.prize_type === 'balance', nullable: true },
        { key: 'prize_text', label: tx('Prize text', 'نص الجائزة'), type: 'textarea', showIf: (r) => r.prize_type === 'text', hint: tx('Sent to every winner', 'يُرسل لكل فائز') },
        { key: 'winners_count', label: tx('Winners', 'عدد الفائزين'), type: 'number' },
        { key: 'min_spent', label: tx('Min spent to join ($)', 'أقل إنفاق للمشاركة ($)'), type: 'number' },
        { key: 'ends_at', label: tx('Ends', 'ينتهي'), type: 'datetime' },
        { key: 'status', label: tx('Status', 'الحالة'), type: 'select', options: ['active', 'ended', 'cancelled'].map((s) => ({ value: s, label: label(s) })) },
      ],
      columns: [
        { label: tx('Title', 'العنوان'), render: (r) => String(r.title_en) },
        { label: tx('Prize', 'الجائزة'), render: (r) => (r.prize_type === 'balance' ? usd(r.prize_amount as number) : tx('text', 'نص')) },
        { label: tx('Winners', 'الفائزون'), render: (r) => String(r.winners_count) },
        { label: tx('Ends', 'ينتهي'), render: (r) => dt(r.ends_at as string) },
        { label: tx('Status', 'الحالة'), render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{label(String(r.status))}</Badge> },
      ],
    };
    case 'freebies': return {
      title: tx('Freebies', 'محتوى مجاني'), sub: tx('Free resources customers can open from the bot.', 'موارد مجانية يفتحها الزبائن من البوت.'), path: '/freebies',
      defaults: { is_active: true, sort: 0 },
      fields: [
        { key: 'title_en', label: tx('Title (EN)', 'العنوان (إنجليزي)'), type: 'text', ltr: true },
        { key: 'title_ar', label: tx('Title (AR)', 'العنوان (عربي)'), type: 'text', rtl: true },
        { key: 'content_en', label: tx('Content (EN)', 'المحتوى (إنجليزي)'), type: 'textarea', ltr: true, hint: tx('Telegram HTML: links, <b>, <code>…', 'HTML تيليجرام: روابط، <b>، <code>…') },
        { key: 'content_ar', label: tx('Content (AR)', 'المحتوى (عربي)'), type: 'textarea', rtl: true },
        { key: 'sort', label: tx('Sort', 'الترتيب'), type: 'number' },
        { key: 'is_active', label: tx('Active', 'نشط'), type: 'switch' },
      ],
      columns: [
        { label: tx('Title', 'العنوان'), render: (r) => String(r.title_en) },
        { label: tx('Claims', 'مرات الفتح'), render: (r) => String(r.claims ?? 0) },
        { label: tx('Sort', 'الترتيب'), render: (r) => String(r.sort) },
        { label: tx('Status', 'الحالة'), render: active },
      ],
    };
  }
}

function Targets({ scope, value, onChange }: { scope: string; value: string[]; onChange: (v: string[]) => void }) {
  const tx = useTx();
  const [q, setQ] = useState('');
  const cats = useApi<{ categories: { id: string; name_en: string }[] }>(scope === 'category' ? '/categories' : null);
  const prods = useApi<Paged<{ id: string; name_en: string }>>(scope === 'product' ? `/products${qs({ q, limit: 100 })}` : null);
  const items = scope === 'category' ? cats.data?.categories ?? [] : prods.data?.items ?? [];
  return (
    <div>
      {scope === 'product' && <Input placeholder={tx('Search packs…', 'ابحث في الباقات…')} value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />}
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-ink-700 p-2">
        {items.map((i) => (
          <label key={i.id} className="flex min-h-9 items-center gap-2 text-sm sm:min-h-0">
            <input type="checkbox" checked={value.includes(i.id)} onChange={(e) => onChange(e.target.checked ? [...value, i.id] : value.filter((x) => x !== i.id))} />
            {i.name_en}
          </label>
        ))}
      </div>
      <div className="mt-1 text-xs text-ink-400">{tx(`${value.length} selected`, `${value.length} محدد`)}</div>
    </div>
  );
}

function EditDialog({ def, row, onClose }: { def: KindDef; row: Row | null; onClose: () => void }) {
  const tx = useTx();
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
    const ok = await run('save', () => row ? api(`${def.path}/${row.id}`, { method: 'PATCH', body: payload }) : api(def.path, { body: payload }), { success: tx('Saved', 'تم الحفظ'), invalidate: [def.path] });
    if (ok) onClose();
  };
  return (
    <Dialog open onClose={onClose} title={row ? tx('Edit', 'تعديل') : tx('New', 'جديد')} wide footer={<><Button onClick={onClose}>{tx('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy === 'save'} onClick={save}>{tx('Save', 'حفظ')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {def.fields.filter((fd) => !fd.showIf || fd.showIf(f)).map((fd) => {
          const v = f[fd.key];
          const set = (nv: unknown) => setF({ ...f, [fd.key]: nv });
          const dir = fd.rtl ? 'rtl' : fd.ltr ? 'ltr' : undefined;
          let input: ReactNode;
          switch (fd.type) {
            case 'number': input = <NumberInput dir="ltr" allowNull={fd.nullable} value={(v as number | null) ?? null} onChange={set} />; break;
            case 'textarea': input = <Textarea dir={dir} value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} />; break;
            case 'switch': input = <Switch checked={!!v} onChange={set} />; break;
            case 'select': input = <Select value={String(v ?? '')} onChange={(e) => set(e.target.value)} options={fd.options ?? []} />; break;
            case 'datetime': input = <Input dir="ltr" type="datetime-local" value={toLocalInput(v as string)} onChange={(e) => set(fromLocalInput(e.target.value))} />; break;
            case 'targets': input = <Targets scope={String(f.scope)} value={(v as string[]) ?? []} onChange={set} />; break;
            default: input = <Input dir={dir} value={(v as string) ?? ''} onChange={(e) => set(fd.key === 'code' ? e.target.value.toUpperCase() : e.target.value)} />;
          }
          return <Field key={fd.key} label={fd.label} hint={fd.hint} className={fd.full || fd.type === 'textarea' ? 'sm:col-span-2' : ''}>{input}</Field>;
        })}
      </div>
    </Dialog>
  );
}

function GenerateDialog({ onClose }: { onClose: () => void }) {
  const tx = useTx();
  const [count, setCount] = useState<number | null>(10);
  const [amount, setAmount] = useState<number | null>(5);
  const [prefix, setPrefix] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const { run, busy } = useAction();
  return (
    <Dialog open onClose={onClose} title={tx('Generate redeem codes', 'توليد أكواد هدايا')} footer={!codes && <Button variant="primary" loading={busy === 'gen'} onClick={async () => {
      const r = await run('gen', () => api<{ codes: string[] }>('/redeem-codes/generate', { body: { count, amount, prefix } }), { success: tx('Generated', 'تم التوليد'), invalidate: ['/redeem-codes'] });
      if (r) setCodes(r.codes);
    }}>{tx('Generate', 'توليد')}</Button>}>
      {codes ? (
        <>
          <Textarea dir="ltr" rows={12} readOnly value={codes.join('\n')} className="font-mono text-xs" />
          <Button className="mt-2 w-full sm:w-auto" onClick={() => void navigator.clipboard.writeText(codes.join('\n'))}>{tx('Copy all', 'نسخ الكل')}</Button>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={tx('How many', 'العدد')}><NumberInput dir="ltr" value={count} onChange={setCount} /></Field>
          <Field label={tx('Amount ($)', 'المبلغ ($)')}><NumberInput dir="ltr" value={amount} onChange={setAmount} /></Field>
          <Field label={tx('Prefix', 'البادئة')}><Input dir="ltr" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></Field>
        </div>
      )}
    </Dialog>
  );
}

function EntriesDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const tx = useTx();
  const q = useApi<{ items: { user_id: number; is_winner: boolean; created_at: string }[] }>(`/giveaways/${id}/entries`);
  return (
    <Dialog open onClose={onClose} title={tx('Entries', 'المشاركون')}>
      {q.isLoading ? <Loading /> : (
        <Table head={[tx('Customer', 'الزبون'), tx('Joined', 'انضم'), '']} empty={!q.data?.items.length}>
          {(q.data?.items ?? []).map((e) => <tr key={e.user_id}><td className="td" dir="ltr">{e.user_id}</td><td className="td whitespace-nowrap text-xs text-ink-400">{dt(e.created_at)}</td><td className="td">{e.is_winner && <Badge tone="gold">{tx('winner', 'فائز')}</Badge>}</td></tr>)}
        </Table>
      )}
    </Dialog>
  );
}

export default function Marketing({ kind }: { kind: Kind }) {
  const tx = useTx();
  const def = kindDef(kind, tx);
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
        {kind === 'redeem' && <Button onClick={() => setGen(true)}><Wand2 className="h-4 w-4" /> {tx('Bulk generate', 'توليد جماعي')}</Button>}
        <Button variant="primary" onClick={() => setEdit(null)}><Plus className="h-4 w-4" /> {tx('New', 'جديد')}</Button>
      </>} />
      <Card>
        <Input placeholder={tx('Search…', 'بحث…')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="mb-3 sm:max-w-xs" />
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={[...def.columns.map((c) => c.label), '']} empty={!list.data?.items.length}>
              {list.data!.items.map((r) => (
                <tr key={r.id}>
                  {def.columns.map((c, i) => <td key={c.label} className="td">{i === 0 ? <button type="button" onClick={() => setEdit(r)} className="text-start hover:underline">{c.render(r)}</button> : c.render(r)}</td>)}
                  <td className="td whitespace-nowrap text-end">
                    {kind === 'giveaways' && <>
                      <Button size="sm" variant="ghost" title={tx('Entries', 'المشاركون')} aria-label={tx('Entries', 'المشاركون')} onClick={() => setEntries(r.id)}><Users className="h-3.5 w-3.5" /></Button>
                      {r.status === 'active' && <Button size="sm" variant="ghost" title={tx('End now & draw winners', 'إنهاء الآن واختيار الفائزين')} aria-label={tx('End now & draw winners', 'إنهاء الآن واختيار الفائزين')} onClick={() => { if (confirm(tx('End now and draw winners?', 'إنهاء السحب الآن واختيار الفائزين؟'))) void run('end', () => api(`/giveaways/${r.id}/end`, { method: 'POST' }), { success: tx('Winners will be drawn within a minute', 'سيُختار الفائزون خلال دقيقة'), invalidate: [def.path] }); }}><Flag className="h-3.5 w-3.5" /></Button>}
                    </>}
                    <Button size="sm" variant="ghost" aria-label={tx('Edit', 'تعديل')} onClick={() => setEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" aria-label={tx('Delete', 'حذف')} onClick={() => { if (confirm(tx('Delete?', 'حذف؟'))) void run('del', () => api(`${def.path}/${r.id}`, { method: 'DELETE' }), { success: tx('Deleted', 'تم الحذف'), invalidate: [def.path] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
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
