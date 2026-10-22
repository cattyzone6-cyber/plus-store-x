import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Eye, RefreshCw } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { usd, ago } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select, Table, Tabs, useToast } from '../components/ui';

export interface PP {
  id: string; provider_id: string; external_id: string; name: string; description: string | null; image_url: string | null;
  delivery_kind: string; raw_type: string | null; cost: number | null; cost_original: number | null; cost_currency: string;
  stock: number | null; sold: number | null; warranty_days: number | null; requirements: { fields?: { key: string }[]; quantity_fixed?: number };
  is_available: boolean; is_removed: boolean; is_new: boolean; last_changed_at: string; removed_at: string | null;
  links: { product_id: string; product_name: string }[];
}

function ImportDialog({ ids, onClose, providerName }: { ids: string[]; onClose: () => void; providerName: string }) {
  const cats = useApi<{ categories: { id: string; name_en: string }[] }>('/categories');
  const { run, busy } = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const [mode, setMode] = useState<'separate' | 'group'>(ids.length > 1 ? 'separate' : 'separate');
  const [category, setCategory] = useState('');
  // a new category ("folder", e.g. ChatGPT) can be created right here
  const [newCat, setNewCat] = useState({ name_en: '', name_ar: '', emoji: '' });
  const [groupName, setGroupName] = useState({ name_en: '', name_ar: '' });
  const creatingCat = category === '__new';
  const [target, setTarget] = useState<'new' | 'existing'>('new');
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [routing, setRouting] = useState<'priority' | 'cheapest'>('priority');
  const products = useApi<Paged<{ id: string; name_en: string }>>(mode === 'group' && target === 'existing' ? `/products${qs({ q: search, limit: 20 })}` : null);

  const submit = async () => {
    const r = await run('import', async () => {
      let categoryId: string | null = category && !creatingCat ? category : null;
      if (creatingCat) {
        const c = await api<{ category: { id: string } }>('/categories', {
          body: { name_en: newCat.name_en.trim(), name_ar: newCat.name_ar.trim() || null, emoji: newCat.emoji.trim() || null },
        });
        categoryId = c.category.id;
        setCategory(categoryId);
      }
      const named = mode === 'group' && target === 'new' && groupName.name_en.trim();
      return api<{ product_ids: string[]; skipped?: number }>('/import', {
        body: {
          provider_product_ids: ids, category_id: categoryId, mode, routing,
          product_id: mode === 'group' && target === 'existing' ? productId || undefined : undefined,
          name_en: named ? groupName.name_en.trim() : undefined,
          name_ar: named ? groupName.name_ar.trim() || undefined : undefined,
        },
      });
    }, { success: creatingCat ? 'Category created and products imported' : 'Imported', invalidate: ['/providers', '/products', '/categories', '/dashboard'] });
    if (r) {
      if (r.skipped) toast(`${r.skipped} already in the store — skipped`);
      onClose();
      if (r.product_ids.length === 1) nav(`/products/${r.product_ids[0]}`);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Import ${ids.length} product${ids.length > 1 ? 's' : ''} from ${providerName}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy === 'import'} disabled={(mode === 'group' && target === 'existing' && !productId) || (creatingCat && !newCat.name_en.trim())} onClick={submit}>Import</Button></>}>
      <div className="space-y-3">
        <Field label="How to import">
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'separate' | 'group')} options={[
            { value: 'separate', label: 'Separate — each pack becomes its own product (e.g. ChatGPT Plus 1M, ChatGPT API…)' },
            { value: 'group', label: 'Group — the same pack from several providers becomes ONE product (failover)' },
          ]} />
        </Field>
        {mode === 'group' && (
          <>
            <Field label="Group into">
              <Select value={target} onChange={(e) => setTarget(e.target.value as 'new' | 'existing')} options={[{ value: 'new', label: 'A new store product' }, { value: 'existing', label: 'An existing store product' }]} />
            </Field>
            {target === 'new' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Product name (EN)" hint="Empty = the first provider product's name">
                  <Input value={groupName.name_en} onChange={(e) => setGroupName({ ...groupName, name_en: e.target.value })} placeholder="ChatGPT Plus 1 Month" />
                </Field>
                <Field label="Product name (AR)">
                  <Input dir="rtl" value={groupName.name_ar} onChange={(e) => setGroupName({ ...groupName, name_ar: e.target.value })} placeholder="شات جي بي تي بلس شهر" />
                </Field>
              </div>
            )}
            {target === 'existing' && (
              <Field label="Store product">
                <Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
                <Select value={productId} onChange={(e) => setProductId(e.target.value)} options={[{ value: '', label: '— choose —' }, ...(products.data?.items ?? []).map((p) => ({ value: p.id, label: p.name_en }))]} />
              </Field>
            )}
            <Field label="Routing" hint="Priority: try sources in order. Cheapest: lowest cost first.">
              <Select value={routing} onChange={(e) => setRouting(e.target.value as 'priority' | 'cheapest')} options={[{ value: 'priority', label: 'Priority order' }, { value: 'cheapest', label: 'Cheapest first' }]} />
            </Field>
          </>
        )}
        {!(mode === 'group' && target === 'existing') && (
          <Field label="Category (the folder customers open, e.g. ChatGPT)">
            <Select value={category} onChange={(e) => setCategory(e.target.value)} options={[
              { value: '', label: '— no category (listed under "Other products") —' },
              { value: '__new', label: '+ New category…' },
              ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name_en })),
            ]} />
          </Field>
        )}
        {creatingCat && !(mode === 'group' && target === 'existing') && (
          <div className="grid gap-3 rounded-lg border border-gold/30 p-3 sm:grid-cols-[1fr_1fr_90px]">
            <Field label="Category name (EN)"><Input autoFocus value={newCat.name_en} onChange={(e) => setNewCat({ ...newCat, name_en: e.target.value })} placeholder="ChatGPT" /></Field>
            <Field label="Category name (AR)"><Input dir="rtl" value={newCat.name_ar} onChange={(e) => setNewCat({ ...newCat, name_ar: e.target.value })} placeholder="شات جي بي تي" /></Field>
            <Field label="Emoji"><Input value={newCat.emoji} onChange={(e) => setNewCat({ ...newCat, emoji: e.target.value })} placeholder="🤖" /></Field>
          </div>
        )}
        <p className="text-xs text-ink-400">Name, description, image and warranty are copied and kept in sync until you edit them. Price = provider cost + your markup (default from Settings → Pricing).</p>
      </div>
    </Dialog>
  );
}

