import { useEffect, useState } from 'react';
import { ChevronDown, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAction } from '../../lib/hooks';
import { useTx } from '../../lib/i18n';
import { Badge, Button, Dialog, ErrorBox, Field, Loading, Select, Switch, cx, useToast } from '../ui';
import { CATALOG_INVALIDATE, type CatalogCategory } from './types';

interface PlanEntry {
  key: string;
  name: string;
  existing_group_id: string | null;
  category_id: string | null;
  packs: { id: string; name_en: string; source_name: string | null }[];
}

/** "Auto-group packs": preview how packs without a product would be grouped, then apply. Packs are never renamed. */
export function AutoGroupDialog({ categories, initialCategory, onClose }: { categories: CatalogCategory[]; initialCategory?: string | null; onClose: () => void }) {
  const tx = useTx();
  const [scope, setScope] = useState(initialCategory ?? '');
  const [skipSingles, setSkipSingles] = useState(true);
  const [plan, setPlan] = useState<PlanEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { run, busy } = useAction();
  const toast = useToast();
  const req = { category_id: scope || null, min_packs: skipSingles ? 2 : 1 };

  useEffect(() => {
    let live = true;
    setPlan(null);
    setError(null);
    api<{ plan: PlanEntry[] }>('/groups/auto', { body: { ...req, dry_run: true } })
      .then((r) => live && setPlan(r.plan))
      .catch((e) => live && setError(e));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, skipSingles]);

  const catName = (id: string | null) => {
    const c = categories.find((x) => x.id === id);
    return c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name_en}` : tx('no category', 'بدون قسم');
  };
  const packCount = plan?.reduce((n, e) => n + e.packs.length, 0) ?? 0;
  const fresh = plan?.filter((e) => !e.existing_group_id).length ?? 0;

  const apply = async () => {
    const r = await run('apply', () => api<{ created: number; packs: number }>('/groups/auto', { body: { ...req, dry_run: false } }), { invalidate: CATALOG_INVALIDATE });
    if (r) {
      toast(tx(`Done: ${r.created} new products, ${r.packs} packs grouped.`, `تم: ${r.created} منتجات جديدة، و${r.packs} باقة مجمّعة.`));
      onClose();
    }
  };

  return (
    <Dialog open onClose={onClose} wide title={tx('Auto-group packs', 'تجميع الباقات تلقائياً')}
      footer={<>
        <Button onClick={onClose}>{tx('Cancel', 'إلغاء')}</Button>
        <Button variant="primary" disabled={!plan?.length} loading={busy === 'apply'} onClick={() => void apply()}>
          <Wand2 className="h-4 w-4" /> {tx(`Group ${packCount} packs`, `تجميع ${packCount} باقة`)}
        </Button>
      </>}>
      <p className="mb-3 text-sm text-ink-400">
        {tx('Packs that are not in a product yet are grouped by the product their provider name points to (e.g. "ChatGPT Plus 1M" and "ChatGPT Plus 3 Months" → ChatGPT Plus). Pack names stay exactly as they are.',
          'تُجمَّع الباقات التي ليست ضمن منتج حسب المنتج الذي يدل عليه اسمها عند المزود (مثلاً "ChatGPT Plus 1M" و"ChatGPT Plus 3 Months" ← ChatGPT Plus). أسماء الباقات تبقى كما هي تماماً.')}
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 sm:items-end">
        <Field label={tx('Category', 'القسم')}>
          <Select value={scope} onChange={(e) => setScope(e.target.value)} options={[
            { value: '', label: tx('All categories', 'كل الأقسام') },
            ...categories.map((c) => ({ value: c.id, label: `${c.emoji ? `${c.emoji} ` : ''}${c.name_en}` })),
          ]} />
        </Field>
        <Switch checked={skipSingles} onChange={setSkipSingles} label={tx('Leave single packs as they are', 'اترك الباقات المنفردة كما هي')} />
      </div>
      <ErrorBox error={error} />
      {!plan && !error && <Loading />}
      {plan && (plan.length === 0 ? (
        <div className="py-8 text-center text-sm text-ink-400">{tx('Nothing to group — every pack already has a product.', 'لا شيء للتجميع — كل الباقات ضمن منتجات.')}</div>
      ) : (
        <>
          <div className="mb-2 text-sm">
            {tx(`${plan.length} products (${fresh} new), ${packCount} packs`, `${plan.length} منتج (${fresh} جديد)، ${packCount} باقة`)}
          </div>
          <div className="divide-y divide-ink-700/70 rounded-lg border border-ink-700">
            {plan.map((e) => {
              const isOpen = open.has(e.key);
              return (
                <div key={e.key}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-ink-800/60"
                    onClick={() => setOpen((cur) => { const n = new Set(cur); if (n.has(e.key)) n.delete(e.key); else n.add(e.key); return n; })}>
                    <ChevronDown className={cx('h-4 w-4 shrink-0 text-ink-400 transition', !isOpen && '-rotate-90 rtl:rotate-90')} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium">{e.name}</span>
                      <span className="text-xs text-ink-400">{catName(e.category_id)}</span>
                    </span>
                    {e.existing_group_id ? <Badge tone="blue">{tx('existing', 'موجود')}</Badge> : <Badge tone="gold">{tx('new', 'جديد')}</Badge>}
                    <Badge>{e.packs.length} {tx('packs', 'باقات')}</Badge>
                  </button>
                  {isOpen && (
                    <ul className="space-y-1 px-9 pb-3 text-sm">
                      {e.packs.map((p) => (
                        <li key={p.id} className="break-words">
                          {p.name_en}
                          {p.source_name && p.source_name !== p.name_en && <span className="ms-2 text-xs text-ink-400">({p.source_name})</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-400">{tx('Names are cleaned with the word list in Settings → Catalog. You can rename any product afterwards.', 'تُنظَّف الأسماء بقائمة الكلمات في الإعدادات ← الكتالوج. يمكنك إعادة تسمية أي منتج لاحقاً.')}</p>
        </>
      ))}
    </Dialog>
  );
}
