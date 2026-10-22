import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Eye, FolderPlus, RefreshCw } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { usd, ago } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, PageHeader, Select, Table, Tabs, useToast } from '../components/ui';

export interface PP {
  id: string; provider_id: string; external_id: string; name: string; description: string | null; image_url: string | null;
  delivery_kind: string; raw_type: string | null; cost: number | null; cost_original: number | null; cost_currency: string;
  stock: number | null; sold: number | null; warranty_days: number | null; requirements: { fields?: { key: string }[]; quantity_fixed?: number };
  is_available: boolean; is_removed: boolean; is_new: boolean; last_changed_at: string; removed_at: string | null;
  links: { product_id: string; product_name: string }[];
}

interface Cat { id: string; name_en: string }

/** Inline "+ New category" form; returns the created category. */
function NewCategoryForm({ onCreated, onCancel }: { onCreated: (c: Cat) => void; onCancel: () => void }) {
  const { run, busy } = useAction();
  const [v, setV] = useState({ name_en: '', name_ar: '', emoji: '' });
  const create = async () => {
    const r = await run('cat', () => api<{ category: Cat }>('/categories', {
      body: { name_en: v.name_en.trim(), name_ar: v.name_ar.trim() || null, emoji: v.emoji.trim() || null },
    }), { success: `Category "${v.name_en.trim()}" created`, invalidate: ['/categories'] });
    if (r) onCreated(r.category);
  };
  return (
    <div className="grid gap-2 rounded-lg border border-gold/30 p-3 sm:grid-cols-[1fr_1fr_80px_auto]">
      <Field label="Category name (EN)"><Input autoFocus value={v.name_en} onChange={(e) => setV({ ...v, name_en: e.target.value })} placeholder="ChatGPT" /></Field>
      <Field label="Category name (AR)"><Input dir="rtl" value={v.name_ar} onChange={(e) => setV({ ...v, name_ar: e.target.value })} placeholder="شات جي بي تي" /></Field>
      <Field label="Emoji"><Input value={v.emoji} onChange={(e) => setV({ ...v, emoji: e.target.value })} placeholder="🤖" /></Field>
      <div className="flex items-end gap-2">
        <Button variant="primary" size="sm" disabled={!v.name_en.trim()} loading={busy === 'cat'} onClick={create}>Create</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * Review step: every selected provider product gets its own category (and optionally a new
 * name) before it is imported. Products already in the store are skipped.
 */
function ImportReview({ rows, onClose, providerName }: { rows: PP[]; onClose: () => void; providerName: string }) {
  const cats = useApi<{ categories: Cat[] }>('/categories');
  const { run, busy } = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const fresh = rows.filter((r) => !r.links.length && !r.is_removed);
  const skipped = rows.length - fresh.length;

  const [mode, setMode] = useState<'separate' | 'group'>('separate');
  const [extraCats, setExtraCats] = useState<Cat[]>([]);
  const allCats = useMemo(() => {
    const m = new Map<string, Cat>();
    for (const c of [...(cats.data?.categories ?? []), ...extraCats]) m.set(c.id, c);
    return [...m.values()];
  }, [cats.data, extraCats]);
  const [creating, setCreating] = useState(false);
  const [bulkCat, setBulkCat] = useState('');
  const [rowCat, setRowCat] = useState<Record<string, string>>({});
  const [rowName, setRowName] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set(fresh.map((r) => r.id)));

  // group mode
  const [target, setTarget] = useState<'new' | 'existing'>('new');
  const [groupCat, setGroupCat] = useState('');
  const [groupName, setGroupName] = useState({ name_en: '', name_ar: '' });
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [routing, setRouting] = useState<'priority' | 'cheapest'>('priority');
  const products = useApi<Paged<{ id: string; name_en: string }>>(mode === 'group' && target === 'existing' ? `/products${qs({ q: search, limit: 20 })}` : null);

  const catOptions = [{ value: '', label: '— no category (Other products) —' }, ...allCats.map((c) => ({ value: c.id, label: c.name_en }))];
  const applyBulk = () => {
    const next = { ...rowCat };
    for (const r of fresh) if (checked.has(r.id)) next[r.id] = bulkCat;
    setRowCat(next);
  };
  const allChecked = fresh.length > 0 && fresh.every((r) => checked.has(r.id));

  const submit = async () => {
    const r = await run('import', () => {
      if (mode === 'group') {
        const named = target === 'new' && groupName.name_en.trim();
        return api<{ product_ids: string[]; skipped?: number }>('/import', {
          body: {
            provider_product_ids: fresh.map((p) => p.id), mode, routing,
            category_id: target === 'new' ? groupCat || null : null,
            product_id: target === 'existing' ? productId || undefined : undefined,
            name_en: named ? groupName.name_en.trim() : undefined,
            name_ar: named ? groupName.name_ar.trim() || undefined : undefined,
          },
        });
      }
      return api<{ product_ids: string[]; skipped?: number }>('/import', {
        body: {
          provider_product_ids: fresh.map((p) => p.id), mode,
          items: fresh.map((p) => ({ id: p.id, category_id: rowCat[p.id] || null, name_en: rowName[p.id]?.trim() || undefined })),
        },
      });
    }, { success: 'Imported', invalidate: ['/providers', '/products', '/categories', '/dashboard'] });
    if (r) {
      if (r.skipped) toast(`${r.skipped} already in the store — skipped`);
      onClose();
      if (r.product_ids.length === 1) nav(`/products/${r.product_ids[0]}`);
    }
  };

  return (
    <Dialog open onClose={onClose} wide title={`Review ${fresh.length} product${fresh.length === 1 ? '' : 's'} from ${providerName}`}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy === 'import'} disabled={!fresh.length || (mode === 'group' && target === 'existing' && !productId)} onClick={submit}>
          Import {fresh.length}
        </Button>
      </>}>
      <div className="space-y-3">
        {skipped > 0 && <p className="text-xs text-ink-400">{skipped} selected product{skipped === 1 ? ' is' : 's are'} already in the store or removed by the provider — skipped.</p>}
        <Field label="How to import">
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'separate' | 'group')} options={[
            { value: 'separate', label: 'Separate — each pack becomes its own product (choose a category per pack)' },
            { value: 'group', label: 'Group — the same pack from several providers becomes ONE product (failover)' },
          ]} />
        </Field>

        {creating
          ? <NewCategoryForm onCreated={(c) => { setExtraCats((x) => [...x, c]); setBulkCat(c.id); setGroupCat(c.id); setCreating(false); }} onCancel={() => setCreating(false)} />
          : <Button size="sm" onClick={() => setCreating(true)}><FolderPlus className="h-4 w-4" /> New category</Button>}

        {mode === 'separate' ? (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Category for the ticked rows" className="min-w-[240px]">
                <Select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} options={catOptions} />
              </Field>
              <Button size="sm" onClick={applyBulk} disabled={!checked.size}>Apply to {checked.size} ticked</Button>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-ink-700">
              <Table head={[
                <input key="all" type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(fresh.map((r) => r.id)))} aria-label="Tick all" />,
                'Product (name in your store)', 'Cost', 'Category',
              ]} empty={!fresh.length}>
                {fresh.map((p) => (
                  <tr key={p.id}>
                    <td className="td w-8"><input type="checkbox" checked={checked.has(p.id)} onChange={() => setChecked((cur) => { const n = new Set(cur); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} /></td>
                    <td className="td min-w-[260px]">
                      <Input value={rowName[p.id] ?? p.name} onChange={(e) => setRowName({ ...rowName, [p.id]: e.target.value })} />
                      <div className="mt-0.5 text-xs text-ink-400">{p.delivery_kind}{p.raw_type ? ` · ${p.raw_type}` : ''}{p.stock === 0 ? ' · out of stock' : ''}</div>
                    </td>
                    <td className="td whitespace-nowrap">{usd(p.cost)}</td>
                    <td className="td min-w-[200px]"><Select value={rowCat[p.id] ?? ''} onChange={(e) => setRowCat({ ...rowCat, [p.id]: e.target.value })} options={catOptions} /></td>
                  </tr>
                ))}
              </Table>
            </div>
            <p className="text-xs text-ink-400">Descriptions, images and warranty are copied and kept in sync. A name you change here is kept (sync won't overwrite it). Price = provider cost + your markup (Settings → Pricing).</p>
          </>
        ) : (
          <>
            <Field label="Group into">
              <Select value={target} onChange={(e) => setTarget(e.target.value as 'new' | 'existing')} options={[{ value: 'new', label: 'A new store product' }, { value: 'existing', label: 'An existing store product' }]} />
            </Field>
            {target === 'new' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Product name (EN)" hint="Empty = the first product's name"><Input value={groupName.name_en} onChange={(e) => setGroupName({ ...groupName, name_en: e.target.value })} placeholder="ChatGPT Plus 1 Month" /></Field>
                <Field label="Product name (AR)"><Input dir="rtl" value={groupName.name_ar} onChange={(e) => setGroupName({ ...groupName, name_ar: e.target.value })} /></Field>
                <Field label="Category"><Select value={groupCat} onChange={(e) => setGroupCat(e.target.value)} options={catOptions} /></Field>
              </div>
            ) : (
              <Field label="Store product">
                <Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
                <Select value={productId} onChange={(e) => setProductId(e.target.value)} options={[{ value: '', label: '— choose —' }, ...(products.data?.items ?? []).map((p) => ({ value: p.id, label: p.name_en }))]} />
              </Field>
            )}
            <Field label="Routing" hint="Priority: try sources in order. Cheapest: lowest cost first.">
              <Select value={routing} onChange={(e) => setRouting(e.target.value as 'priority' | 'cheapest')} options={[{ value: 'priority', label: 'Priority order' }, { value: 'cheapest', label: 'Cheapest first' }]} />
            </Field>
            <ul className="max-h-40 overflow-auto rounded-lg border border-ink-700 p-2 text-sm">
              {fresh.map((p) => <li key={p.id} className="flex justify-between gap-3 py-0.5"><span className="truncate">{p.name}</span><span className="text-ink-400">{usd(p.cost)}</span></li>)}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}

export default function ProviderCatalog() {
  const { id } = useParams();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  // selection keeps the full rows, so it survives switching tabs / searching
  const [sel, setSel] = useState<Map<string, PP>>(new Map());
  const [importing, setImporting] = useState(false);
  const [detail, setDetail] = useState<PP | null>(null);
  const { run, busy } = useAction();
  const providers = useApi<{ providers: { id: string; name: string; last_sync_at: string | null }[] }>('/providers');
  // the whole catalog in one list (no pages), so "select all" really selects everything shown
  const list = useApi<Paged<PP>>(`/providers/${id}/products${qs({ filter, q, all: 1 })}`);
  const provider = providers.data?.providers.find((p) => p.id === id);

  const items = list.data?.items ?? [];
  const selectable = items.filter((i) => !i.is_removed);
  const allSelected = selectable.length > 0 && selectable.every((i) => sel.has(i.id));
  const toggle = (p: PP) => setSel((cur) => { const n = new Map(cur); if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p); return n; });
  const toggleAll = () => setSel((cur) => {
    const n = new Map(cur);
    if (allSelected) selectable.forEach((i) => n.delete(i.id)); else selectable.forEach((i) => n.set(i.id, i));
    return n;
  });

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><Link to="/providers" className="text-ink-400 hover:text-white"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link>{provider?.name ?? 'Provider'} catalog</span>}
        sub={`Synced ${ago(provider?.last_sync_at)}. Only imported products are shown in the bot.`}
        actions={<>
          <Button loading={busy === 'seen'} onClick={() => run('seen', () => api('/provider-products/mark-seen', { body: { provider_id: id } }), { success: 'Marked as seen', invalidate: ['/providers', '/dashboard'] })}><Eye className="h-4 w-4" /> Mark all seen</Button>
          <Button loading={busy === 'sync'} onClick={() => run('sync', () => api(`/providers/${id}/sync`, { method: 'POST' }), { success: 'Synced', invalidate: ['/providers'] })}><RefreshCw className="h-4 w-4" /> Sync</Button>
          <Button variant="primary" disabled={!sel.size} onClick={() => setImporting(true)}><Download className="h-4 w-4" /> Review & import {sel.size || ''}</Button>
        </>}
      />
      <Tabs value={filter} onChange={setFilter} tabs={[
        { value: 'all', label: 'All' }, { value: 'new', label: 'New' }, { value: 'unlinked', label: 'Not imported' },
        { value: 'linked', label: 'In store' }, { value: 'available', label: 'In stock' }, { value: 'removed', label: 'Removed' },
      ]} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
          <span className="text-xs text-ink-400">{items.length} shown · {sel.size} selected</span>
          {sel.size > 0 && <Button size="sm" variant="ghost" onClick={() => setSel(new Map())}>Clear selection</Button>}
        </div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <Table head={[
            <input key="all" type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all shown" />,
            'Name', 'Type', 'Cost', 'Stock', 'Warranty', 'Store',
          ]} empty={!items.length}>
            {items.map((p) => (
              <tr key={p.id} className={p.is_removed ? 'opacity-50' : sel.has(p.id) ? 'bg-gold/5' : undefined}>
                <td className="td"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p)} disabled={p.is_removed} /></td>
                <td className="td">
                  <button className="text-start hover:text-gold" onClick={() => setDetail(p)}>{p.name}</button>
                  <div className="mt-0.5 flex gap-1">
                    {p.is_new && !p.is_removed && <Badge tone="gold">new</Badge>}
                    {p.is_removed && <Badge tone="red">removed</Badge>}
                    {p.requirements?.fields?.map((f) => <Badge key={f.key} tone="purple">needs {f.key}</Badge>)}
                  </div>
                </td>
                <td className="td"><Badge>{p.delivery_kind}</Badge> <span className="text-xs text-ink-400">{p.raw_type}</span></td>
                <td className="td whitespace-nowrap">{usd(p.cost)}{p.cost_currency !== 'USD' && <div className="text-xs text-ink-400">{p.cost_original} {p.cost_currency}</div>}</td>
                <td className="td">{p.stock == null ? <span className="text-ink-400">∞</span> : p.stock === 0 ? <Badge tone="red">0</Badge> : p.stock}</td>
                <td className="td">{p.warranty_days ? `${p.warranty_days}d` : '—'}</td>
                <td className="td">{p.links.length ? p.links.map((l) => <Link key={l.product_id} to={`/products/${l.product_id}`} className="block max-w-[180px] truncate text-xs text-gold hover:underline">{l.product_name}</Link>) : <span className="text-xs text-ink-400">—</span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {importing && <ImportReview rows={[...sel.values()]} providerName={provider?.name ?? ''} onClose={() => { setImporting(false); setSel(new Map()); }} />}
      {detail && (
        <Dialog open onClose={() => setDetail(null)} title={detail.name} wide>
          <div className="space-y-2 text-sm">
            {detail.image_url && <img src={detail.image_url} alt="" className="max-h-40 rounded" />}
            <div className="text-ink-400">External ID: <code>{detail.external_id}</code></div>
            <div className="whitespace-pre-wrap">{detail.description || <span className="text-ink-400">No description</span>}</div>
            <pre className="max-h-64 overflow-auto rounded bg-ink-900 p-2 text-xs">{JSON.stringify({ requirements: detail.requirements, delivery_kind: detail.delivery_kind, sold: detail.sold }, null, 2)}</pre>
          </div>
        </Dialog>
      )}
    </>
  );
}
