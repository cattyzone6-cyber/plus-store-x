import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Download, Plus, Save, Trash2 } from 'lucide-react';
import { api, apiDownload, qs } from '../lib/api';
import { useAction, useApi, useIsOwner, type Paged } from '../lib/hooks';
import { usd, dt } from '../lib/format';
import { useTx } from '../lib/i18n';
import { PausedNote } from '../components/catalog/PackList';
import {
  Badge, Button, Card, Dialog, ErrorBox, Field, ImageInput, Input, Loading, NumberInput, PageHeader, Pagination, Select,
  StyleSelect, Switch, Table, Tabs, Textarea,
} from '../components/ui';

interface InputField { key: string; per_unit?: boolean; required?: boolean; options?: (string | number)[]; label_en?: string; label_ar?: string; fixed?: string | number }
interface Product {
  id: string; category_id: string | null; name_en: string; name_ar: string | null; description_en: string | null; description_ar: string | null;
  emoji: string | null; custom_emoji_id: string | null; image_url: string | null; duration_en: string | null; duration_ar: string | null;
  warranty_days: number; fulfillment: 'auto' | 'manual'; pricing_mode: 'markup' | 'manual'; markup_percent: number | null; markup_fixed: number | null;
  manual_price: number | null; base_cost: number | null; compare_at_price: number | null; sale_percent: number;
  qty_discounts: { min_qty: number; percent: number }[]; routing: 'priority' | 'cheapest'; on_failure: string | null;
  input_fields: InputField[]; min_qty: number; max_qty: number; qty_presets: number[] | null; button_style: string | null;
  is_active: boolean; is_featured: boolean; auto_sync_info: boolean; locked_fields: string[]; sold_count: number;
  delivery_note_en: string | null; delivery_note_ar: string | null;
  group_id: string | null; min_margin_percent: number | null; pinned: boolean;
  paused_reason: 'cost_jump' | 'below_margin' | null; pending_cost: number | null; cost_basis: number | null;
}
interface Source {
  id: string; kind: 'provider' | 'stock' | 'manual'; priority: number; is_enabled: boolean; provider_name: string | null;
  provider_product: { id: string; name: string; external_id: string; cost: number | null; stock: number | null; is_removed: boolean; is_available: boolean; delivery_kind: string; warranty_days: number | null } | null;
  unit_cost: number | null; available: number | null; usable: boolean; reason: string | null; route_position: number; profit: number | null;
}
interface Detail {
  product: Product;
  pricing: {
    unit_price: number | null; original_unit_price: number | null; reference_cost: number | null; profit: number | null; available: number | null; sold_out: boolean;
    min_margin_percent: number; paused: boolean;
  };
  sources: Source[];
  inputs: { ask: InputField[]; fixed: Record<string, string | number> };
  stock: Record<string, number>;
  syncable_fields: string[];
}

type Tab = 'info' | 'pricing' | 'sources' | 'stock' | 'inputs' | 'delivery';

// ─────────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────────

function AddSourceDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  const tx = useTx();
  const [q, setQ] = useState('');
  const { run, busy } = useAction();
  const res = useApi<{ items: { id: string; name: string; provider_name: string; cost: number | null; stock: number | null }[] }>(`/provider-products${qs({ q })}`);
  const add = (body: Record<string, unknown>) => run('add', () => api(`/products/${productId}/sources`, { body }), { success: tx('Source added', 'تمت إضافة المصدر'), invalidate: [`/products/${productId}`] }).then((r) => r && onClose());
  return (
    <Dialog open onClose={onClose} title={tx('Add source', 'إضافة مصدر')} wide>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button loading={busy === 'add'} onClick={() => void add({ kind: 'stock' })}>{tx('My stock', 'مخزوني')}</Button>
        <Button loading={busy === 'add'} onClick={() => void add({ kind: 'manual' })}>{tx('Manual delivery', 'تسليم يدوي')}</Button>
      </div>
      <Input placeholder={tx('Search provider products…', 'ابحث في منتجات المزودين…')} value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      <div className="max-h-[50vh] overflow-y-auto">
        <Table head={[tx('Provider', 'المزود'), tx('Product', 'المنتج'), tx('Cost', 'التكلفة'), tx('Stock', 'المخزون'), '']} empty={!res.data?.items.length}>
          {(res.data?.items ?? []).map((p) => (
            <tr key={p.id}>
              <td className="td text-ink-400">{p.provider_name}</td>
              <td className="td">{p.name}</td>
              <td className="td">{usd(p.cost)}</td>
              <td className="td">{p.stock ?? '∞'}</td>
              <td className="td text-end"><Button size="sm" variant="primary" onClick={() => void add({ kind: 'provider', provider_product_id: p.id })}>{tx('Add', 'إضافة')}</Button></td>
            </tr>
          ))}
        </Table>
      </div>
    </Dialog>
  );
}

