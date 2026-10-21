import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Download, Plus, Save, Trash2 } from 'lucide-react';
import { api, apiDownload, qs } from '../lib/api';
import { useAction, useApi, useIsOwner, type Paged } from '../lib/hooks';
import { usd, dt } from '../lib/format';
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
}
interface Source {
  id: string; kind: 'provider' | 'stock' | 'manual'; priority: number; is_enabled: boolean; provider_name: string | null;
  provider_product: { id: string; name: string; external_id: string; cost: number | null; stock: number | null; is_removed: boolean; is_available: boolean; delivery_kind: string; warranty_days: number | null } | null;
  unit_cost: number | null; available: number | null; usable: boolean; reason: string | null; route_position: number; profit: number | null;
}
interface Detail {
  product: Product;
  pricing: { unit_price: number | null; original_unit_price: number | null; reference_cost: number | null; profit: number | null; available: number | null; sold_out: boolean };
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
  const [q, setQ] = useState('');
  const { run, busy } = useAction();
  const res = useApi<{ items: { id: string; name: string; provider_name: string; cost: number | null; stock: number | null }[] }>(`/provider-products${qs({ q })}`);
  const add = (body: Record<string, unknown>) => run('add', () => api(`/products/${productId}/sources`, { body }), { success: 'Source added', invalidate: [`/products/${productId}`] }).then((r) => r && onClose());
  return (
    <Dialog open onClose={onClose} title="Add source" wide>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button loading={busy === 'add'} onClick={() => void add({ kind: 'stock' })}>My stock</Button>
        <Button loading={busy === 'add'} onClick={() => void add({ kind: 'manual' })}>Manual delivery</Button>
      </div>
      <Input placeholder="Search provider products…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      <div className="max-h-[50vh] overflow-y-auto">
        <Table head={['Provider', 'Product', 'Cost', 'Stock', '']} empty={!res.data?.items.length}>
          {(res.data?.items ?? []).map((p) => (
            <tr key={p.id}>
              <td className="td text-ink-400">{p.provider_name}</td>
              <td className="td">{p.name}</td>
              <td className="td">{usd(p.cost)}</td>
              <td className="td">{p.stock ?? '∞'}</td>
              <td className="td text-end"><Button size="sm" variant="primary" onClick={() => void add({ kind: 'provider', provider_product_id: p.id })}>Add</Button></td>
            </tr>
          ))}
        </Table>
      </div>
    </Dialog>
  );
}

