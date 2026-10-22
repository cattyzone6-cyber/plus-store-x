import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Eye, FolderPlus, ListChecks, RefreshCw } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd, ago } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, PageHeader, Select, Tabs, useToast } from '../components/ui';

export interface PP {
  id: string; provider_id: string; external_id: string; name: string; description: string | null; image_url: string | null;
  delivery_kind: string; raw_type: string | null; cost: number | null; cost_original: number | null; cost_currency: string;
  stock: number | null; sold: number | null; warranty_days: number | null; requirements: { fields?: { key: string }[]; quantity_fixed?: number };
  is_available: boolean; is_removed: boolean; is_new: boolean; last_changed_at: string; removed_at: string | null;
  links: { product_id: string; product_name: string }[];
  /** which store product this item belongs to (packs keep their full name) */
  clean: { product: string; key: string; durationDays: number | null; warranty: 'full' | 'none' | number | null };
}

interface Cat { id: string; name_en: string; name_ar?: string | null }
interface Group { id: string; name_en: string; name_ar: string | null; category_id: string | null; is_active: boolean }
interface Provider { id: string; name: string; last_sync_at: string | null; import_category_id?: string | null }

const box = 'h-5 w-5 shrink-0 cursor-pointer accent-[#F5B301] disabled:cursor-not-allowed';

/** Inline "+ New category" form. */
function NewCategoryForm({ onCreated, onCancel }: { onCreated: (c: Cat) => void; onCancel: () => void }) {
  const tx = useTx();
  const { run, busy } = useAction();
  const [v, setV] = useState({ name_en: '', name_ar: '', emoji: '' });
  const create = async () => {
    const r = await run('cat', () => api<{ category: Cat }>('/categories', {
      body: { name_en: v.name_en.trim(), name_ar: v.name_ar.trim() || null, emoji: v.emoji.trim() || null },
    }), { success: tx('Category created', 'تم إنشاء القسم'), invalidate: ['/categories'] });
    if (r) onCreated(r.category);
  };
  return (
    <div className="grid gap-2 rounded-lg border border-gold/30 p-3 sm:grid-cols-[1fr_1fr_80px_auto]">
      <Field label={tx('Category name (EN)', 'اسم القسم (إنجليزي)')}><Input autoFocus value={v.name_en} onChange={(e) => setV({ ...v, name_en: e.target.value })} placeholder="AI tools" /></Field>
      <Field label={tx('Category name (AR)', 'اسم القسم (عربي)')}><Input dir="rtl" value={v.name_ar} onChange={(e) => setV({ ...v, name_ar: e.target.value })} placeholder="أدوات الذكاء الاصطناعي" /></Field>
      <Field label={tx('Emoji', 'إيموجي')}><Input value={v.emoji} onChange={(e) => setV({ ...v, emoji: e.target.value })} placeholder="🤖" /></Field>
      <div className="flex items-end gap-2">
        <Button variant="primary" size="sm" disabled={!v.name_en.trim()} loading={busy === 'cat'} onClick={create}>{tx('Create', 'إنشاء')}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{tx('Cancel', 'إلغاء')}</Button>
      </div>
    </div>
  );
}

interface PlanPack { pp: PP; name_en: string; name_ar: string }
interface PlanDest { key: string; target: string; name_en: string; name_ar: string; category_id: string; packs: PlanPack[] }

