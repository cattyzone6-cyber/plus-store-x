import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FolderInput, Layers, Plus, Trash2, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, useIsOwner, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd, num } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select, Table, useToast } from '../components/ui';
import { PausedNote, PriceTag, StockBadge } from '../components/catalog/PackList';
import type { Pack } from '../components/catalog/types';

type ProductListItem = Pack;
interface GroupOption { id: string; name_en: string; category_id: string | null }

function NewProductDialog({ onClose, categories }: { onClose: () => void; categories: { id: string; name_en: string }[] }) {
  const tx = useTx();
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
    <Dialog open onClose={onClose} title={tx('New pack', 'باقة جديدة')}
      footer={<><Button onClick={onClose}>{tx('Cancel', 'إلغاء')}</Button><Button variant="primary" disabled={!name} loading={busy === 'create'} onClick={create}>{tx('Create', 'إنشاء')}</Button></>}>
      <div className="space-y-3">
        <Field label={tx('Full name (EN)', 'الاسم الكامل (إنجليزي)')} hint={tx('Customers see this name on the button, e.g. "ChatGPT Plus 1 Month".', 'يرى العميل هذا الاسم على الزر، مثل "ChatGPT Plus 1 Month".')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={tx('Category', 'القسم')}><Select value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: '', label: tx('— none —', '— بدون —') }, ...categories.map((c) => ({ value: c.id, label: c.name_en }))]} /></Field>
        <Field label={tx('Delivered from', 'مصدر التسليم')} hint={tx('Provider products are added from Providers → Catalog → Import.', 'منتجات المزودين تُضاف من المزودون ← الكتالوج ← استيراد.')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'stock' | 'manual' | 'none')} options={[
            { value: 'stock', label: tx('My stock (accounts / links / codes I upload)', 'مخزوني (حسابات / روابط / أكواد أرفعها)') },
            { value: 'manual', label: tx('Manual (I deliver by hand, e.g. activations)', 'يدوي (أسلّم بنفسي، مثل التفعيلات)') },
            { value: 'none', label: tx('Add sources later', 'إضافة المصادر لاحقاً') },
          ]} />
        </Field>
        <p className="text-xs text-ink-400">{tx('The pack starts hidden with a manual price — set the price and description, then make it visible.', 'تبدأ الباقة مخفية بسعر يدوي — حدّد السعر والوصف ثم أظهرها.')}</p>
      </div>
    </Dialog>
  );
}

