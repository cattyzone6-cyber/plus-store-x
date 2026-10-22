import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Pencil, Pin, PinOff, SquareArrowOutUpRight, Unlink, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAction } from '../../lib/hooks';
import { useTx } from '../../lib/i18n';
import { usd } from '../../lib/format';
import { Badge, Button, Input, Select, cx } from '../ui';
import { CATALOG_INVALIDATE, type Group, type Pack } from './types';

/** Pack name, edited in place (the full name customers see, e.g. "ChatGPT Plus 1M"). */
function PackName({ pack, owner }: { pack: Pack; owner: boolean }) {
  const tx = useTx();
  const [edit, setEdit] = useState<string | null>(null);
  const { run, busy } = useAction();
  const save = async () => {
    const name = edit?.trim();
    if (!name || name === pack.name_en) return setEdit(null);
    const r = await run('name', () => api(`/products/${pack.id}`, { method: 'PATCH', body: { name_en: name } }), { success: tx('Renamed', 'تمت إعادة التسمية'), invalidate: CATALOG_INVALIDATE });
    if (r) setEdit(null);
  };
  if (edit !== null) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Input autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} className="!py-1"
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEdit(null); }} />
        <Button size="sm" variant="primary" loading={busy === 'name'} onClick={() => void save()} aria-label={tx('Save', 'حفظ')}><Check className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" onClick={() => setEdit(null)} aria-label={tx('Cancel', 'إلغاء')}><X className="h-3.5 w-3.5" /></Button>
      </div>
    );
  }
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1">
        <span className="break-words font-medium">{pack.emoji && <span className="me-1">{pack.emoji}</span>}{pack.name_en}</span>
        {owner && <button type="button" onClick={() => setEdit(pack.name_en)} className="shrink-0 rounded p-1 text-ink-400 hover:text-white" title={tx('Rename', 'إعادة تسمية')}><Pencil className="h-3 w-3" /></button>}
      </div>
      {pack.name_ar && <div className="text-xs text-ink-400" dir="rtl">{pack.name_ar}</div>}
    </div>
  );
}

/** Paused pack: why, and the one-click way out when the provider raised the cost. */
export function PausedNote({ pack, owner }: { pack: Pick<Pack, 'id' | 'paused_reason' | 'pending_cost' | 'cost_basis'>; owner: boolean }) {
  const tx = useTx();
  const { run, busy } = useAction();
  if (!pack.paused_reason) return null;
  const why = pack.paused_reason === 'cost_jump'
    ? tx('cost went up', 'ارتفعت التكلفة')
    : tx('price below the minimum margin', 'السعر أقل من الحد الأدنى للربح');
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Badge tone="red">{tx('Paused', 'موقوف')} · {why}</Badge>
      {pack.pending_cost != null && <span className="text-ink-400">{usd(pack.cost_basis)} → <span className="text-red-300">{usd(pack.pending_cost)}</span></span>}
      {owner && pack.pending_cost != null && (
        <Button size="sm" variant="success" loading={busy === 'accept'}
          onClick={() => void run('accept', () => api(`/products/${pack.id}/accept-cost`, { method: 'POST' }), { success: tx('New cost accepted — the pack is on sale again', 'تم قبول التكلفة الجديدة — عادت الباقة للبيع'), invalidate: CATALOG_INVALIDATE })}>
          {tx('Accept new cost', 'قبول التكلفة الجديدة')}
        </Button>
      )}
    </div>
  );
}

export function StockBadge({ pack }: { pack: Pick<Pack, 'sold_out' | 'available'> }) {
  const tx = useTx();
  if (pack.sold_out) return <Badge tone="red">{tx('sold out', 'نفدت الكمية')}</Badge>;
  return <Badge tone="green">{pack.available == null ? '∞' : pack.available} {tx('in stock', 'متوفر')}</Badge>;
}

export function PriceTag({ pack }: { pack: Pick<Pack, 'price' | 'original_price'> }) {
  return (
    <span className="whitespace-nowrap text-sm">
      {pack.original_price && pack.price && pack.original_price > pack.price ? <span className="me-1 text-xs text-ink-400 line-through">{usd(pack.original_price)}</span> : null}
      <span className="font-semibold text-gold">{usd(pack.price)}</span>
    </span>
  );
}

/**
 * Packs as rows on wide screens and stacked cards on phones.
 * In a product (`group`), packs can be reordered and taken out; without one (`moveTargets`)
 * each pack can be put into a product of its category or a new one.
 */