export default function ProviderCatalog() {
  const { id } = useParams();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [detail, setDetail] = useState<PP | null>(null);
  const { run, busy } = useAction();
  const providers = useApi<{ providers: { id: string; name: string; last_sync_at: string | null }[] }>('/providers');
  const list = useApi<Paged<PP>>(`/providers/${id}/products${qs({ filter, q, page, limit: 50 })}`);
  const provider = providers.data?.providers.find((p) => p.id === id);

  const toggle = (pid: string) => {
    const n = new Set(sel);
    if (n.has(pid)) n.delete(pid); else n.add(pid);
    setSel(n);
  };
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><Link to="/providers" className="text-ink-400 hover:text-white"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link>{provider?.name ?? 'Provider'} catalog</span>}
        sub={`Synced ${ago(provider?.last_sync_at)}. Only imported products are shown in the bot.`}
        actions={<>
          <Button loading={busy === 'seen'} onClick={() => run('seen', () => api('/provider-products/mark-seen', { body: { provider_id: id } }), { success: 'Marked as seen', invalidate: ['/providers', '/dashboard'] })}><Eye className="h-4 w-4" /> Mark all seen</Button>
          <Button loading={busy === 'sync'} onClick={() => run('sync', () => api(`/providers/${id}/sync`, { method: 'POST' }), { success: 'Synced', invalidate: ['/providers'] })}><RefreshCw className="h-4 w-4" /> Sync</Button>
          <Button variant="primary" disabled={!sel.size} onClick={() => setImporting(true)}><Download className="h-4 w-4" /> Import {sel.size || ''}</Button>
        </>}
      />
      <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={[
        { value: 'all', label: 'All' }, { value: 'new', label: 'New' }, { value: 'unlinked', label: 'Not imported' },
        { value: 'linked', label: 'In store' }, { value: 'available', label: 'In stock' }, { value: 'removed', label: 'Removed' },
      ]} />
      <Card>
        <Input placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="mb-3 max-w-sm" />
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={[
              <input key="all" type="checkbox" checked={items.length > 0 && items.every((i) => sel.has(i.id))} onChange={(e) => { const n = new Set(sel); items.forEach((i) => e.target.checked ? n.add(i.id) : n.delete(i.id)); setSel(n); }} />,
              'Name', 'Type', 'Cost', 'Stock', 'Warranty', 'Store',
            ]} empty={!items.length}>
              {items.map((p) => (
                <tr key={p.id} className={p.is_removed ? 'opacity-50' : ''}>
                  <td className="td"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} disabled={p.is_removed} /></td>
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
            <Pagination page={page} limit={list.data?.limit ?? 50} total={list.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
      {importing && <ImportDialog ids={[...sel]} providerName={provider?.name ?? ''} onClose={() => { setImporting(false); setSel(new Set()); }} />}
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