function SourcesTab({ d, owner }: { d: Detail; owner: boolean }) {
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
    <Card title="Sources" actions={owner && <Button size="sm" variant="primary" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add source</Button>}>
      <p className="mb-3 text-xs text-ink-400">
        Orders are routed {d.product.routing === 'cheapest' ? 'to the cheapest usable source first' : 'in priority order (top first)'}; if a source fails safely the next one is tried (see Delivery → On failure).
      </p>
      <Table head={['#', 'Source', 'Cost', 'Available', 'Profit / unit', 'Status', '']} empty={!sources.length}>
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
              ) : <div className="font-medium capitalize">{s.kind === 'stock' ? 'My stock' : 'Manual delivery'}</div>}
            </td>
            <td className="td">{usd(s.unit_cost)}</td>
            <td className="td">{s.available == null ? '∞' : s.available}</td>
            <td className="td">{s.profit == null ? '—' : <span className={s.profit < 0 ? 'text-red-400' : 'text-emerald-400'}>{usd(s.profit)}</span>}</td>
            <td className="td">{s.usable ? <Badge tone="green">usable</Badge> : <Badge tone="red">{s.reason ?? 'unusable'}</Badge>}</td>
            <td className="td text-end">
              {owner && <div className="flex items-center justify-end gap-2">
                <Switch checked={s.is_enabled} onChange={(v) => void run('toggle', () => api(`/sources/${s.id}`, { method: 'PATCH', body: { is_enabled: v } }), { invalidate: inv })} />
                <Button size="sm" variant="ghost" onClick={() => { if (confirm('Remove this source?')) void run('del', () => api(`/sources/${s.id}`, { method: 'DELETE' }), { invalidate: inv }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
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
      <Card title="Add stock" className="lg:col-span-2">
        {!hasStockSource && <p className="mb-2 text-xs text-gold">A “My stock” source will be added automatically.</p>}
        <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'user1@mail.com:pass123\nuser2@mail.com:pass456\nhttps://redeem.link/abc'} className="font-mono text-xs" />
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="Separator" className="w-32"><Select value={sep} onChange={(e) => setSep(e.target.value)} options={[{ value: '\\n', label: 'New line' }, { value: '\n\n', label: 'Blank line' }, { value: '---', label: '---' }, { value: ';', label: ';' }]} /></Field>
          <Button variant="primary" disabled={!lines} loading={busy === 'add'} onClick={async () => {
            const r = await run('add', () => api<{ added: number; skipped: number }>(`/products/${pid}/stock`, { body: { text, separator: sep } }), { invalidate: inv });
            if (r) { setText(''); alert(`Added ${r.added} items${r.skipped ? `, skipped ${r.skipped} duplicates` : ''}`); }
          }}>Add {lines || ''} items</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5 text-xs">{Object.entries(d.stock).map(([k, v]) => <Badge key={k} tone={k === 'available' ? 'green' : 'gray'}>{k}: {v}</Badge>)}</div>
      </Card>
      <Card title="Items" className="lg:col-span-3" actions={<>
        <Select className="!w-36 !py-1 text-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); setSel(new Set()); }} options={['available', 'sold', 'invalid', 'reserved'].map((s) => ({ value: s, label: s }))} />
        {owner && <Button size="sm" onClick={() => void apiDownload(`/products/${pid}/stock/export${qs({ status })}`, `stock-${status}.txt`)}><Download className="h-3.5 w-3.5" /></Button>}
      </>}>
        {sel.size > 0 && (
          <div className="mb-2 flex gap-2">
            <Button size="sm" onClick={() => void run('upd', () => api('/stock/update', { body: { ids: [...sel], action: 'invalid' } }), { invalidate: inv }).then(() => setSel(new Set()))}>Mark invalid</Button>
            {status === 'invalid' && <Button size="sm" onClick={() => void run('upd', () => api('/stock/update', { body: { ids: [...sel], action: 'available' } }), { invalidate: inv }).then(() => setSel(new Set()))}>Mark available</Button>}
            <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete ${sel.size} items?`)) void run('upd', () => api('/stock/update', { body: { ids: [...sel], action: 'delete' } }), { invalidate: inv }).then(() => setSel(new Set())); }}>Delete</Button>
          </div>
        )}
        {list.isLoading ? <Loading /> : (
          <>
            <Table head={['', 'Content', 'Added', status === 'sold' ? 'Order' : '']} empty={!list.data?.items.length}>
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
  const nav = useNavigate();
  const owner = useIsOwner();
  const q = useApi<Detail>(`/products/${id}`);
  const cats = useApi<{ categories: { id: string; name_en: string }[] }>('/categories');
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
    delete out.locked_fields;
    delete out.sold_count;
    return out;
  }, [f, q.data]);

  if (q.isLoading || !f) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const d = q.data!;
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setF({ ...f, [k]: v });
  const locked = (k: string) => (d.syncable_fields.includes(k) && f.auto_sync_info && d.sources.some((s) => s.kind === 'provider') ? d.product.locked_fields.includes(k) : undefined);
  const unlock = (k: string) => { if (confirm('Reset to the provider value on the next sync?')) void run('unlock', () => api(`/products/${id}/unlock`, { body: { fields: [k] } }), { success: 'Unlocked', invalidate: [`/products/${id}`] }); };
  const hasDirty = Object.keys(dirty).length > 0;

  const save = () => run('save', () => api(`/products/${id}`, { method: 'PATCH', body: dirty }), { success: 'Saved', invalidate: [`/products/${id}`, '/products'] });

  const estPrice = (() => {
    if (f.pricing_mode === 'manual') return f.manual_price;
    const cost = d.pricing.reference_cost;
    if (cost == null) return null;
    return cost * (1 + (f.markup_percent ?? 0) / 100) + (f.markup_fixed ?? 0);
  })();

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><Link to="/products" className="text-ink-400 hover:text-white"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link><span className="truncate">{f.emoji} {d.product.name_en}</span></span>}
        sub={<span className="flex flex-wrap items-center gap-2">
          {d.product.is_active ? <Badge tone="green">visible</Badge> : <Badge>hidden</Badge>}
          {d.pricing.sold_out ? <Badge tone="red">sold out</Badge> : <Badge tone="gold">{usd(d.pricing.unit_price)}</Badge>}
          <span>available: {d.pricing.available == null ? '∞' : d.pricing.available}</span>
          {owner && d.pricing.profit != null && <span>profit/unit: <span className={d.pricing.profit < 0 ? 'text-red-400' : 'text-emerald-400'}>{usd(d.pricing.profit)}</span></span>}
          <span>sold: {d.product.sold_count}</span>
        </span>}
        actions={<>
          {owner && <Button onClick={() => void run('dup', () => api<{ product: { id: string } }>(`/products/${id}/duplicate`, { method: 'POST' }), { success: 'Duplicated', invalidate: ['/products'] }).then((r) => r && nav(`/products/${r.product.id}`))}><Copy className="h-4 w-4" /></Button>}
          {owner && <Button variant="danger" onClick={() => { if (confirm('Delete this product? Orders keep their history.')) void run('del', () => api(`/products/${id}`, { method: 'DELETE' }), { invalidate: ['/products'] }).then(() => nav('/products')); }}><Trash2 className="h-4 w-4" /></Button>}
          <Button variant="primary" disabled={!hasDirty} loading={busy === 'save'} onClick={() => void save()}><Save className="h-4 w-4" /> Save</Button>
        </>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'info', label: 'Info' },
        ...(owner ? [{ value: 'pricing' as Tab, label: 'Pricing' }] : []),
        { value: 'sources', label: `Sources (${d.sources.length})` },
        { value: 'stock', label: `Stock (${d.stock.available ?? 0})` },
        { value: 'inputs', label: 'Customer inputs' },
        { value: 'delivery', label: 'Delivery & warranty' },
      ]} />

      {tab === 'info' && (
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name (EN)" locked={locked('name_en')} onUnlock={() => unlock('name_en')}><Input value={f.name_en} onChange={(e) => set('name_en', e.target.value)} /></Field>
            <Field label="Name (AR)"><Input dir="rtl" value={f.name_ar ?? ''} onChange={(e) => set('name_ar', e.target.value || null)} /></Field>
            <Field label="Description (EN)" locked={locked('description_en')} onUnlock={() => unlock('description_en')} hint="Telegram HTML allowed: <b>, <i>, <code>"><Textarea rows={7} value={f.description_en ?? ''} onChange={(e) => set('description_en', e.target.value || null)} /></Field>
            <Field label="Description (AR)"><Textarea dir="rtl" rows={7} value={f.description_ar ?? ''} onChange={(e) => set('description_ar', e.target.value || null)} /></Field>
            <Field label="Duration (EN)"><Input value={f.duration_en ?? ''} onChange={(e) => set('duration_en', e.target.value || null)} placeholder="1 month" /></Field>
            <Field label="Duration (AR)"><Input dir="rtl" value={f.duration_ar ?? ''} onChange={(e) => set('duration_ar', e.target.value || null)} placeholder="شهر واحد" /></Field>
            <Field label="Category">
              <Select value={f.category_id ?? ''} onChange={(e) => set('category_id', e.target.value || null)} options={[{ value: '', label: '— none (hidden) —' }, ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name_en }))]} />
            </Field>
            <Field label="Button color"><StyleSelect allowInherit value={f.button_style} onChange={(v) => set('button_style', v)} /></Field>
            <Field label="Emoji (fallback)" locked={locked('emoji')} onUnlock={() => unlock('emoji')}><Input value={f.emoji ?? ''} onChange={(e) => set('emoji', e.target.value || null)} /></Field>
            <Field label="Custom emoji ID (premium)"><Input value={f.custom_emoji_id ?? ''} onChange={(e) => set('custom_emoji_id', e.target.value.replace(/\D/g, '') || null)} /></Field>
            <Field label="Image" locked={locked('image_url')} onUnlock={() => unlock('image_url')} className="md:col-span-2"><ImageInput value={f.image_url} onChange={(v) => set('image_url', v)} /></Field>
            <div className="flex flex-wrap gap-6 md:col-span-2">
              <Switch checked={f.is_active} onChange={(v) => set('is_active', v)} label="Visible in the bot" />
              <Switch checked={f.is_featured} onChange={(v) => set('is_featured', v)} label="Featured (landing page)" />
              {owner && <Switch checked={f.auto_sync_info} onChange={(v) => set('auto_sync_info', v)} label="Sync info from provider" />}
            </div>
          </div>
        </Card>
      )}

      {tab === 'pricing' && owner && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Price" className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Pricing mode" className="sm:col-span-2">
                <Select value={f.pricing_mode} onChange={(e) => set('pricing_mode', e.target.value as Product['pricing_mode'])} options={[
                  { value: 'markup', label: 'Cost + markup (follows provider price changes)' },
                  { value: 'manual', label: 'Manual fixed price' },
                ]} />
              </Field>
              {f.pricing_mode === 'markup' ? (
                <>
                  <Field label="Markup %" hint="Empty = default from Settings → Pricing"><NumberInput allowNull value={f.markup_percent} onChange={(v) => set('markup_percent', v)} /></Field>
                  <Field label="Markup fixed ($)" hint="Added after the %"><NumberInput allowNull value={f.markup_fixed} onChange={(v) => set('markup_fixed', v)} /></Field>
                </>
              ) : (
                <Field label="Price ($)"><NumberInput allowNull value={f.manual_price} onChange={(v) => set('manual_price', v)} /></Field>
              )}
              <Field label="Base cost ($)" hint="Cost of stock/manual sources (for profit & markup)"><NumberInput allowNull value={f.base_cost} onChange={(v) => set('base_cost', v)} /></Field>
              <Field label="Sale %" hint="Shown as a discount on the price"><NumberInput value={f.sale_percent} onChange={(v) => set('sale_percent', v ?? 0)} /></Field>
              <Field label="Compare-at price ($)" hint="Optional 'was' price shown struck through"><NumberInput allowNull value={f.compare_at_price} onChange={(v) => set('compare_at_price', v)} /></Field>
              <Field label="Routing" className="sm:col-span-2">
                <Select value={f.routing} onChange={(e) => set('routing', e.target.value as Product['routing'])} options={[{ value: 'priority', label: 'Priority order (Sources tab)' }, { value: 'cheapest', label: 'Cheapest source first' }]} />
              </Field>
            </div>
            <div className="mt-5">
              <div className="label">Quantity discounts</div>
              {f.qty_discounts.map((qd, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <span className="text-sm text-ink-400">from</span>
                  <NumberInput className="!w-24" value={qd.min_qty} onChange={(v) => set('qty_discounts', f.qty_discounts.map((x, j) => (j === i ? { ...x, min_qty: v ?? 1 } : x)))} />
                  <span className="text-sm text-ink-400">units →</span>
                  <NumberInput className="!w-24" value={qd.percent} onChange={(v) => set('qty_discounts', f.qty_discounts.map((x, j) => (j === i ? { ...x, percent: v ?? 0 } : x)))} />
                  <span className="text-sm text-ink-400">% off</span>
                  <Button size="sm" variant="ghost" onClick={() => set('qty_discounts', f.qty_discounts.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
              <Button size="sm" onClick={() => set('qty_discounts', [...f.qty_discounts, { min_qty: 5, percent: 5 }])}><Plus className="h-3.5 w-3.5" /> Add tier</Button>
            </div>
          </Card>
          <Card title="Preview">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-ink-400">Reference cost</span><span>{usd(d.pricing.reference_cost)}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">Base price (unsaved)</span><span>{usd(estPrice)}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">After sale</span><span>{usd(estPrice != null ? estPrice * (1 - (f.sale_percent || 0) / 100) : null)}</span></div>
              <hr className="border-ink-700" />
              <div className="flex justify-between"><span className="text-ink-400">Saved price (rounded)</span><span className="font-semibold text-gold">{usd(d.pricing.unit_price)}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">Profit / unit</span><span className={(d.pricing.profit ?? 0) < 0 ? 'text-red-400' : 'text-emerald-400'}>{usd(d.pricing.profit)}</span></div>
              <p className="pt-2 text-xs text-ink-400">Customers may pay less with their personal discount level or a promo code. Rounding rule: Settings → Pricing.</p>
            </div>
          </Card>
        </div>
      )}

      {tab === 'sources' && <SourcesTab d={d} owner={owner} />}
      {tab === 'stock' && <StockTab d={d} owner={owner} />}

      {tab === 'inputs' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Asked from the customer before buying" className="lg:col-span-2">
            {f.input_fields.map((fl, i) => {
              const upd = (patch: Partial<InputField>) => set('input_fields', f.input_fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="mb-3 grid gap-2 rounded-lg border border-ink-700 p-3 sm:grid-cols-2">
                  <Field label="Field">
                    <Select value={['email', 'account', 'identifier', 'months'].includes(fl.key) ? fl.key : 'custom'} onChange={(e) => upd({ key: e.target.value === 'custom' ? 'note' : e.target.value })} options={[
                      { value: 'email', label: 'Email' }, { value: 'account', label: 'Account (login / ID)' }, { value: 'identifier', label: 'Identifier (@username, ID…)' },
                      { value: 'months', label: 'Months' }, { value: 'custom', label: 'Custom…' },
                    ]} />
                  </Field>
                  <Field label="Key"><Input value={fl.key} onChange={(e) => upd({ key: e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase() })} /></Field>
                  <Field label="Question (EN)"><Input value={fl.label_en ?? ''} onChange={(e) => upd({ label_en: e.target.value })} /></Field>
                  <Field label="Question (AR)"><Input dir="rtl" value={fl.label_ar ?? ''} onChange={(e) => upd({ label_ar: e.target.value })} /></Field>
                  <Field label="Allowed values" hint="Comma separated, optional"><Input value={(fl.options ?? []).join(',')} onChange={(e) => upd({ options: e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : undefined })} /></Field>
                  <Field label="Fixed value" hint="If set, the customer is not asked"><Input value={fl.fixed == null ? '' : String(fl.fixed)} onChange={(e) => upd({ fixed: e.target.value === '' ? undefined : e.target.value })} /></Field>
                  <div className="flex items-center gap-4 sm:col-span-2">
                    <Switch checked={!!fl.per_unit} onChange={(v) => upd({ per_unit: v })} label="One per unit" />
                    <Switch checked={fl.required !== false} onChange={(v) => upd({ required: v })} label="Required" />
                    <Button size="sm" variant="ghost" className="ms-auto" onClick={() => set('input_fields', f.input_fields.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
                  </div>
                </div>
              );
            })}
            <Button size="sm" onClick={() => set('input_fields', [...f.input_fields, { key: 'email', required: true }])}><Plus className="h-3.5 w-3.5" /> Add field</Button>
          </Card>
          <Card title="Required by sources">
            {d.inputs.ask.length === 0 && Object.keys(d.inputs.fixed).length === 0 ? <p className="text-sm text-ink-400">No inputs needed.</p> : (
              <div className="space-y-1 text-sm">
                {d.inputs.ask.map((a) => <div key={a.key}><Badge tone="purple">{a.key}</Badge> {a.per_unit && <span className="text-xs text-ink-400">per unit</span>} {a.options && <span className="text-xs text-ink-400">({a.options.join(', ')})</span>}</div>)}
                {Object.entries(d.inputs.fixed).map(([k, v]) => <div key={k}><Badge>{k} = {String(v)}</Badge></div>)}
              </div>
            )}
            <p className="mt-3 text-xs text-ink-400">Provider requirements (e.g. email for slot products) are asked automatically; add a field here to customise the question.</p>
          </Card>
        </div>
      )}

      {tab === 'delivery' && (
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fulfilment">
              <Select value={f.fulfillment} onChange={(e) => set('fulfillment', e.target.value as Product['fulfillment'])} options={[
                { value: 'auto', label: 'Automatic (sources)' }, { value: 'manual', label: 'Always manual (admin delivers)' },
              ]} />
            </Field>
            <Field label="On failure" hint="When a source fails without charging">
              <Select value={f.on_failure ?? ''} onChange={(e) => set('on_failure', e.target.value || null)} options={[
                { value: '', label: 'Default (Settings → Pricing)' }, { value: 'next_source', label: 'Try the next source' },
                { value: 'refund', label: 'Refund to wallet' }, { value: 'manual', label: 'Send to manual queue' },
              ]} />
            </Field>
            <Field label="Warranty (days)" locked={locked('warranty_days')} onUnlock={() => unlock('warranty_days')}><NumberInput value={f.warranty_days} onChange={(v) => set('warranty_days', v ?? 0)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min qty"><NumberInput value={f.min_qty} onChange={(v) => set('min_qty', v ?? 1)} /></Field>
              <Field label="Max qty"><NumberInput value={f.max_qty} onChange={(v) => set('max_qty', v ?? 1)} /></Field>
            </div>
            <Field label="Quantity buttons" hint="Comma separated, empty = default"><Input value={(f.qty_presets ?? []).join(',')} onChange={(e) => set('qty_presets', e.target.value ? e.target.value.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0) : null)} /></Field>
            <div />
            <Field label="Delivery note (EN)" hint="Appended to the delivery message (instructions, links…)"><Textarea value={f.delivery_note_en ?? ''} onChange={(e) => set('delivery_note_en', e.target.value || null)} /></Field>
            <Field label="Delivery note (AR)"><Textarea dir="rtl" value={f.delivery_note_ar ?? ''} onChange={(e) => set('delivery_note_ar', e.target.value || null)} /></Field>
          </div>
        </Card>
      )}

      {hasDirty && (
        <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-gold/40 bg-ink-850 px-4 py-2 shadow-2xl">
          <span className="text-sm text-ink-300">Unsaved changes</span>
          <Button size="sm" onClick={() => setF(d.product)}>Discard</Button>
          <Button size="sm" variant="primary" loading={busy === 'save'} onClick={() => void save()}>Save</Button>
        </div>
      )}
    </>
  );
}
