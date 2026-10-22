import { useEffect, useMemo, useState } from 'react';
import { Trash2, Wand2 } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAction, useApi, type Paged } from '../../lib/hooks';
import { useTx } from '../../lib/i18n';
import { usd } from '../../lib/format';
import { Badge, Button, Dialog, Field, ImageInput, Input, Select, StyleSelect, Switch, Textarea } from '../ui';
import { CATALOG_INVALIDATE, type CatalogCategory, type Group, type Pack } from './types';

/**
 * Create or edit a product (group): its name, look and the packs inside it.
 * Packs picked here move into the product's category.
 */
export function GroupEditor({ group, categories, preselect, onClose }: {
  group: Partial<Group>;
  categories: CatalogCategory[];
  /** pack ids ticked when the dialog opens (e.g. "+ New product" from a pack) */
  preselect?: string[];
  onClose: () => void;
}) {
  const tx = useTx();
  const editing = !!group.id;
  const [f, setF] = useState<Partial<Group>>({ is_active: true, ...group });
  const set = <K extends keyof Group>(k: K, v: Group[K] | null) => setF((cur) => ({ ...cur, [k]: v }));
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect ?? []));
  const { run, busy } = useAction();

  // packs that are not in any product yet; ticked ones stay listed while searching
  const free = useApi<Paged<Pack>>(`/products${qs({ group_id: 'none', limit: 200, q })}`);
  const [known, setKnown] = useState<Map<string, Pack>>(new Map());
  useEffect(() => {
    if (!free.data) return;
    setKnown((cur) => { const n = new Map(cur); for (const p of free.data!.items) n.set(p.id, p); return n; });
  }, [free.data]);
  const list = useMemo(() => {
    const items = free.data?.items ?? [];
    const extra = [...picked].filter((id) => !items.some((p) => p.id === id)).map((id) => known.get(id)).filter(Boolean) as Pack[];
    return [...extra, ...items];
  }, [free.data, picked, known]);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name_en;

  // suggest a product name from the picked packs ("ChatGPT Plus 1M", "ChatGPT Plus 3M" → ChatGPT Plus)
  const [suggest, setSuggest] = useState<string | null>(null);
  const pickedNames = [...picked].map((id) => known.get(id)?.name_en).filter(Boolean) as string[];
  const namesKey = pickedNames.join('|');
  useEffect(() => {
    if (editing || !pickedNames.length) return setSuggest(null);
    let live = true;
    void api<{ items: { product: string }[] }>('/names/preview', { body: { names: pickedNames.slice(0, 50) } }).then((r) => {
      if (!live) return;
      const tally = new Map<string, number>();
      for (const i of r.items) tally.set(i.product, (tally.get(i.product) ?? 0) + 1);
      setSuggest([...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
    }).catch(() => live && setSuggest(null));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, editing]);

  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    const payload = {
      name_en: (f.name_en ?? '').trim(), name_ar: f.name_ar?.trim() || null,
      category_id: f.category_id || null, emoji: f.emoji?.trim() || null, custom_emoji_id: f.custom_emoji_id || null,
      image_url: f.image_url || null, description_en: f.description_en || null, description_ar: f.description_ar || null,
      button_style: f.button_style || null, is_active: f.is_active ?? true, is_featured: f.is_featured ?? false,
    };
    const ids = [...picked];
    const r = await run('save', async () => {
      if (!editing) return api('/groups', { body: { ...payload, product_ids: ids } });
      await api(`/groups/${group.id}`, { method: 'PATCH', body: payload });
      if (ids.length) await api(`/groups/${group.id}/packs`, { body: { product_ids: ids } });
      return true;
    }, { success: tx('Product saved', 'تم حفظ المنتج'), invalidate: CATALOG_INVALIDATE });
    if (r) onClose();
  };
  const remove = async () => {
    if (!confirm(tx('Delete this product? Its packs are kept and go back to "Packs without a product".', 'حذف هذا المنتج؟ الباقات تبقى وتعود إلى "باقات بدون منتج".'))) return;
    const r = await run('delete', () => api(`/groups/${group.id}`, { method: 'DELETE' }), { success: tx('Product deleted', 'تم حذف المنتج'), invalidate: CATALOG_INVALIDATE });
    if (r) onClose();
  };

  return (
    <Dialog open onClose={onClose} wide title={editing ? tx('Edit product', 'تعديل المنتج') : tx('New product', 'منتج جديد')}
      footer={<>
        {editing && <Button variant="danger" className="me-auto" loading={busy === 'delete'} onClick={() => void remove()}><Trash2 className="h-4 w-4" /> {tx('Delete', 'حذف')}</Button>}
        <Button onClick={onClose}>{tx('Cancel', 'إلغاء')}</Button>
        <Button variant="primary" disabled={!f.name_en?.trim()} loading={busy === 'save'} onClick={() => void save()}>{tx('Save', 'حفظ')}</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx('Name (EN)', 'الاسم (إنجليزي)')} hint={tx('What customers tap first, e.g. "ChatGPT Plus". Packs keep their full names.', 'أول ما يضغط عليه العميل، مثل "ChatGPT Plus". الباقات تحتفظ بأسمائها الكاملة.')}>
          <Input autoFocus value={f.name_en ?? ''} onChange={(e) => set('name_en', e.target.value)} placeholder="ChatGPT Plus" />
          {suggest && !f.name_en && (
            <button type="button" onClick={() => set('name_en', suggest)} className="mt-1 inline-flex items-center gap-1 text-xs text-gold hover:underline">
              <Wand2 className="h-3 w-3" /> {tx('Use', 'استخدم')} “{suggest}”
            </button>
          )}
        </Field>
        <Field label={tx('Name (AR)', 'الاسم (عربي)')}><Input dir="rtl" value={f.name_ar ?? ''} onChange={(e) => set('name_ar', e.target.value)} /></Field>
        <Field label={tx('Category', 'القسم')}>
          <Select value={f.category_id ?? ''} onChange={(e) => set('category_id', e.target.value || null)} options={[
            { value: '', label: tx('— no category —', '— بدون قسم —') },
            ...categories.map((c) => ({ value: c.id, label: `${c.emoji ? `${c.emoji} ` : ''}${c.name_en}` })),
          ]} />
        </Field>
        <Field label={tx('Button color', 'لون الزر')}><StyleSelect allowInherit value={f.button_style} onChange={(v) => set('button_style', v)} /></Field>
        <Field label={tx('Emoji', 'إيموجي')}><Input value={f.emoji ?? ''} onChange={(e) => set('emoji', e.target.value)} placeholder="🤖" /></Field>
        <Field label={tx('Custom emoji ID (premium)', 'معرّف إيموجي مميز (بريميوم)')} hint={tx('Send the emoji to the bot with /emoji to get its ID', 'أرسل الإيموجي للبوت مع /emoji لتحصل على معرّفه')}>
          <Input value={f.custom_emoji_id ?? ''} onChange={(e) => set('custom_emoji_id', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={tx('Image', 'الصورة')} className="sm:col-span-2"><ImageInput value={f.image_url} onChange={(v) => set('image_url', v)} placeholder={tx('https://… or upload', 'https://… أو ارفع صورة')} /></Field>
        <Field label={tx('Description (EN)', 'الوصف (إنجليزي)')} hint={tx('Shown above the pack buttons. Telegram HTML allowed.', 'يظهر فوق أزرار الباقات. يُسمح بتنسيق HTML الخاص بتيليجرام.')}>
          <Textarea value={f.description_en ?? ''} onChange={(e) => set('description_en', e.target.value)} />
        </Field>
        <Field label={tx('Description (AR)', 'الوصف (عربي)')}><Textarea dir="rtl" value={f.description_ar ?? ''} onChange={(e) => set('description_ar', e.target.value)} /></Field>
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          <Switch checked={f.is_active ?? true} onChange={(v) => set('is_active', v)} label={tx('Visible in the bot', 'ظاهر في البوت')} />
          <Switch checked={f.is_featured ?? false} onChange={(v) => set('is_featured', v)} label={tx('Featured', 'مميز')} />
        </div>
      </div>

      <div className="mt-5 border-t border-ink-700 pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">{editing ? tx('Add packs', 'إضافة باقات') : tx('Packs in this product', 'الباقات في هذا المنتج')}</div>
            <p className="text-xs text-ink-400">{tx('Packs that are not in a product yet. Picked packs move to this product\'s category.', 'باقات ليست ضمن أي منتج بعد. الباقات المختارة تنتقل إلى قسم هذا المنتج.')}</p>
          </div>
          {picked.size > 0 && <Badge tone="gold">{picked.size} {tx('picked', 'مختارة')}</Badge>}
        </div>
        <Input placeholder={tx('Search packs…', 'ابحث عن باقة…')} value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
        <div className="max-h-[38vh] divide-y divide-ink-700/70 overflow-y-auto rounded-lg border border-ink-700">
          {list.length === 0 && <div className="px-3 py-6 text-center text-sm text-ink-400">{free.isLoading ? tx('Loading…', 'جارٍ التحميل…') : tx('No free packs', 'لا توجد باقات متاحة')}</div>}
          {list.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-ink-800/60">
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-[#F5B301]" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm">{p.emoji && <span className="me-1">{p.emoji}</span>}{p.name_en}</span>
                <span className="text-xs text-ink-400">{catName(p.category_id) ?? tx('no category', 'بدون قسم')}</span>
              </span>
              <span className="shrink-0 text-xs text-gold">{usd(p.price)}</span>
            </label>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