export function PackList({ packs, owner, group, onReorder, moveTargets, onNewProduct, empty }: {
  packs: Pack[];
  owner: boolean;
  group?: Group;
  onReorder?: (ids: string[]) => Promise<unknown>;
  moveTargets?: Group[];
  onNewProduct?: (packId: string) => void;
  empty?: string;
}) {
  const tx = useTx();
  const { run, busy } = useAction();
  const patch = (p: Pack, body: Record<string, unknown>, key: string) =>
    run(`${key}-${p.id}`, () => api(`/products/${p.id}`, { method: 'PATCH', body }), { invalidate: CATALOG_INVALIDATE });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (!onReorder || j < 0 || j >= packs.length) return;
    const ids = packs.map((p) => p.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run('reorder', () => onReorder(ids), { invalidate: CATALOG_INVALIDATE });
  };
  const attach = (p: Pack, target: string) => {
    if (target === '__new') return onNewProduct?.(p.id);
    void run(`attach-${p.id}`, () => api(`/groups/${target}/packs`, { body: { product_ids: [p.id] } }), { success: tx('Added to the product', 'أُضيفت إلى المنتج'), invalidate: CATALOG_INVALIDATE });
  };

  if (!packs.length) return <div className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-sm text-ink-400">{empty ?? tx('No packs yet', 'لا توجد باقات بعد')}</div>;

  return (
    <div className="divide-y divide-ink-700/70 overflow-hidden rounded-lg border border-ink-700">
      {packs.map((p, i) => (
        <div key={p.id} className={cx('flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3', !p.is_active && 'opacity-60', p.paused_reason && 'bg-red-500/5')}>
          <div className="flex min-w-0 flex-1 items-start gap-2">
            {owner && onReorder && (
              <div className="flex shrink-0 flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-0.5 text-ink-400 hover:text-white disabled:opacity-30" aria-label={tx('Move up', 'تحريك لأعلى')}><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === packs.length - 1} className="p-0.5 text-ink-400 hover:text-white disabled:opacity-30" aria-label={tx('Move down', 'تحريك لأسفل')}><ArrowDown className="h-3.5 w-3.5" /></button>
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <PackName pack={p} owner={owner} />
              <div className="flex flex-wrap items-center gap-1">
                {p.pinned && <Badge tone="gold"><Pin className="h-3 w-3" /> {tx('pinned', 'مثبّتة')}</Badge>}
                {!p.is_active && <Badge>{tx('hidden', 'مخفية')}</Badge>}
                {p.fulfillment === 'manual' && <Badge tone="purple">{tx('manual', 'يدوي')}</Badge>}
                {p.sources.length === 0 && <Badge tone="red">{tx('no source', 'بدون مصدر')}</Badge>}
                {p.sources.map((s, k) => <Badge key={k} tone={s.usable ? 'blue' : 'gray'}>{s.provider ?? (s.kind === 'stock' ? tx('my stock', 'مخزوني') : s.kind === 'manual' ? tx('manual', 'يدوي') : s.kind)}</Badge>)}
              </div>
              <PausedNote pack={p} owner={owner} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            <PriceTag pack={p} />
            <StockBadge pack={p} />
            <div className="ms-auto flex items-center gap-0.5 sm:ms-0">
              {owner && (
                <Button size="sm" variant="ghost" loading={busy === `pin-${p.id}`} onClick={() => void patch(p, { pinned: !p.pinned }, 'pin')} title={p.pinned ? tx('Unpin', 'إلغاء التثبيت') : tx('Pin to the top', 'تثبيت في الأعلى')}>
                  {p.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </Button>
              )}
              <Button size="sm" variant="ghost" loading={busy === `vis-${p.id}`} onClick={() => void patch(p, { is_active: !p.is_active }, 'vis')} title={p.is_active ? tx('Hide from the bot', 'إخفاء من البوت') : tx('Show in the bot', 'إظهار في البوت')}>
                {p.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </Button>
              {owner && group && (
                <Button size="sm" variant="ghost" loading={busy === `out-${p.id}`} title={tx('Take out of this product', 'إخراج من هذا المنتج')}
                  onClick={() => void run(`out-${p.id}`, () => api('/products/bulk', { body: { ids: [p.id], action: 'group', group_id: null } }), { invalidate: CATALOG_INVALIDATE })}>
                  <Unlink className="h-3.5 w-3.5" />
                </Button>
              )}
              <Link to={`/products/${p.id}`} className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-white" title={tx('Open the editor', 'فتح المحرر')}><SquareArrowOutUpRight className="h-3.5 w-3.5" /></Link>
            </div>
            {owner && moveTargets && (
              <Select className="!py-1 text-xs sm:max-w-[190px]" value="" disabled={busy === `attach-${p.id}`} onChange={(e) => e.target.value && attach(p, e.target.value)} options={[
                { value: '', label: tx('Add to product…', 'إضافة إلى منتج…') },
                ...(onNewProduct ? [{ value: '__new', label: tx('+ New product', '+ منتج جديد') }] : []),
                ...moveTargets.map((g) => ({ value: g.id, label: g.name_en })),
              ]} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