/** Toolbar shown while packs are selected: move to a category or product (or a new one), show/hide, feature, delete. */
function BulkBar({ ids, categories, groups, onDone }: { ids: string[]; categories: { id: string; name_en: string }[]; groups: GroupOption[]; onDone: () => void }) {
  const tx = useTx();
  const { run, busy } = useAction();
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [newCat, setNewCat] = useState({ name_en: '', name_ar: '', emoji: '' });
  const [groupTarget, setGroupTarget] = useState('');
  const [newGroup, setNewGroup] = useState({ name_en: '', name_ar: '', emoji: '', category_id: '' });
  const creating = target === '__new';
  const creatingGroup = groupTarget === '__new';
  const inv = ['/products', '/categories', '/groups', '/dashboard'];
  const n = ids.length;

  const move = async () => {
    const r = await run('move', async () => {
      let categoryId: string | null = target && !creating && target !== '__none' ? target : null;
      if (creating) {
        const c = await api<{ category: { id: string } }>('/categories', {
          body: { name_en: newCat.name_en.trim(), name_ar: newCat.name_ar.trim() || null, emoji: newCat.emoji.trim() || null },
        });
        categoryId = c.category.id;
      }
      return api<{ updated: number }>('/products/bulk', { body: { ids, action: 'move', category_id: categoryId } });
    }, { success: tx(`Moved ${n} packs`, `تم نقل ${n} باقة`), invalidate: inv });
    if (r) onDone();
  };
  const moveToGroup = async () => {
    const r = await run('group', async () => {
      if (creatingGroup) {
        return api('/groups', { body: {
          name_en: newGroup.name_en.trim(), name_ar: newGroup.name_ar.trim() || null, emoji: newGroup.emoji.trim() || null,
          category_id: newGroup.category_id || null, product_ids: ids,
        } });
      }
      return api('/products/bulk', { body: { ids, action: 'group', group_id: groupTarget === '__none' ? null : groupTarget } });
    }, { success: tx(`Moved ${n} packs`, `تم نقل ${n} باقة`), invalidate: inv });
    if (r) onDone();
  };
  const remove = async () => {
    if (!confirm(tx(`Permanently delete ${n} packs? This cannot be undone.\n\nPacks with orders or unsold stock are kept (hide those instead).`,
      `حذف ${n} باقة نهائياً؟ لا يمكن التراجع.\n\nالباقات التي لها طلبات أو مخزون غير مباع تبقى (أخفِها بدلاً من ذلك).`))) return;
    const r = await run('delete', () => api<{ deleted: number; skipped: number }>('/products/bulk', { body: { ids, action: 'delete' } }), { invalidate: inv });
    if (r) {
      toast(r.skipped ? tx(`Deleted ${r.deleted}, kept ${r.skipped} with orders or stock`, `حُذفت ${r.deleted}، وبقيت ${r.skipped} لها طلبات أو مخزون`) : tx(`Deleted ${r.deleted}`, `حُذفت ${r.deleted}`));
      onDone();
    }
  };
  const act = async (action: 'show' | 'hide' | 'feature' | 'unfeature') => {
    const r = await run(action, () => api('/products/bulk', { body: { ids, action } }), { success: tx('Updated', 'تم التحديث'), invalidate: inv });
    if (r) onDone();
  };

  return (
    <div className="mb-3 space-y-3 rounded-lg border border-gold/40 bg-gold/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-sm font-medium">{tx(`${n} selected`, `${n} محددة`)}</span>
        <Button size="sm" loading={busy === 'show'} onClick={() => act('show')}>{tx('Show', 'إظهار')}</Button>
        <Button size="sm" loading={busy === 'hide'} onClick={() => act('hide')}>{tx('Hide', 'إخفاء')}</Button>
        <Button size="sm" loading={busy === 'feature'} onClick={() => act('feature')}>{tx('Feature', 'تمييز')}</Button>
        <Button size="sm" loading={busy === 'unfeature'} onClick={() => act('unfeature')}>{tx('Unfeature', 'إلغاء التمييز')}</Button>
        <Button size="sm" variant="danger" loading={busy === 'delete'} onClick={remove}><Trash2 className="h-4 w-4" /> {tx('Delete', 'حذف')}</Button>
        <Button size="sm" variant="ghost" onClick={onDone} className="ms-auto"><X className="h-4 w-4" /> {tx('Clear', 'مسح')}</Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex gap-2">
          <Select className="min-w-0 flex-1" value={groupTarget} onChange={(e) => setGroupTarget(e.target.value)} options={[
            { value: '', label: tx('Move to product…', 'نقل إلى منتج…') },
            { value: '__new', label: tx('+ New product…', '+ منتج جديد…') },
            { value: '__none', label: tx('— out of any product —', '— خارج أي منتج —') },
            ...groups.map((g) => ({ value: g.id, label: g.name_en })),
          ]} />
          <Button variant="primary" size="sm" disabled={!groupTarget || (creatingGroup && !newGroup.name_en.trim())} loading={busy === 'group'} onClick={moveToGroup}>
            <Layers className="h-4 w-4" /> {tx('Move', 'نقل')}
          </Button>
        </div>
        <div className="flex gap-2">
          <Select className="min-w-0 flex-1" value={target} onChange={(e) => setTarget(e.target.value)} options={[
            { value: '', label: tx('Move to category…', 'نقل إلى قسم…') },
            { value: '__new', label: tx('+ New category…', '+ قسم جديد…') },
            { value: '__none', label: tx('— no category —', '— بدون قسم —') },
            ...categories.map((c) => ({ value: c.id, label: c.name_en })),
          ]} />
          <Button variant="primary" size="sm" disabled={!target || (creating && !newCat.name_en.trim())} loading={busy === 'move'} onClick={move}>
            <FolderInput className="h-4 w-4" /> {tx('Move', 'نقل')}
          </Button>
        </div>
      </div>
      {creatingGroup && (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_90px_1fr]">
          <Field label={tx('Product name (EN)', 'اسم المنتج (إنجليزي)')}><Input autoFocus value={newGroup.name_en} onChange={(e) => setNewGroup({ ...newGroup, name_en: e.target.value })} placeholder="ChatGPT Plus" /></Field>
          <Field label={tx('Product name (AR)', 'اسم المنتج (عربي)')}><Input dir="rtl" value={newGroup.name_ar} onChange={(e) => setNewGroup({ ...newGroup, name_ar: e.target.value })} /></Field>
          <Field label={tx('Emoji', 'إيموجي')}><Input value={newGroup.emoji} onChange={(e) => setNewGroup({ ...newGroup, emoji: e.target.value })} placeholder="🤖" /></Field>
          <Field label={tx('Category', 'القسم')}>
            <Select value={newGroup.category_id} onChange={(e) => setNewGroup({ ...newGroup, category_id: e.target.value })} options={[{ value: '', label: tx('— none —', '— بدون —') }, ...categories.map((c) => ({ value: c.id, label: c.name_en }))]} />
          </Field>
        </div>
      )}
      {creating && (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_90px]">
          <Field label={tx('Category name (EN)', 'اسم القسم (إنجليزي)')}><Input autoFocus value={newCat.name_en} onChange={(e) => setNewCat({ ...newCat, name_en: e.target.value })} placeholder="ChatGPT" /></Field>
          <Field label={tx('Category name (AR)', 'اسم القسم (عربي)')}><Input dir="rtl" value={newCat.name_ar} onChange={(e) => setNewCat({ ...newCat, name_ar: e.target.value })} placeholder="شات جي بي تي" /></Field>
          <Field label={tx('Emoji', 'إيموجي')}><Input value={newCat.emoji} onChange={(e) => setNewCat({ ...newCat, emoji: e.target.value })} placeholder="🤖" /></Field>
        </div>
      )}
    </div>
  );
}