function SourcesTab({ d, owner }: { d: Detail; owner: boolean }) {
  const tx = useTx();
  const { run } = useAction();
  const [adding, setAdding] = useState(false);
  const sources = [...d.sources].sort((a, b) => a.priority - b.priority);
  const inv = [`/products/${d.product.id}`];
  const move = (i: number, dir: number) => {
    const ids = sources.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run('reorder', () => api(`/products/${d.product.id}/sources/reorder`, { body: { ids } }), { invalidate: inv });
  };
  return (
    <Card title={tx('Sources', 'المصادر')} actions={owner && <Button size="sm" variant="primary" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> {tx('Add source', 'إضافة مصدر')}</Button>}>
      <p className="mb-3 text-xs text-ink-400">
        {d.product.routing === 'cheapest'
          ? tx('Orders go to the cheapest usable source first; if a source fails safely the next one is tried (see Delivery → On failure).', 'تذهب الطلبات أولاً إلى أرخص مصدر صالح؛ وإذا فشل مصدر بأمان يُجرَّب التالي (راجع التسليم ← عند الفشل).')
          : tx('Orders go through the sources in order (top first); if a source fails safely the next one is tried (see Delivery → On failure).', 'تمر الطلبات على المصادر بالترتيب (الأعلى أولاً)؛ وإذا فشل مصدر بأمان يُجرَّب التالي (راجع التسليم ← عند الفشل).')}
      </p>
      <Table head={['#', tx('Source', 'المصدر'), tx('Cost', 'التكلفة'), tx('Available', 'المتوفر'), tx('Profit / unit', 'الربح / وحدة'), tx('Status', 'الحالة'), '']} empty={!sources.length}>
        {sources.map((s, i) => (
          <tr key={s.id} className={!s.is_enabled ? 'opacity-50' : ''}>
            <td className="td w-20">
              <div className="flex items-center gap-1">
                {s.route_position >= 0 ? <Badge tone="gold">{s.route_position + 1}</Badge> : <Badge>–</Badge>}
                {owner && <><button onClick={() => move(i, -1)} className="p-0.5 text-ink-400 hover:text-white"><ArrowUp className="h-3.5 w-3.5" /></button><button onClick={() => move(i, 1)} className="p-0.5 text-ink-400 hover:text-white"><ArrowDown className="h-3.5 w-3.5" /></button></>}
              </div>
            </td>
            <td className="td">
              {s.kind === 'provider' ? (
                <>
                  <div className="font-medium">{s.provider_name}</div>
                  <div className="text-xs text-ink-400">{s.provider_product?.name} <code className="text-[10px]">#{s.provider_product?.external_id}</code></div>
                </>
              ) : <div className="font-medium capitalize">{s.kind === 'stock' ? tx('My stock', 'مخزوني') : tx('Manual delivery', 'تسليم يدوي')}</div>}
            </td>
            <td className="td">{usd(s.unit_cost)}</td>
            <td className="td">{s.available == null ? '∞' : s.available}</td>
            <td className="td">{s.profit == null ? '—' : <span className={s.profit < 0 ? 'text-red-400' : 'text-emerald-400'}>{usd(s.profit)}</span>}</td>
            <td className="td">{s.usable ? <Badge tone="green">{tx('usable', 'صالح')}</Badge> : <Badge tone="red">{s.reason ?? tx('unusable', 'غير صالح')}</Badge>}</td>
            <td className="td text-end">
              {owner && <div className="flex items-center justify-end gap-2">
                <Switch checked={s.is_enabled} onChange={(v) => void run('toggle', () => api(`/sources/${s.id}`, { method: 'PATCH', body: { is_enabled: v } }), { invalidate: inv })} />
                <Button size="sm" variant="ghost" onClick={() => { if (confirm(tx('Remove this source?', 'إزالة هذا المصدر؟'))) void run('del', () => api(`/sources/${s.id}`, { method: 'DELETE' }), { invalidate: inv }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>}
            </td>
          </tr>
        ))}
      </Table>
      {adding && <AddSourceDialog productId={d.product.id} onClose={() => setAdding(false)} />}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock
// ─────────────────────────────────────────────────────────────────────────────

function StockTab({ d, owner }: { d: Detail; owner: boolean }) {
  const tx = useTx();
  const pid = d.product.id;
  const [status, setStatus] = useState('available');
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [sep, setSep] = useState('\\n');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { run, busy } = useAction();
  const list = useApi<Paged<{ id: string; content: string; status: string; created_at: string; sold_at: string | null; order_id: number | null }>>(`/products/${pid}/stock${qs({ status, page, limit: 100 })}`);
  const inv = [`/products/${pid}`];
  const lines = text.split(sep === '\\n' ? '\n' : sep).filter((l) => l.trim()).length;
  const hasStockSource = d.sources.some((s) => s.kind === 'stock');

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card title={tx('Add stock', 'إضافة مخزون')} className="lg:col-span-2">
        {!hasStockSource && <p className="mb-2 text-xs text-gold">{tx('A “My stock” source will be added automatically.', 'سيُضاف مصدر “مخزوني” تلقائياً.')}</p>}
        <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'user1@mail.com:pass123\nuser2@mail.com:pass456\nhttps://redeem.link/abc'} className="font-mono text-xs" />
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label={tx('Separator', 'الفاصل')} className="w-32"><Select value={sep} onChange={(e) => setSep(e.target.value)} options={[{ value: '\\n', label: tx('New line', 'سطر جديد') }, { value: '\n\n', label: tx('Blank line', 'سطر فارغ') }, { value: '---', label: '---' }, { value: ';', label: ';' }]} /></Field>
          <Button variant="primary" disabled={!lines} loading={busy === 'add'} onClick={async () => {
            const r = await run('add', () => api<{ added: number; skipped: number }>(`/products/${pid}/stock`, { body: { text, separator: sep } }), { invalidate: inv });
            if (r) { setText(''); alert(tx(`Added ${r.added} items${r.skipped ? `, skipped ${r.skipped} duplicates` : ''}`, `أُضيف ${r.added} عنصر${r.skipped ? `، وتم تخطي ${r.skipped} مكرر` : ''}`)); }
          }}>{tx(`Add ${lines || ''} items`, `إضافة ${lines || ''} عنصر`)}</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5 text-xs">{Object.entries(d.stock).map(([k, v]) => <Badge key={k} tone={k === 'available' ? 'green' : 'gray'}>{k}: {v}</Badge>)}</div>
      </Card>
      <Card title={tx('Items', 'العناصر')} className="lg:col-span-3" actions={<>
        <Select className="!w-36 !py-1 text-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); setSel(new Set()); }} options={[{ value: 'available', label: tx('available', 'متاح') }, { value: 'sold', label: tx('sold', 'مباع') }, { value: 'invalid', label: tx('invalid', 'غير صالح') }, { value: 'reserved', label: tx('reserved', 'محجوز') }]} />
        {owner && <Button size="sm" onClick={() => void apiDownload(`/products/${pid}/stock/export${qs({ status })}`, `stock-${status}.txt`)}><Download className="h-3.5 w-3.5" /></Button>}
      </>}>
        {sel.size > 0 && (
          <div className="mb-2 flex gap-2">
            <Button size="sm" onClick={() => void run('upd', () => api('/stock/update', { body: { ids: [...sel], action: 'invalid' } }), { invalidate: inv }).then(() => setSel(new Set()))}>{tx('Mark invalid', 'تعليم كغير صالح')}</Button>
            {status === 'invalid' && <Button size="sm" onClick={() => void run('upd', () => api('/stock/update', { body: { ids: [...sel], action: 'available' } }), { invalidate: inv }).then(() => setSel(new Set()))}>{tx('Mark available', 'تعليم كمتاح')}</Button>}
            <Button size="sm" variant="danger" onClick={() => { if (confirm(tx(`Delete ${sel.size} items?`, `حذف ${sel.size} عنصر؟`))) void run('upd', () => api('/stock/update', { body: { ids: [...sel], action: 'delete' } }), { invalidate: inv }).then(() => setSel(new Set())); }}>{tx('Delete', 'حذف')}</Button>
          </div>
        )}
        {list.isLoading ? <Loading /> : (
          <>
            <Table head={['', tx('Content', 'المحتوى'), tx('Added', 'أُضيف'), status === 'sold' ? tx('Order', 'الطلب') : '']} empty={!list.data?.items.length}>
              {(list.data?.items ?? []).map((i) => (
                <tr key={i.id}>
                  <td className="td w-8">{i.status !== 'sold' && <input type="checkbox" checked={sel.has(i.id)} onChange={() => { const n = new Set(sel); n.has(i.id) ? n.delete(i.id) : n.add(i.id); setSel(n); }} />}</td>
                  <td className="td max-w-[320px] truncate font-mono text-xs" title={i.content}>{i.content}</td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(i.created_at)}</td>
                  <td className="td text-xs">{i.order_id ? <Link className="text-gold" to={`/orders/${i.order_id}`}>#{i.order_id}</Link> : ''}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} limit={list.data?.limit ?? 100} total={list.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor
// ─────────────────────────────────────────────────────────────────────────────

export default function ProductEditor() {
  const { id } = useParams();
  const tx = useTx();
  const nav = useNavigate();
  const owner = useIsOwner();
  const q = useApi<Detail>(`/products/${id}`);
  const cats = useApi<{ categories: { id: string; name_en: string }[] }>('/categories');
  const groups = useApi<{ groups: { id: string; name_en: string; category_id: string | null }[] }>('/groups');
  const { run, busy } = useAction();
  const [tab, setTab] = useState<Tab>('info');
  const [f, setF] = useState<Product | null>(null);

  useEffect(() => {
    if (q.data) setF(q.data.product);
  }, [q.data]);

  const dirty = useMemo(() => {
    if (!f || !q.data) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) {
      if (JSON.stringify(v) !== JSON.stringify((q.data.product as unknown as Record<string, unknown>)[k])) out[k] = v;
    }
    for (const k of ['locked_fields', 'sold_count', 'paused_reason', 'pending_cost', 'cost_basis']) delete out[k];
    return out;
  }, [f, q.data]);

  if (q.isLoading || !f) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const d = q.data!;
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setF({ ...f, [k]: v });
  const locked = (k: string) => (d.syncable_fields.includes(k) && f.auto_sync_info && d.sources.some((s) => s.kind === 'provider') ? d.product.locked_fields.includes(k) : undefined);
  const unlock = (k: string) => { if (confirm(tx('Reset to the provider value on the next sync?', 'إرجاع قيمة المزود في المزامنة القادمة؟'))) void run('unlock', () => api(`/products/${id}/unlock`, { body: { fields: [k] } }), { success: tx('Unlocked', 'تم فك القفل'), invalidate: [`/products/${id}`] }); };
  const hasDirty = Object.keys(dirty).length > 0;

  const save = () => run('save', () => api(`/products/${id}`, { method: 'PATCH', body: dirty }), { success: tx('Saved', 'تم الحفظ'), invalidate: [`/products/${id}`, '/products', '/groups'] });
  const groupName = groups.data?.groups.find((g) => g.id === d.product.group_id)?.name_en;

  const estPrice = (() => {
    if (f.pricing_mode === 'manual') return f.manual_price;
    const cost = d.pricing.reference_cost;
    if (cost == null) return null;
    return cost * (1 + (f.markup_percent ?? 0) / 100) + (f.markup_fixed ?? 0);
  })();

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><Link to={d.product.group_id ? '/catalog' : '/products'} className="text-ink-400 hover:text-white"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link><span className="truncate">{f.emoji} {d.product.name_en}</span></span>}
        sub={<span className="flex flex-wrap items-center gap-2">
          {groupName && <Badge tone="blue">{groupName}</Badge>}
          {d.product.is_active ? <Badge tone="green">{tx('visible', 'ظاهر')}</Badge> : <Badge>{tx('hidden', 'مخفي')}</Badge>}
          {d.pricing.sold_out ? <Badge tone="red">{tx('sold out', 'نفدت')}</Badge> : <Badge tone="gold">{usd(d.pricing.unit_price)}</Badge>}
          <span>{tx('available', 'المتوفر')}: {d.pricing.available == null ? '∞' : d.pricing.available}</span>
          {owner && d.pricing.profit != null && <span>{tx('profit/unit', 'الربح/وحدة')}: <span className={d.pricing.profit < 0 ? 'text-red-400' : 'text-emerald-400'}>{usd(d.pricing.profit)}</span></span>}
          <span>{tx('sold', 'المبيع')}: {d.product.sold_count}</span>
        </span>}
        actions={<>
          {owner && <Button onClick={() => void run('dup', () => api<{ product: { id: string } }>(`/products/${id}/duplicate`, { method: 'POST' }), { success: tx('Duplicated', 'تم النسخ'), invalidate: ['/products'] }).then((r) => r && nav(`/products/${r.product.id}`))}><Copy className="h-4 w-4" /></Button>}
          {owner && <Button variant="danger" onClick={() => { if (confirm(tx('Delete this pack? Orders keep their history.', 'حذف هذه الباقة؟ الطلبات تحتفظ بسجلها.'))) void run('del', () => api(`/products/${id}`, { method: 'DELETE' }), { invalidate: ['/products'] }).then(() => nav('/products')); }}><Trash2 className="h-4 w-4" /></Button>}
          <Button variant="primary" disabled={!hasDirty} loading={busy === 'save'} onClick={() => void save()}><Save className="h-4 w-4" /> {tx('Save', 'حفظ')}</Button>
        </>}
      />
      {d.product.paused_reason && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
          <p className="mb-2 text-red-200">
            {d.product.paused_reason === 'cost_jump'
              ? tx('This pack is paused: the provider raised its cost more than the limit in Settings → Pricing. Customers cannot buy it until you accept the new cost (the price follows it) or change the price.',
                'هذه الباقة موقوفة: رفع المزود تكلفتها أكثر من الحد في الإعدادات ← التسعير. لا يمكن للعملاء شراؤها حتى تقبل التكلفة الجديدة (والسعر يتبعها) أو تغيّر السعر.')
              : tx(`This pack is paused: its price is below the minimum margin (${d.pricing.min_margin_percent}% over cost). Raise the price or lower the minimum margin.`,
                `هذه الباقة موقوفة: سعرها أقل من الحد الأدنى للربح (${d.pricing.min_margin_percent}% فوق التكلفة). ارفع السعر أو خفّض الحد الأدنى للربح.`)}
          </p>
          <PausedNote pack={d.product} owner={owner} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'info', label: tx('Info', 'المعلومات') },
        ...(owner ? [{ value: 'pricing' as Tab, label: tx('Pricing', 'التسعير') }] : []),
        { value: 'sources', label: `${tx('Sources', 'المصادر')} (${d.sources.length})` },
        { value: 'stock', label: `${tx('Stock', 'المخزون')} (${d.stock.available ?? 0})` },
        { value: 'inputs', label: tx('Customer inputs', 'بيانات العميل') },
        { value: 'delivery', label: tx('Delivery & warranty', 'التسليم والضمان') },
      ]} />

      {tab === 'info' && (
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tx('Full name (EN)', 'الاسم الكامل (إنجليزي)')} hint={tx('Customers see this full name, e.g. "ChatGPT Plus 1 Month".', 'يرى العميل هذا الاسم الكامل، مثل "ChatGPT Plus 1 Month".')} locked={locked('name_en')} onUnlock={() => unlock('name_en')}><Input value={f.name_en} onChange={(e) => set('name_en', e.target.value)} /></Field>
            <Field label={tx('Full name (AR)', 'الاسم الكامل (عربي)')}><Input dir="rtl" value={f.name_ar ?? ''} onChange={(e) => set('name_ar', e.target.value || null)} /></Field>
            <Field label={tx('Description (EN)', 'الوصف (إنجليزي)')} locked={locked('description_en')} onUnlock={() => unlock('description_en')} hint={tx('Telegram HTML allowed: <b>, <i>, <code>', 'يُسمح بتنسيق HTML في تيليجرام: <b>، <i>، <code>')}><Textarea rows={7} value={f.description_en ?? ''} onChange={(e) => set('description_en', e.target.value || null)} /></Field>
            <Field label={tx('Description (AR)', 'الوصف (عربي)')}><Textarea dir="rtl" rows={7} value={f.description_ar ?? ''} onChange={(e) => set('description_ar', e.target.value || null)} /></Field>
            <Field label={tx('Duration (EN)', 'المدة (إنجليزي)')}><Input value={f.duration_en ?? ''} onChange={(e) => set('duration_en', e.target.value || null)} placeholder="1 month" /></Field>
            <Field label={tx('Duration (AR)', 'المدة (عربي)')}><Input dir="rtl" value={f.duration_ar ?? ''} onChange={(e) => set('duration_ar', e.target.value || null)} placeholder="شهر واحد" /></Field>
            <Field label={tx('Product', 'المنتج')} hint={tx('The product this pack is listed under (e.g. ChatGPT Plus). Its category follows the product.', 'المنتج الذي تظهر تحته هذه الباقة (مثل ChatGPT Plus). قسمها يتبع المنتج.')}>
              <Select value={f.group_id ?? ''} onChange={(e) => {
                const g = groups.data?.groups.find((x) => x.id === e.target.value);
                setF({ ...f, group_id: g?.id ?? null, ...(g ? { category_id: g.category_id } : {}) });
              }} options={[{ value: '', label: tx('— none (listed in the category) —', '— بدون (تظهر داخل القسم) —') }, ...(groups.data?.groups ?? []).map((g) => ({ value: g.id, label: g.name_en }))]} />
            </Field>
            <Field label={tx('Category', 'القسم')}>
              <Select value={f.category_id ?? ''} disabled={!!f.group_id} onChange={(e) => set('category_id', e.target.value || null)} options={[{ value: '', label: tx('— none (hidden) —', '— بدون (مخفية) —') }, ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name_en }))]} />
            </Field>
            <Field label={tx('Button color', 'لون الزر')}><StyleSelect allowInherit value={f.button_style} onChange={(v) => set('button_style', v)} /></Field>
            <Field label={tx('Emoji (fallback)', 'إيموجي (احتياطي)')} locked={locked('emoji')} onUnlock={() => unlock('emoji')}><Input value={f.emoji ?? ''} onChange={(e) => set('emoji', e.target.value || null)} /></Field>
            <Field label={tx('Custom emoji ID (premium)', 'معرّف إيموجي مميز (بريميوم)')}><Input value={f.custom_emoji_id ?? ''} onChange={(e) => set('custom_emoji_id', e.target.value.replace(/\D/g, '') || null)} /></Field>
            <Field label={tx('Image', 'الصورة')} locked={locked('image_url')} onUnlock={() => unlock('image_url')} className="md:col-span-2"><ImageInput value={f.image_url} onChange={(v) => set('image_url', v)} /></Field>
            <div className="flex flex-wrap gap-6 md:col-span-2">
              <Switch checked={f.is_active} onChange={(v) => set('is_active', v)} label={tx('Visible in the bot', 'ظاهرة في البوت')} />
              <Switch checked={f.pinned} onChange={(v) => set('pinned', v)} label={tx('Pinned (first in its product)', 'مثبّتة (الأولى في منتجها)')} />
              <Switch checked={f.is_featured} onChange={(v) => set('is_featured', v)} label={tx('Featured (landing page)', 'مميزة (الصفحة الرئيسية)')} />
              {owner && <Switch checked={f.auto_sync_info} onChange={(v) => set('auto_sync_info', v)} label={tx('Sync info from provider', 'مزامنة المعلومات من المزود')} />}
            </div>
          </div>
        </Card>
      )}

      {tab === 'pricing' && owner && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={tx('Price', 'السعر')} className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tx('Pricing mode', 'طريقة التسعير')} className="sm:col-span-2">
                <Select value={f.pricing_mode} onChange={(e) => set('pricing_mode', e.target.value as Product['pricing_mode'])} options={[
                  { value: 'markup', label: tx('Cost + markup (follows provider price changes)', 'التكلفة + هامش (يتبع تغيّر سعر المزود)') },
                  { value: 'manual', label: tx('Manual fixed price', 'سعر ثابت يدوي') },
                ]} />
              </Field>
              {f.pricing_mode === 'markup' ? (
                <>
                  <Field label={tx('Markup %', 'الهامش %')} hint={tx('Empty = default from Settings → Pricing', 'فارغ = الافتراضي من الإعدادات ← التسعير')}><NumberInput allowNull value={f.markup_percent} onChange={(v) => set('markup_percent', v)} /></Field>
                  <Field label={tx('Markup fixed ($)', 'هامش ثابت ($)')} hint={tx('Added after the %', 'يُضاف بعد النسبة')}><NumberInput allowNull value={f.markup_fixed} onChange={(v) => set('markup_fixed', v)} /></Field>
                </>
              ) : (
                <Field label={tx('Price ($)', 'السعر ($)')}><NumberInput allowNull value={f.manual_price} onChange={(v) => set('manual_price', v)} /></Field>
              )}
              <Field label={tx('Base cost ($)', 'التكلفة الأساسية ($)')} hint={tx('Cost of stock/manual sources (for profit & markup)', 'تكلفة مصادر المخزون/اليدوي (لحساب الربح والهامش)')}><NumberInput allowNull value={f.base_cost} onChange={(v) => set('base_cost', v)} /></Field>
              <Field label={tx('Sale %', 'التخفيض %')} hint={tx('Shown as a discount on the price', 'يظهر كخصم على السعر')}><NumberInput value={f.sale_percent} onChange={(v) => set('sale_percent', v ?? 0)} /></Field>
              <Field label={tx('Compare-at price ($)', 'السعر قبل الخصم ($)')} hint={tx("Optional 'was' price shown struck through", 'اختياري: سعر سابق يظهر مشطوباً')}><NumberInput allowNull value={f.compare_at_price} onChange={(v) => set('compare_at_price', v)} /></Field>
              <Field label={tx('Minimum margin %', 'الحد الأدنى للربح %')} hint={tx(`Empty = Settings → Pricing (${d.pricing.min_margin_percent}% now). Markup prices never go below cost + this %; a manual price below it pauses the pack.`, `فارغ = الإعدادات ← التسعير (${d.pricing.min_margin_percent}% حالياً). أسعار الهامش لا تنزل عن التكلفة + هذه النسبة؛ والسعر اليدوي الأقل منها يوقف الباقة.`)}>
                <NumberInput allowNull value={f.min_margin_percent} onChange={(v) => set('min_margin_percent', v)} />
              </Field>
              <Field label={tx('Routing', 'توجيه الطلبات')}>
                <Select value={f.routing} onChange={(e) => set('routing', e.target.value as Product['routing'])} options={[{ value: 'priority', label: tx('Priority order (Sources tab)', 'حسب الأولوية (تبويب المصادر)') }, { value: 'cheapest', label: tx('Cheapest source first', 'أرخص مصدر أولاً') }]} />
              </Field>
            </div>
            <div className="mt-5">
              <div className="label">{tx('Quantity discounts', 'خصومات الكمية')}</div>
              {f.qty_discounts.map((qd, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <span className="text-sm text-ink-400">{tx('from', 'من')}</span>
                  <NumberInput className="!w-24" value={qd.min_qty} onChange={(v) => set('qty_discounts', f.qty_discounts.map((x, j) => (j === i ? { ...x, min_qty: v ?? 1 } : x)))} />
                  <span className="text-sm text-ink-400">{tx('units →', 'وحدات ←')}</span>
                  <NumberInput className="!w-24" value={qd.percent} onChange={(v) => set('qty_discounts', f.qty_discounts.map((x, j) => (j === i ? { ...x, percent: v ?? 0 } : x)))} />
                  <span className="text-sm text-ink-400">{tx('% off', '% خصم')}</span>
                  <Button size="sm" variant="ghost" onClick={() => set('qty_discounts', f.qty_discounts.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
              <Button size="sm" onClick={() => set('qty_discounts', [...f.qty_discounts, { min_qty: 5, percent: 5 }])}><Plus className="h-3.5 w-3.5" /> {tx('Add tier', 'إضافة شريحة')}</Button>
            </div>
          </Card>
          <Card title={tx('Preview', 'معاينة')}>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-ink-400">{tx('Reference cost', 'التكلفة المرجعية')}</span><span>{usd(d.pricing.reference_cost)}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">{tx('Base price (unsaved)', 'السعر الأساسي (غير محفوظ)')}</span><span>{usd(estPrice)}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">{tx('After sale', 'بعد التخفيض')}</span><span>{usd(estPrice != null ? estPrice * (1 - (f.sale_percent || 0) / 100) : null)}</span></div>
              <hr className="border-ink-700" />
              <div className="flex justify-between"><span className="text-ink-400">{tx('Saved price (rounded)', 'السعر المحفوظ (مقرّب)')}</span><span className="font-semibold text-gold">{usd(d.pricing.unit_price)}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">{tx('Profit / unit', 'الربح / وحدة')}</span><span className={(d.pricing.profit ?? 0) < 0 ? 'text-red-400' : 'text-emerald-400'}>{usd(d.pricing.profit)}</span></div>
              <p className="pt-2 text-xs text-ink-400">{tx('Customers may pay less with their personal discount level or a promo code. Rounding rule: Settings → Pricing.', 'قد يدفع العميل أقل بمستوى خصمه الشخصي أو بكود خصم. قاعدة التقريب: الإعدادات ← التسعير.')}</p>
            </div>
          </Card>
        </div>
      )}

      {tab === 'sources' && <SourcesTab d={d} owner={owner} />}
      {tab === 'stock' && <StockTab d={d} owner={owner} />}

      {tab === 'inputs' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={tx('Asked from the customer before buying', 'يُطلب من العميل قبل الشراء')} className="lg:col-span-2">
            {f.input_fields.map((fl, i) => {
              const upd = (patch: Partial<InputField>) => set('input_fields', f.input_fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="mb-3 grid gap-2 rounded-lg border border-ink-700 p-3 sm:grid-cols-2">
                  <Field label={tx('Field', 'الحقل')}>
                    <Select value={['email', 'account', 'identifier', 'months'].includes(fl.key) ? fl.key : 'custom'} onChange={(e) => upd({ key: e.target.value === 'custom' ? 'note' : e.target.value })} options={[
                      { value: 'email', label: tx('Email', 'البريد الإلكتروني') }, { value: 'account', label: tx('Account (login / ID)', 'الحساب (الدخول / المعرّف)') }, { value: 'identifier', label: tx('Identifier (@username, ID…)', 'المعرّف (@username، ID…)') },
                      { value: 'months', label: tx('Months', 'الأشهر') }, { value: 'custom', label: tx('Custom…', 'مخصص…') },
                    ]} />
                  </Field>
                  <Field label={tx('Key', 'المفتاح')}><Input value={fl.key} onChange={(e) => upd({ key: e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase() })} /></Field>
                  <Field label={tx('Question (EN)', 'السؤال (إنجليزي)')}><Input value={fl.label_en ?? ''} onChange={(e) => upd({ label_en: e.target.value })} /></Field>
                  <Field label={tx('Question (AR)', 'السؤال (عربي)')}><Input dir="rtl" value={fl.label_ar ?? ''} onChange={(e) => upd({ label_ar: e.target.value })} /></Field>
                  <Field label={tx('Allowed values', 'القيم المسموحة')} hint={tx('Comma separated, optional', 'مفصولة بفواصل، اختياري')}><Input value={(fl.options ?? []).join(',')} onChange={(e) => upd({ options: e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : undefined })} /></Field>
                  <Field label={tx('Fixed value', 'قيمة ثابتة')} hint={tx('If set, the customer is not asked', 'إن وُجدت لا يُسأل العميل')}><Input value={fl.fixed == null ? '' : String(fl.fixed)} onChange={(e) => upd({ fixed: e.target.value === '' ? undefined : e.target.value })} /></Field>
                  <div className="flex items-center gap-4 sm:col-span-2">
                    <Switch checked={!!fl.per_unit} onChange={(v) => upd({ per_unit: v })} label={tx('One per unit', 'واحد لكل وحدة')} />
                    <Switch checked={fl.required !== false} onChange={(v) => upd({ required: v })} label={tx('Required', 'إلزامي')} />
                    <Button size="sm" variant="ghost" className="ms-auto" onClick={() => set('input_fields', f.input_fields.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /> {tx('Remove', 'إزالة')}</Button>
                  </div>
                </div>
              );
            })}
            <Button size="sm" onClick={() => set('input_fields', [...f.input_fields, { key: 'email', required: true }])}><Plus className="h-3.5 w-3.5" /> {tx('Add field', 'إضافة حقل')}</Button>
          </Card>
          <Card title={tx('Required by sources', 'مطلوب من المصادر')}>
            {d.inputs.ask.length === 0 && Object.keys(d.inputs.fixed).length === 0 ? <p className="text-sm text-ink-400">{tx('No inputs needed.', 'لا حاجة لبيانات.')}</p> : (
              <div className="space-y-1 text-sm">
                {d.inputs.ask.map((a) => <div key={a.key}><Badge tone="purple">{a.key}</Badge> {a.per_unit && <span className="text-xs text-ink-400">{tx('per unit', 'لكل وحدة')}</span>} {a.options && <span className="text-xs text-ink-400">({a.options.join(', ')})</span>}</div>)}
                {Object.entries(d.inputs.fixed).map(([k, v]) => <div key={k}><Badge>{k} = {String(v)}</Badge></div>)}
              </div>
            )}
            <p className="mt-3 text-xs text-ink-400">{tx('Provider requirements (e.g. email for slot products) are asked automatically; add a field here to customise the question.', 'متطلبات المزود (مثل البريد لمنتجات المقاعد) تُطلب تلقائياً؛ أضف حقلاً هنا لتخصيص السؤال.')}</p>
          </Card>
        </div>
      )}

      {tab === 'delivery' && (
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tx('Fulfilment', 'طريقة التنفيذ')}>
              <Select value={f.fulfillment} onChange={(e) => set('fulfillment', e.target.value as Product['fulfillment'])} options={[
                { value: 'auto', label: tx('Automatic (sources)', 'تلقائي (المصادر)') }, { value: 'manual', label: tx('Always manual (admin delivers)', 'يدوي دائماً (يسلّم المشرف)') },
              ]} />
            </Field>
            <Field label={tx('On failure', 'عند الفشل')} hint={tx('When a source fails without charging', 'عندما يفشل مصدر دون خصم المبلغ')}>
              <Select value={f.on_failure ?? ''} onChange={(e) => set('on_failure', e.target.value || null)} options={[
                { value: '', label: tx('Default (Settings → Pricing)', 'الافتراضي (الإعدادات ← التسعير)') }, { value: 'next_source', label: tx('Try the next source', 'جرّب المصدر التالي') },
                { value: 'refund', label: tx('Refund to wallet', 'استرداد إلى المحفظة') }, { value: 'manual', label: tx('Send to manual queue', 'إرسال إلى الطلبات اليدوية') },
              ]} />
            </Field>
            <Field label={tx('Warranty (days)', 'الضمان (أيام)')} locked={locked('warranty_days')} onUnlock={() => unlock('warranty_days')}><NumberInput value={f.warranty_days} onChange={(v) => set('warranty_days', v ?? 0)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tx('Min qty', 'أقل كمية')}><NumberInput value={f.min_qty} onChange={(v) => set('min_qty', v ?? 1)} /></Field>
              <Field label={tx('Max qty', 'أكبر كمية')}><NumberInput value={f.max_qty} onChange={(v) => set('max_qty', v ?? 1)} /></Field>
            </div>
            <Field label={tx('Quantity buttons', 'أزرار الكمية')} hint={tx('Comma separated, empty = default', 'مفصولة بفواصل، فارغ = الافتراضي')}><Input value={(f.qty_presets ?? []).join(',')} onChange={(e) => set('qty_presets', e.target.value ? e.target.value.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0) : null)} /></Field>
            <div />
            <Field label={tx('Delivery note (EN)', 'ملاحظة التسليم (إنجليزي)')} hint={tx('Appended to the delivery message (instructions, links…)', 'تُضاف إلى رسالة التسليم (تعليمات، روابط…)')}><Textarea value={f.delivery_note_en ?? ''} onChange={(e) => set('delivery_note_en', e.target.value || null)} /></Field>
            <Field label={tx('Delivery note (AR)', 'ملاحظة التسليم (عربي)')}><Textarea dir="rtl" value={f.delivery_note_ar ?? ''} onChange={(e) => set('delivery_note_ar', e.target.value || null)} /></Field>
          </div>
        </Card>
      )}

      {hasDirty && (
        <div className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-end gap-3 rounded-xl border border-gold/40 bg-ink-850 px-4 py-2 shadow-2xl sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2">
          <span className="me-auto text-sm text-ink-300 sm:me-0">{tx('Unsaved changes', 'تغييرات غير محفوظة')}</span>
          <Button size="sm" onClick={() => setF(d.product)}>{tx('Discard', 'تجاهل')}</Button>
          <Button size="sm" variant="primary" loading={busy === 'save'} onClick={() => void save()}>{tx('Save', 'حفظ')}</Button>
        </div>
      )}
    </>
  );
}
