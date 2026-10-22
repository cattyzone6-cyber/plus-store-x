import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, Eye, EyeOff, PackagePlus, Pencil, Plus, Wand2, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, useIsOwner, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { usd } from '../lib/format';
import { Badge, Button, ErrorBox, Input, Loading, PageHeader, Spinner, cx } from '../components/ui';
import { PackList } from '../components/catalog/PackList';
import { GroupEditor } from '../components/catalog/GroupEditor';
import { AutoGroupDialog } from '../components/catalog/AutoGroupDialog';
import { CATALOG_INVALIDATE, type CatalogCategory, type Group, type Pack } from '../components/catalog/types';

type EditTarget = { group: Partial<Group>; preselect?: string[] };

const arrow = 'rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-white disabled:opacity-30';

// ─────────────────────────────────────────────────────────────────────────────
// Product (group) card: summary row, packs underneath when opened
// ─────────────────────────────────────────────────────────────────────────────

function GroupCard({ g, first, last, owner, onMove, onEdit }: {
  g: Group; first: boolean; last: boolean; owner: boolean; onMove: (d: number) => void; onEdit: () => void;
}) {
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const { run, busy } = useAction();
  const detail = useApi<{ group: Group; packs: Pack[] }>(open ? `/groups/${g.id}` : null);
  const soldOut = (g.in_stock ?? 0) === 0;
  return (
    <div className={cx('rounded-xl border border-ink-700 bg-ink-900/40', !g.is_active && 'opacity-70')}>
      <div className="flex items-center gap-2 p-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
          {g.image_url
            ? <img src={g.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-ink-700 object-cover" />
            : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-lg">{g.emoji || '📦'}</span>}
          <span className="min-w-0 flex-1">
            <span className="block break-words font-medium">{g.name_en}{g.name_ar && <span className="ms-2 text-xs font-normal text-ink-400" dir="rtl">{g.name_ar}</span>}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1">
              <Badge>{g.packs ?? 0} {tx('packs', 'باقات')}</Badge>
              {g.from_price != null && <Badge tone="gold">{tx('from', 'من')} {usd(g.from_price)}</Badge>}
              {soldOut ? <Badge tone="red">{tx('out of stock', 'غير متوفر')}</Badge> : <Badge tone="green">{g.in_stock} {tx('on sale', 'متاحة للبيع')}</Badge>}
              {!!g.paused && <Badge tone="red">{g.paused} {tx('paused', 'موقوفة')}</Badge>}
              {!g.is_active && <Badge>{tx('hidden', 'مخفي')}</Badge>}
            </span>
          </span>
          <ChevronDown className={cx('h-4 w-4 shrink-0 text-ink-400 transition', !open && '-rotate-90 rtl:rotate-90')} />
        </button>
        {owner && (
          <div className="flex shrink-0 items-center">
            <div className="flex flex-col sm:flex-row">
              <button type="button" className={arrow} disabled={first} onClick={() => onMove(-1)} aria-label={tx('Move up', 'تحريك لأعلى')}><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" className={arrow} disabled={last} onClick={() => onMove(1)} aria-label={tx('Move down', 'تحريك لأسفل')}><ArrowDown className="h-3.5 w-3.5" /></button>
            </div>
            <Button size="sm" variant="ghost" loading={busy === 'vis'} title={g.is_active ? tx('Hide from the bot', 'إخفاء من البوت') : tx('Show in the bot', 'إظهار في البوت')}
              onClick={() => void run('vis', () => api(`/groups/${g.id}`, { method: 'PATCH', body: { is_active: !g.is_active } }), { invalidate: CATALOG_INVALIDATE })}>
              {g.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit} title={tx('Edit product', 'تعديل المنتج')}><Pencil className="h-3.5 w-3.5" /></Button>
          </div>
        )}
      </div>
      {open && (
        <div className="border-t border-ink-700 p-3">
          {detail.isLoading ? <div className="flex justify-center py-4"><Spinner /></div> : detail.error ? <ErrorBox error={detail.error} /> : (
            <>
              <PackList packs={detail.data?.packs ?? []} owner={owner} group={g}
                onReorder={(ids) => api(`/groups/${g.id}/reorder`, { body: { ids } })}
                empty={tx('No packs in this product yet — edit it to add some.', 'لا توجد باقات في هذا المنتج بعد — عدّله لإضافة باقات.')} />
              <p className="mt-2 text-xs text-ink-400">{tx('In the bot, sold-out packs go last and pinned packs first; the arrows set the rest.', 'في البوت تأتي الباقات النافدة في الآخر والمثبّتة في الأول، والأسهم ترتّب الباقي.')}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Packs listed directly in a category (no product yet)
// ─────────────────────────────────────────────────────────────────────────────

function LoosePacks({ categoryId, groups, owner, onNewProduct }: { categoryId: string; groups: Group[]; owner: boolean; onNewProduct: (packId: string) => void }) {
  const tx = useTx();
  const q = useApi<Paged<Pack>>(`/products${qs({ category_id: categoryId, group_id: 'none', limit: 200 })}`);
  if (q.isLoading) return <div className="flex justify-center py-4"><Spinner /></div>;
  if (q.error) return <ErrorBox error={q.error} />;
  const packs = q.data?.items ?? [];
  if (!packs.length) return null;
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{tx('Packs without a product', 'باقات بدون منتج')} <span className="font-normal text-ink-400">({q.data!.total})</span></h4>
      </div>
      <p className="mb-2 text-xs text-ink-400">{tx('Shown directly in the category. Put them into a product to keep the bot menu short.', 'تظهر مباشرة داخل القسم. ضعها داخل منتج لتبقى قائمة البوت قصيرة.')}</p>
      <PackList packs={packs} owner={owner} moveTargets={groups} onNewProduct={onNewProduct}
        onReorder={(ids) => api('/products/reorder', { body: { ids } })} />
      {q.data!.total > packs.length && <p className="mt-2 text-xs text-ink-400">{tx(`Showing ${packs.length} of ${q.data!.total}.`, `يظهر ${packs.length} من ${q.data!.total}.`)}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category section
// ─────────────────────────────────────────────────────────────────────────────

function CategoryHeaderEdit({ cat, onDone }: { cat: CatalogCategory; onDone: () => void }) {
  const tx = useTx();
  const [f, setF] = useState({ emoji: cat.emoji ?? '', name_en: cat.name_en, name_ar: cat.name_ar ?? '' });
  const { run, busy } = useAction();
  const save = async () => {
    const r = await run('save', () => api(`/categories/${cat.id}`, { method: 'PATCH', body: { emoji: f.emoji.trim() || null, name_en: f.name_en.trim(), name_ar: f.name_ar.trim() || null } }), { success: tx('Saved', 'تم الحفظ'), invalidate: CATALOG_INVALIDATE });
    if (r) onDone();
  };
  return (
    <div className="grid flex-1 gap-2 sm:grid-cols-[70px_1fr_1fr_auto]" onClick={(e) => e.stopPropagation()}>
      <Input value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} placeholder="🤖" aria-label={tx('Emoji', 'إيموجي')} />
      <Input autoFocus value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} placeholder={tx('Name (EN)', 'الاسم (إنجليزي)')} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      <Input dir="rtl" value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} placeholder={tx('Name (AR)', 'الاسم (عربي)')} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      <div className="flex gap-1">
        <Button size="sm" variant="primary" disabled={!f.name_en.trim()} loading={busy === 'save'} onClick={() => void save()}><Check className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" onClick={onDone}><X className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function CategorySection({ cat, groups, allGroups, open, onToggle, first, last, owner, onMove, onEdit }: {
  cat: CatalogCategory | null;
  groups: Group[];
  allGroups: Group[];
  open: boolean;
  onToggle: () => void;
  first: boolean;
  last: boolean;
  owner: boolean;
  onMove: (d: number) => void;
  onEdit: (t: EditTarget) => void;
}) {
  const tx = useTx();
  const [renaming, setRenaming] = useState(false);
  const { run, busy } = useAction();
  const catId = cat?.id ?? 'none';

  // groups are ordered globally: swap two neighbours of this category inside the full list
  const moveGroup = (i: number, d: number) => {
    const a = groups[i];
    const b = groups[i + d];
    if (!a || !b) return;
    const ids = allGroups.map((g) => g.id);
    const ia = ids.indexOf(a.id);
    const ib = ids.indexOf(b.id);
    [ids[ia], ids[ib]] = [ids[ib], ids[ia]];
    void run('reorder', () => api('/groups/reorder', { body: { ids } }), { invalidate: ['/groups'] });
  };

  return (
    <section className={cx('card overflow-hidden', cat && !cat.is_active && 'opacity-80')}>
      <header className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
        {renaming && cat ? <CategoryHeaderEdit cat={cat} onDone={() => setRenaming(false)} /> : (
          <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-start">
            <ChevronDown className={cx('h-4 w-4 shrink-0 text-ink-400 transition', !open && '-rotate-90 rtl:rotate-90')} />
            <span className="text-lg">{cat ? cat.emoji || '📁' : '🗂️'}</span>
            <span className="min-w-0 flex-1">
              <span className="block break-words font-semibold">{cat ? cat.name_en : tx('No category', 'بدون قسم')}
                {cat?.name_ar && <span className="ms-2 text-xs font-normal text-ink-400" dir="rtl">{cat.name_ar}</span>}
              </span>
              <span className="text-xs text-ink-400">
                {groups.length} {tx('products', 'منتجات')}{cat && <> · {cat.products.total} {tx('packs', 'باقات')}</>}
                {cat && !cat.is_active && <> · <span className="text-red-300">{tx('hidden', 'مخفي')}</span></>}
              </span>
            </span>
          </button>
        )}
        {owner && cat && !renaming && (
          <div className="flex shrink-0 items-center">
            <button type="button" className={arrow} disabled={first} onClick={() => onMove(-1)} aria-label={tx('Move up', 'تحريك لأعلى')}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" className={arrow} disabled={last} onClick={() => onMove(1)} aria-label={tx('Move down', 'تحريك لأسفل')}><ArrowDown className="h-3.5 w-3.5" /></button>
            <Button size="sm" variant="ghost" loading={busy === 'vis'} title={cat.is_active ? tx('Hide from the bot', 'إخفاء من البوت') : tx('Show in the bot', 'إظهار في البوت')}
              onClick={() => void run('vis', () => api(`/categories/${cat.id}`, { method: 'PATCH', body: { is_active: !cat.is_active } }), { invalidate: ['/categories'] })}>
              {cat.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(true)} title={tx('Rename', 'إعادة تسمية')}><Pencil className="h-3.5 w-3.5" /></Button>
          </div>
        )}
      </header>
      {open && (
        <div className="border-t border-ink-700 p-3 sm:p-4">
          <div className="space-y-2">
            {groups.map((g, i) => (
              <GroupCard key={g.id} g={g} first={i === 0} last={i === groups.length - 1} owner={owner}
                onMove={(d) => moveGroup(i, d)} onEdit={() => onEdit({ group: g })} />
            ))}
            {!groups.length && <div className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-sm text-ink-400">{tx('No products in this category yet.', 'لا توجد منتجات في هذا القسم بعد.')}</div>}
          </div>
          {owner && (
            <Button size="sm" className="mt-3" onClick={() => onEdit({ group: { category_id: cat?.id ?? null } })}>
              <PackagePlus className="h-3.5 w-3.5" /> {tx('New product here', 'منتج جديد هنا')}
            </Button>
          )}
          <LoosePacks categoryId={catId} groups={groups} owner={owner}
            onNewProduct={(packId) => onEdit({ group: { category_id: cat?.id ?? null }, preselect: [packId] })} />
        </div>
      )}
    </section>
  );
}

function AddCategory() {
  const tx = useTx();
  const [f, setF] = useState({ emoji: '', name_en: '', name_ar: '' });
  const { run, busy } = useAction();
  const add = async () => {
    const r = await run('add', () => api('/categories', { body: { emoji: f.emoji.trim() || null, name_en: f.name_en.trim(), name_ar: f.name_ar.trim() || null } }), { success: tx('Category added', 'تمت إضافة القسم'), invalidate: ['/categories'] });
    if (r) setF({ emoji: '', name_en: '', name_ar: '' });
  };
  return (
    <div className="card p-3 sm:p-4">
      <div className="mb-2 text-sm font-semibold">{tx('Add a category', 'إضافة قسم')}</div>
      <div className="grid gap-2 sm:grid-cols-[70px_1fr_1fr_auto]">
        <Input value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} placeholder="🤖" aria-label={tx('Emoji', 'إيموجي')} />
        <Input value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} placeholder={tx('Name (EN), e.g. AI tools', 'الاسم (إنجليزي)، مثل AI tools')} onKeyDown={(e) => e.key === 'Enter' && f.name_en.trim() && void add()} />
        <Input dir="rtl" value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} placeholder={tx('Name (AR)', 'الاسم (عربي)')} onKeyDown={(e) => e.key === 'Enter' && f.name_en.trim() && void add()} />
        <Button variant="primary" disabled={!f.name_en.trim()} loading={busy === 'add'} onClick={() => void add()}><Plus className="h-4 w-4" /> {tx('Add', 'إضافة')}</Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Catalog() {
  const tx = useTx();
  const owner = useIsOwner();
  const cats = useApi<{ categories: CatalogCategory[] }>('/categories');
  const groups = useApi<{ groups: Group[] }>('/groups');
  const { run } = useAction();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [auto, setAuto] = useState(false);

  if (cats.isLoading || groups.isLoading) return <Loading />;
  if (cats.error || groups.error) return <ErrorBox error={cats.error ?? groups.error} />;
  const categories = cats.data!.categories;
  const allGroups = groups.data!.groups;
  const inCat = (id: string | null) => allGroups.filter((g) => g.category_id === id);
  const toggle = (id: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const moveCat = (i: number, d: number) => {
    const ids = categories.map((c) => c.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run('reorder', () => api('/categories/reorder', { body: { ids } }), { invalidate: ['/categories'] });
  };
  const allOpen = categories.length > 0 && categories.every((c) => open.has(c.id));

  const actions = owner && (
    <>
      <Button onClick={() => setAuto(true)}><Wand2 className="h-4 w-4" /> {tx('Auto-group packs', 'تجميع الباقات تلقائياً')}</Button>
      <Button variant="primary" onClick={() => setEdit({ group: {} })}><Plus className="h-4 w-4" /> {tx('New product', 'منتج جديد')}</Button>
    </>
  );

  return (
    <div className={cx(owner && 'pb-20 sm:pb-0')}>
      <PageHeader title={tx('Catalog', 'الكتالوج')}
        sub={tx('Category → product → packs. Customers tap a product (e.g. ChatGPT Plus), then pick a pack by its full name.', 'قسم ← منتج ← باقات. يضغط العميل على المنتج (مثل ChatGPT Plus) ثم يختار الباقة باسمها الكامل.')}
        actions={<>
          <Button variant="ghost" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set([...categories.map((c) => c.id), 'none']))}>
            {allOpen ? tx('Collapse all', 'طيّ الكل') : tx('Expand all', 'فتح الكل')}
          </Button>
          <span className="hidden gap-2 sm:flex">{actions}</span>
        </>} />

      <div className="space-y-3">
        {categories.map((c, i) => (
          <CategorySection key={c.id} cat={c} groups={inCat(c.id)} allGroups={allGroups} open={open.has(c.id)} onToggle={() => toggle(c.id)}
            first={i === 0} last={i === categories.length - 1} owner={owner} onMove={(d) => moveCat(i, d)} onEdit={setEdit} />
        ))}
        <CategorySection cat={null} groups={inCat(null)} allGroups={allGroups} open={open.has('none')} onToggle={() => toggle('none')}
          first last owner={owner} onMove={() => {}} onEdit={setEdit} />
        {owner && <AddCategory />}
      </div>

      {/* phones: the main actions stay reachable at the bottom */}
      {owner && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-ink-700 bg-ink-900/95 p-3 backdrop-blur sm:hidden [&>button]:flex-1">
          {actions}
        </div>
      )}

      {edit && <GroupEditor group={edit.group} preselect={edit.preselect} categories={categories} onClose={() => setEdit(null)} />}
      {auto && <AutoGroupDialog categories={categories} onClose={() => setAuto(false)} />}
    </div>
  );
}