export default function Products() {
  const tx = useTx();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const owner = useIsOwner();
  const category = params.get('category_id') ?? '';
  const active = params.get('active') ?? '';
  const group = params.get('group_id') ?? '';
  const paused = params.get('paused') ?? '';
  const cats = useApi<{ categories: { id: string; name_en: string }[] }>('/categories');
  const groups = useApi<{ groups: GroupOption[] }>('/groups');
  const list = useApi<Paged<ProductListItem>>(`/products${qs({ q, page, limit: 50, category_id: category, active, group_id: group, paused })}`);
  const catName = (id: string | null) => cats.data?.categories.find((c) => c.id === id)?.name_en;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const pageIds = list.data?.items.map((p) => p.id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setSel((cur) => { const n = new Set(cur); if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });
  const setParam = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); setPage(1); };
  const box = 'h-4 w-4 cursor-pointer accent-[#F5B301]';

  const badges = (p: ProductListItem) => (
    <>
      {p.fulfillment === 'manual' && <Badge tone="purple">{tx('manual', 'يدوي')}</Badge>}
      {p.pricing_mode === 'manual' && <Badge>{tx('fixed price', 'سعر ثابت')}</Badge>}
      {p.is_featured && <Badge tone="gold">{tx('featured', 'مميز')}</Badge>}
      {p.pinned && <Badge tone="gold">{tx('pinned', 'مثبّتة')}</Badge>}
    </>
  );
  const status = (p: ProductListItem) => (p.is_active ? <Badge tone="green">{tx('visible', 'ظاهر')}</Badge> : <Badge>{tx('hidden', 'مخفي')}</Badge>);

  return (
    <>
      <PageHeader title={tx('Packs', 'الباقات')} sub={tx('Every pack customers can buy, with its full name. Each pack can be fed by several sources.', 'كل باقة يمكن للعميل شراؤها باسمها الكامل. كل باقة يمكن أن تُغذّى من عدة مصادر.')}
        actions={owner && <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> {tx('New pack', 'باقة جديدة')}</Button>} />
      <Card>
        <div className="mb-3 grid gap-2 sm:flex sm:flex-wrap">
          <Input placeholder={tx('Search…', 'بحث…')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="sm:max-w-xs" />
          <Select className="sm:max-w-[200px]" value={category} onChange={(e) => setParam('category_id', e.target.value)}
            options={[{ value: '', label: tx('All categories', 'كل الأقسام') }, { value: 'none', label: tx('No category', 'بدون قسم') }, ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name_en }))]} />
          <Select className="sm:max-w-[200px]" value={group} onChange={(e) => setParam('group_id', e.target.value)}
            options={[{ value: '', label: tx('Any product', 'أي منتج') }, { value: 'none', label: tx('Without a product', 'بدون منتج') }, ...(groups.data?.groups ?? []).map((g) => ({ value: g.id, label: g.name_en }))]} />
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select className="sm:max-w-[150px]" value={active} onChange={(e) => setParam('active', e.target.value)}
              options={[{ value: '', label: tx('Any status', 'أي حالة') }, { value: 'true', label: tx('Visible', 'ظاهر') }, { value: 'false', label: tx('Hidden', 'مخفي') }]} />
            <Select className="sm:max-w-[150px]" value={paused} onChange={(e) => setParam('paused', e.target.value)}
              options={[{ value: '', label: tx('Paused or not', 'موقوف أو لا') }, { value: '1', label: tx('Paused only', 'الموقوفة فقط') }]} />
          </div>
        </div>
        {owner && sel.size > 0 && <BulkBar ids={[...sel]} categories={cats.data?.categories ?? []} groups={groups.data?.groups ?? []} onDone={() => setSel(new Set())} />}
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            {/* phones: stacked cards */}
            <div className="space-y-2 sm:hidden">
              {owner && !!pageIds.length && (
                <label className="flex items-center gap-2 px-1 text-xs text-ink-400"><input type="checkbox" className={box} checked={allOnPage} onChange={togglePage} /> {tx('Select all on this page', 'تحديد كل ما في الصفحة')}</label>
              )}
              {!list.data!.items.length && <div className="py-10 text-center text-sm text-ink-400">{tx('Nothing here yet', 'لا يوجد شيء بعد')}</div>}
              {list.data!.items.map((p) => (
                <div key={p.id} className={`rounded-lg border border-ink-700 p-3 ${sel.has(p.id) ? 'bg-gold/5' : ''}`}>
                  <div className="flex items-start gap-2">
                    {owner && <input type="checkbox" className={`${box} mt-0.5`} checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={p.name_en} />}
                    <div className="min-w-0 flex-1">
                      <Link to={`/products/${p.id}`} className="break-words font-medium hover:text-gold">{p.emoji && <span className="me-1">{p.emoji}</span>}{p.name_en}</Link>
                      <div className="mt-0.5 text-xs text-ink-400">{catName(p.category_id) ?? tx('no category', 'بدون قسم')}{p.group_name && <> · {p.group_name}</>}</div>
                    </div>
                    <PriceTag pack={p} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">{status(p)}<StockBadge pack={p} />{badges(p)}</div>
                  <div className="mt-1.5"><PausedNote pack={p} owner={owner} /></div>
                </div>
              ))}
            </div>
            <div className="hidden sm:block">
              <Table head={[...(owner ? [<input key="all" type="checkbox" className={box} checked={allOnPage} onChange={togglePage} aria-label={tx('Select all on this page', 'تحديد كل ما في الصفحة')} />] : []),
                tx('Pack', 'الباقة'), tx('Product', 'المنتج'), tx('Category', 'القسم'), tx('Price', 'السعر'), ...(owner ? [tx('Cost', 'التكلفة')] : []), tx('Stock', 'المخزون'), tx('Sources', 'المصادر'), tx('Sold', 'المبيع'), tx('Status', 'الحالة')]}
                empty={!list.data?.items.length}>
                {list.data!.items.map((p) => (
                  <tr key={p.id} className={sel.has(p.id) ? 'bg-gold/5' : undefined}>
                    {owner && <td className="td w-8"><input type="checkbox" className={box} checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={p.name_en} /></td>}
                    <td className="td"><Link to={`/products/${p.id}`} className="hover:text-gold"><span className="me-1.5">{p.emoji}</span>{p.name_en}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-1">{badges(p)}</div>
                      {p.paused_reason && <div className="mt-1"><PausedNote pack={p} owner={owner} /></div>}
                    </td>
                    <td className="td text-ink-400">{p.group_id ? <Link to={`/products${qs({ group_id: p.group_id })}`} className="hover:text-gold">{p.group_name ?? '—'}</Link> : '—'}</td>
                    <td className="td text-ink-400">{catName(p.category_id) ?? '—'}</td>
                    <td className="td whitespace-nowrap"><PriceTag pack={p} /></td>
                    {owner && <td className="td text-ink-400">{usd(p.reference_cost)}</td>}
                    <td className="td">{p.sold_out ? <Badge tone="red">{tx('sold out', 'نفدت')}</Badge> : p.available == null ? <span className="text-ink-400">∞</span> : p.available}</td>
                    <td className="td"><div className="flex flex-wrap gap-1">{p.sources.length === 0 && <Badge tone="red">{tx('none', 'لا يوجد')}</Badge>}{p.sources.map((s, i) => <Badge key={i} tone={s.usable ? 'green' : 'gray'}>{s.provider ?? s.kind}</Badge>)}</div></td>
                    <td className="td">{num(p.sold_count)}</td>
                    <td className="td">{status(p)}</td>
                  </tr>
                ))}
              </Table>
            </div>
            <Pagination page={page} limit={list.data!.limit} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
      {creating && <NewProductDialog onClose={() => setCreating(false)} categories={cats.data?.categories ?? []} />}
    </>
  );
}