/** Review the plan: one card per store product (new or existing) with its packs, plus removals. */
function ReviewSheet({ provider, picks, drops, onClose, onDone }: { provider: Provider; picks: PP[]; drops: PP[]; onClose: () => void; onDone: () => void }) {
  const tx = useTx();
  const toast = useToast();
  const { run, busy } = useAction();
  const cats = useApi<{ categories: Cat[] }>('/categories');
  const groups = useApi<{ groups: Group[] }>('/import/groups');
  const [extraCats, setExtraCats] = useState<Cat[]>([]);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, { cost: number | null; price: number | null }>>({});
  const [plan, setPlan] = useState<PlanDest[] | null>(null);

  const allCats = useMemo(() => {
    const m = new Map<string, Cat>();
    for (const c of [...(cats.data?.categories ?? []), ...extraCats]) m.set(c.id, c);
    return [...m.values()];
  }, [cats.data, extraCats]);
  const groupList = groups.data?.groups ?? [];

  // price preview with the real pricing rules
  useEffect(() => {
    if (!picks.length) return;
    api<{ prices: Record<string, { cost: number | null; price: number | null }> }>('/import/preview', { body: { provider_id: provider.id, items: picks.map((p) => p.id) } })
      .then((r) => setPrices(r.prices)).catch(() => setPrices({}));
  }, [picks, provider.id]);

  // build the plan once existing products are known: group by product, auto-match existing ones by name
  useEffect(() => {
    if (plan || !groups.data) return;
    const byKey = new Map<string, PlanDest>();
    for (const pp of picks) {
      const key = pp.clean.key;
      let d = byKey.get(key);
      if (!d) {
        const match = groupList.find((g) => g.name_en.trim().toLowerCase() === key);
        d = { key, target: match?.id ?? 'new', name_en: pp.clean.product, name_ar: '', category_id: provider.import_category_id ?? '', packs: [] };
        byKey.set(key, d);
      }
      d.packs.push({ pp, name_en: pp.name, name_ar: '' });
    }
    setPlan([...byKey.values()].sort((a, b) => a.name_en.localeCompare(b.name_en)));
  }, [groups.data, picks, plan, groupList, provider.import_category_id]);

  const update = (i: number, patch: Partial<PlanDest>) => setPlan((cur) => cur!.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const updatePack = (i: number, k: number, patch: Partial<PlanPack>) =>
    setPlan((cur) => cur!.map((d, j) => (j === i ? { ...d, packs: d.packs.map((p, m) => (m === k ? { ...p, ...patch } : p)) } : d)));

  const catOptions = [{ value: '', label: tx('— no category (Other products) —', '— بدون قسم (منتجات أخرى) —') }, ...allCats.map((c) => ({ value: c.id, label: c.name_en }))];
  const destOptions = [{ value: 'new', label: tx('+ New product', '+ منتج جديد') }, ...groupList.map((g) => ({ value: g.id, label: g.name_en }))];
  const packCount = plan?.reduce((n, d) => n + d.packs.length, 0) ?? 0;
  const newCount = plan?.filter((d) => d.target === 'new').length ?? 0;
  const invalid = plan?.some((d) => d.target === 'new' && !d.name_en.trim()) || plan?.some((d) => d.packs.some((p) => !p.name_en.trim()));

  const apply = async () => {
    if (!plan) return;
    const r = await run('apply', () => api<{ groups_created: number; packs_created: number; skipped: number; deleted: number; hidden: number }>('/import/apply', {
      body: {
        provider_id: provider.id,
        groups: plan.map((d) => ({
          ...(d.target === 'new'
            ? { new: { name_en: d.name_en.trim(), name_ar: d.name_ar.trim() || undefined, category_id: d.category_id || null } }
            : { group_id: d.target }),
          packs: d.packs.map((p) => ({ pp_id: p.pp.id, name_en: p.name_en.trim(), name_ar: p.name_ar.trim() || undefined })),
        })),
        remove: drops.flatMap((p) => p.links.map((l) => l.product_id)),
      },
    }), { invalidate: ['/providers', '/products', '/categories', '/import', '/dashboard'] });
    if (r) {
      const parts = [
        r.packs_created && tx(`${r.packs_created} packs added`, `أُضيفت ${r.packs_created} باقة`),
        r.groups_created && tx(`${r.groups_created} new products`, `${r.groups_created} منتج جديد`),
        r.deleted && tx(`${r.deleted} removed`, `حُذفت ${r.deleted}`),
        r.hidden && tx(`${r.hidden} hidden (they have orders or stock)`, `أُخفيت ${r.hidden} (لديها طلبات أو مخزون)`),
        r.skipped && tx(`${r.skipped} already in the store`, `${r.skipped} موجودة مسبقاً`),
      ].filter(Boolean);
      toast(parts.join(' · ') || tx('Done', 'تم'));
      onDone();
    }
  };

  return (
    <Dialog open onClose={onClose} wide title={tx(`Review — ${provider.name}`, `مراجعة — ${provider.name}`)}
      footer={<>
        <span className="me-auto self-center text-xs text-ink-400">
          {tx(`${packCount} packs · ${newCount} new products · ${drops.length} to remove`, `${packCount} باقة · ${newCount} منتج جديد · ${drops.length} للحذف`)}
        </span>
        <Button onClick={onClose}>{tx('Cancel', 'إلغاء')}</Button>
        <Button variant="primary" loading={busy === 'apply'} disabled={!plan || invalid || (!packCount && !drops.length)} onClick={apply}>{tx('Apply', 'تطبيق')}</Button>
      </>}>
      {!plan && picks.length > 0 ? <Loading /> : (
        <div className="space-y-4">
          <p className="text-xs text-ink-400">
            {tx('Packs keep their full name in the bot (e.g. "ChatGPT Plus 1M"); you can edit it. Packs of the same product are grouped under it.',
              'تبقى الباقات باسمها الكامل في البوت (مثلاً "ChatGPT Plus 1M") ويمكنك تعديله. الباقات من نفس المنتج تُجمع تحته.')}
          </p>
          {(plan ?? []).map((d, i) => (
            <div key={d.key} className="rounded-lg border border-ink-700">
              <div className="space-y-3 border-b border-ink-700 bg-ink-900/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={tx('Store product', 'المنتج في المتجر')}>
                    <Select value={d.target} onChange={(e) => update(i, { target: e.target.value })} options={destOptions} />
                  </Field>
                  {d.target === 'new' ? (
                    <Field label={tx('Category', 'القسم')}>
                      <div className="flex gap-2">
                        <Select className="flex-1" value={d.category_id} onChange={(e) => update(i, { category_id: e.target.value })} options={catOptions} />
                        <Button size="sm" onClick={() => setCreatingFor(d.key)} aria-label={tx('New category', 'قسم جديد')}><FolderPlus className="h-4 w-4" /></Button>
                      </div>
                    </Field>
                  ) : (
                    <div className="self-end pb-2 text-sm text-ink-400">
                      {tx('Category: ', 'القسم: ')}{allCats.find((c) => c.id === groupList.find((g) => g.id === d.target)?.category_id)?.name_en ?? tx('none', 'بدون')}
                    </div>
                  )}
                </div>
                {creatingFor === d.key && (
                  <NewCategoryForm onCancel={() => setCreatingFor(null)} onCreated={(c) => { setExtraCats((x) => [...x, c]); update(i, { category_id: c.id }); setCreatingFor(null); }} />
                )}
                {d.target === 'new' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={tx('Product name (EN)', 'اسم المنتج (إنجليزي)')}><Input value={d.name_en} onChange={(e) => update(i, { name_en: e.target.value })} /></Field>
                    <Field label={tx('Product name (AR)', 'اسم المنتج (عربي)')}><Input dir="rtl" value={d.name_ar} onChange={(e) => update(i, { name_ar: e.target.value })} placeholder={d.name_en} /></Field>
                  </div>
                )}
              </div>
              <ul className="divide-y divide-ink-700/70">
                {d.packs.map((p, k) => {
                  const pr = prices[p.pp.id];
                  return (
                    <li key={p.pp.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                      <Field label={tx('Pack name (EN) — shown to customers', 'اسم الباقة (إنجليزي) — يظهر للزبائن')}>
                        <Input value={p.name_en} onChange={(e) => updatePack(i, k, { name_en: e.target.value })} />
                      </Field>
                      <Field label={tx('Pack name (AR, optional)', 'اسم الباقة (عربي، اختياري)')}>
                        <Input dir="rtl" value={p.name_ar} onChange={(e) => updatePack(i, k, { name_ar: e.target.value })} placeholder={p.name_en} />
                      </Field>
                      <div className="whitespace-nowrap pb-2 text-sm">
                        <span className="text-ink-400">{usd(pr?.cost ?? p.pp.cost)}</span>
                        <span className="mx-1 text-ink-400">→</span>
                        <span className="font-semibold text-gold">{pr ? usd(pr.price) : '…'}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {drops.length > 0 && (
            <div className="rounded-lg border border-red-500/40 p-3">
              <div className="mb-2 font-medium text-red-300">{tx('To remove from the store', 'ستُحذف من المتجر')}</div>
              <ul className="space-y-1 text-sm">
                {drops.map((p) => <li key={p.id} className="truncate">• {p.links.map((l) => l.product_name).join(', ') || p.name}</li>)}
              </ul>
              <p className="mt-2 text-xs text-ink-400">{tx('Deleted if never ordered and without stock, otherwise hidden.', 'تُحذف إن لم تُطلب ولا مخزون لها، وإلا تُخفى.')}</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default function ProviderCatalog() {
  const { id } = useParams();
  const tx = useTx();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Map<string, PP>>(new Map()); // to add
  const [drop, setDrop] = useState<Map<string, PP>>(new Map()); // in store, to remove
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [detail, setDetail] = useState<PP | null>(null);
  const { run, busy } = useAction();
  const providers = useApi<{ providers: Provider[] }>('/providers');
  // the whole catalog in one list, grouped by store product
  const list = useApi<Paged<PP>>(`/providers/${id}/products${qs({ filter, q, all: 1 })}`);
  const provider = providers.data?.providers.find((p) => p.id === id);

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; product: string; items: PP[] }>();
    for (const it of list.data?.items ?? []) {
      const g = m.get(it.clean.key) ?? { key: it.clean.key, product: it.clean.product, items: [] };
      g.items.push(it);
      m.set(it.clean.key, g);
    }
    const inStore = (g: { items: PP[] }) => g.items.filter((i) => i.links.length).length;
    return [...m.values()].sort((a, b) => inStore(b) - inStore(a) || a.product.localeCompare(b.product));
  }, [list.data]);

  const addable = (i: PP) => !i.links.length && !i.is_removed;
  const togglePick = (p: PP) => setPick((cur) => { const n = new Map(cur); if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p); return n; });
  const toggleDrop = (p: PP) => setDrop((cur) => { const n = new Map(cur); if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p); return n; });
  const toggleGroup = (items: PP[]) => {
    const add = items.filter(addable);
    const all = add.length > 0 && add.every((i) => pick.has(i.id));
    setPick((cur) => { const n = new Map(cur); add.forEach((i) => (all ? n.delete(i.id) : n.set(i.id, i))); return n; });
  };
  const toggleOpen = (key: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allAddable = (list.data?.items ?? []).filter(addable);
  const allPicked = allAddable.length > 0 && allAddable.every((i) => pick.has(i.id));
  const changes = pick.size + drop.size;

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><Link to="/providers" className="text-ink-400 hover:text-white"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link>{provider?.name ?? tx('Provider', 'المزوّد')}</span>}
        sub={tx(`Synced ${ago(provider?.last_sync_at)}. Tick the packs to sell, then review.`, `آخر مزامنة ${ago(provider?.last_sync_at)}. اختر الباقات التي تريد بيعها ثم راجعها.`)}
        actions={<>
          <Button loading={busy === 'seen'} onClick={() => run('seen', () => api('/provider-products/mark-seen', { body: { provider_id: id } }), { success: tx('Marked as seen', 'تم التعليم كمُشاهد'), invalidate: ['/providers', '/dashboard'] })}><Eye className="h-4 w-4" /> <span className="hidden sm:inline">{tx('Mark all seen', 'تعليم الكل كمُشاهد')}</span></Button>
          <Button loading={busy === 'sync'} onClick={() => run('sync', () => api(`/providers/${id}/sync`, { method: 'POST' }), { success: tx('Synced', 'تمت المزامنة'), invalidate: ['/providers'] })}><RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">{tx('Sync', 'مزامنة')}</span></Button>
        </>}
      />
      <Tabs value={filter} onChange={setFilter} tabs={[
        { value: 'all', label: tx('All', 'الكل') }, { value: 'new', label: tx('New', 'جديد') }, { value: 'unlinked', label: tx('Not imported', 'غير مضاف') },
        { value: 'linked', label: tx('In store', 'في المتجر') }, { value: 'available', label: tx('In stock', 'متوفر') }, { value: 'removed', label: tx('Removed', 'محذوف') },
      ]} />
      <Card className="pb-24">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Input placeholder={tx('Search…', 'بحث…')} value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:max-w-sm" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className={box} checked={allPicked} disabled={!allAddable.length}
              onChange={() => setPick((cur) => { const n = new Map(cur); allAddable.forEach((i) => (allPicked ? n.delete(i.id) : n.set(i.id, i))); return n; })} />
            {tx(`Select all (${allAddable.length})`, `تحديد الكل (${allAddable.length})`)}
          </label>
          <span className="text-xs text-ink-400">{tx(`${groups.length} products · ${list.data?.items.length ?? 0} packs`, `${groups.length} منتج · ${list.data?.items.length ?? 0} باقة`)}</span>
        </div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-400">{tx('Nothing here.', 'لا يوجد شيء هنا.')}</p>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => {
              const add = g.items.filter(addable);
              const picked = add.filter((i) => pick.has(i.id)).length;
              const inStore = g.items.filter((i) => i.links.length).length;
              const fresh = g.items.filter((i) => i.is_new && !i.is_removed).length;
              const expanded = open.has(g.key) || !!q;
              const minCost = Math.min(...g.items.map((i) => (i.cost == null ? Infinity : Number(i.cost))));
              return (
                <div key={g.key} className="rounded-lg border border-ink-700">
                  <div className="flex items-center gap-3 p-3">
                    <input type="checkbox" className={box} disabled={!add.length} checked={add.length > 0 && picked === add.length}
                      ref={(el) => { if (el) el.indeterminate = picked > 0 && picked < add.length; }} onChange={() => toggleGroup(g.items)}
                      aria-label={tx(`Select all packs of ${g.product}`, `تحديد كل باقات ${g.product}`)} />
                    <button className="flex min-w-0 flex-1 items-center gap-2 text-start" onClick={() => toggleOpen(g.key)}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{g.product}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1 text-xs text-ink-400">
                          {tx(`${g.items.length} packs`, `${g.items.length} باقة`)}
                          {isFinite(minCost) && <span>· {tx('from', 'من')} {usd(minCost)}</span>}
                          {inStore > 0 && <Badge tone="green">{tx(`${inStore} in store`, `${inStore} في المتجر`)}</Badge>}
                          {fresh > 0 && <Badge tone="gold">{tx(`${fresh} new`, `${fresh} جديد`)}</Badge>}
                          {picked > 0 && <Badge tone="purple">{tx(`${picked} chosen`, `${picked} مختار`)}</Badge>}
                        </span>
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-ink-400 transition ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  {expanded && (
                    <ul className="divide-y divide-ink-700/70 border-t border-ink-700">
                      {g.items.map((p) => {
                        const isIn = p.links.length > 0;
                        const checked = isIn ? !drop.has(p.id) : pick.has(p.id);
                        return (
                          <li key={p.id} className={`flex items-start gap-3 p-3 ${p.is_removed && !isIn ? 'opacity-50' : ''} ${checked && !isIn ? 'bg-gold/5' : ''} ${isIn && drop.has(p.id) ? 'bg-red-500/10' : ''}`}>
                            <input type="checkbox" className={`${box} mt-0.5`} checked={checked} disabled={!isIn && p.is_removed}
                              onChange={() => (isIn ? toggleDrop(p) : togglePick(p))} />
                            <div className="min-w-0 flex-1">
                              <button className="block text-start text-sm hover:text-gold" onClick={() => setDetail(p)}>{p.name}</button>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {isIn && <Badge tone="green">{drop.has(p.id) ? tx('will be removed', 'ستُحذف') : tx('in store', 'في المتجر')}</Badge>}
                                {p.is_new && !p.is_removed && <Badge tone="gold">{tx('new', 'جديد')}</Badge>}
                                {p.is_removed && <Badge tone="red">{tx('removed by provider', 'حذفه المزوّد')}</Badge>}
                                {p.stock === 0 && <Badge tone="red">{tx('out of stock', 'نفد')}</Badge>}
                                {p.requirements?.fields?.map((f) => <Badge key={f.key} tone="purple">{tx(`needs ${f.key}`, `يحتاج ${f.key}`)}</Badge>)}
                                {p.warranty_days ? <Badge>{tx(`${p.warranty_days}d warranty`, `ضمان ${p.warranty_days} يوم`)}</Badge> : null}
                              </div>
                            </div>
                            <div className="shrink-0 text-end text-sm">
                              <div>{usd(p.cost)}</div>
                              <div className="text-xs text-ink-400">{p.stock == null ? '∞' : p.stock}</div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* sticky action bar — thumb reachable on phones */}
      {changes > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gold/30 bg-ink-950/95 p-3 backdrop-blur lg:start-60">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <span className="min-w-0 flex-1 text-sm">
              {tx(`${pick.size} to add · ${drop.size} to remove`, `${pick.size} للإضافة · ${drop.size} للحذف`)}
            </span>
            <Button size="sm" variant="ghost" onClick={() => { setPick(new Map()); setDrop(new Map()); }}>{tx('Clear', 'مسح')}</Button>
            <Button variant="primary" onClick={() => setReviewing(true)}><ListChecks className="h-4 w-4" /> {tx('Review', 'مراجعة')}</Button>
          </div>
        </div>
      )}

      {reviewing && provider && (
        <ReviewSheet provider={provider} picks={[...pick.values()]} drops={[...drop.values()]} onClose={() => setReviewing(false)}
          onDone={() => { setReviewing(false); setPick(new Map()); setDrop(new Map()); }} />
      )}
      {detail && (
        <Dialog open onClose={() => setDetail(null)} title={detail.name} wide>
          <div className="space-y-2 text-sm">
            {detail.image_url && <img src={detail.image_url} alt="" className="max-h-40 rounded" />}
            <div className="text-ink-400">{tx('Product', 'المنتج')}: <b className="text-white">{detail.clean.product}</b> · {tx('External ID', 'المعرّف الخارجي')}: <code>{detail.external_id}</code></div>
            <div className="whitespace-pre-wrap">{detail.description || <span className="text-ink-400">{tx('No description', 'بدون وصف')}</span>}</div>
            <pre className="max-h-64 overflow-auto rounded bg-ink-900 p-2 text-xs">{JSON.stringify({ requirements: detail.requirements, delivery_kind: detail.delivery_kind, sold: detail.sold, duration_days: detail.clean.durationDays, warranty: detail.clean.warranty }, null, 2)}</pre>
          </div>
        </Dialog>
      )}
    </>
  );
}
