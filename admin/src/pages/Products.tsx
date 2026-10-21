import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, useIsOwner, type Paged } from '../lib/hooks';
import { usd, num } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select, Table } from '../components/ui';

interface ProductListItem {
  id: string; name_en: string; name_ar: string | null; emoji: string | null; category_id: string | null; is_active: boolean; is_featured: boolean;
  pricing_mode: string; fulfillment: string; price: number | null; original_price: number | null; reference_cost: number | null;
  available: number | null; sold_out: boolean; sold_count: number;
  sources: { kind: string; usable: boolean; provider: string | null }[];
}

function NewProductDialog({ onClose, categories }: { onClose: () => void; categories: { id: string; name_en: string }[] }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState<'stock' | 'manual' | 'none'>('stock');
  const { run, busy } = useAction();
  const nav = useNavigate();
  const create = async () => {
    const r = await run('create', async () => {
      const res = await api<{ product: { id: string } }>('/products', {
        body: { name_en: name, category_id: category || null, pricing_mode: 'manual', manual_price: 0, fulfillment: kind === 'manual' ? 'manual' : 'auto', is_active: false },
      });
      if (kind !== 'none') await api(`/products/${res.product.id}/sources`, { body: { kind } });
      return res;
    }, { invalidate: ['/products', '/categories'] });
    if (r) nav(`/products/${r.product.id}`);
  };
  return (
    <Dialog open onClose={onClose} title="New product"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name} loading={busy === 'create'} onClick={create}>Create</Button></>}>
      <div className="space-y-3">
        <Field label="Name (EN)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: '', label: '— none —' }, ...categories.map((c) => ({ value: c.id, label: c.name_en }))]} /></Field>
        <Field label="Delivered from" hint="Provider products are added from Providers → Catalog → Import.">
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'stock' | 'manual' | 'none')} options={[
            { value: 'stock', label: 'My stock (accounts / links / codes I upload)' },
            { value: 'manual', label: 'Manual (I deliver by hand, e.g. activations)' },
            { value: 'none', label: 'Add sources later' },
          ]} />
        </Field>
        <p className="text-xs text-ink-400">The product starts hidden with a manual price — set the price and description, then make it visible.</p>
      </div>
    </Dialog>
  );
}

export default function Products() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const owner = useIsOwner();
  const category = params.get('category_id') ?? '';
  const active = params.get('active') ?? '';
  const cats = useApi<{ categories: { id: string; name_en: string }[] }>('/categories');
  const list = useApi<Paged<ProductListItem>>(`/products${qs({ q, page, limit: 50, category_id: category, active })}`);
  const catName = (id: string | null) => cats.data?.categories.find((c) => c.id === id)?.name_en;

  return (
    <>
      <PageHeader title="Products" sub="What customers see. Each product can be fed by several sources."
        actions={owner && <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New product</Button>} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select className="max-w-[220px]" value={category} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set('category_id', e.target.value); else p.delete('category_id'); setParams(p); setPage(1); }}
            options={[{ value: '', label: 'All categories' }, { value: 'none', label: 'No category' }, ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name_en }))]} />
          <Select className="max-w-[160px]" value={active} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set('active', e.target.value); else p.delete('active'); setParams(p); }}
            options={[{ value: '', label: 'Any status' }, { value: 'true', label: 'Visible' }, { value: 'false', label: 'Hidden' }]} />
        </div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={['Product', 'Category', 'Price', ...(owner ? ['Cost'] : []), 'Stock', 'Sources', 'Sold', 'Status']} empty={!list.data?.items.length}>
              {list.data!.items.map((p) => (
                <tr key={p.id}>
                  <td className="td"><Link to={`/products/${p.id}`} className="hover:text-gold"><span className="me-1.5">{p.emoji}</span>{p.name_en}</Link>
                    <div className="mt-0.5 flex gap-1">{p.fulfillment === 'manual' && <Badge tone="purple">manual</Badge>}{p.pricing_mode === 'manual' && <Badge>fixed price</Badge>}{p.is_featured && <Badge tone="gold">featured</Badge>}</div>
                  </td>
                  <td className="td text-ink-400">{catName(p.category_id) ?? '—'}</td>
                  <td className="td whitespace-nowrap">{p.original_price && p.price && p.original_price > p.price ? <span className="me-1 text-xs text-ink-400 line-through">{usd(p.original_price)}</span> : null}{usd(p.price)}</td>
                  {owner && <td className="td text-ink-400">{usd(p.reference_cost)}</td>}
                  <td className="td">{p.sold_out ? <Badge tone="red">sold out</Badge> : p.available == null ? <span className="text-ink-400">∞</span> : p.available}</td>
                  <td className="td"><div className="flex flex-wrap gap-1">{p.sources.length === 0 && <Badge tone="red">none</Badge>}{p.sources.map((s, i) => <Badge key={i} tone={s.usable ? 'green' : 'gray'}>{s.provider ?? s.kind}</Badge>)}</div></td>
                  <td className="td">{num(p.sold_count)}</td>
                  <td className="td">{p.is_active ? <Badge tone="green">visible</Badge> : <Badge>hidden</Badge>}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} limit={list.data!.limit} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
      {creating && <NewProductDialog onClose={() => setCreating(false)} categories={cats.data?.categories ?? []} />}
    </>
  );
}
