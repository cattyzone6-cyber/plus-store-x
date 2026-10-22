import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, useIsOwner } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { Badge, Button, Card, Dialog, ErrorBox, Field, ImageInput, Input, Loading, PageHeader, Select, StyleDot, StyleSelect, Switch, Table, Textarea } from '../components/ui';

export interface Category {
  id: string; parent_id: string | null; name_en: string; name_ar: string | null; description_en: string | null; description_ar: string | null;
  emoji: string | null; custom_emoji_id: string | null; image_url: string | null; button_style: string; sort: number; is_active: boolean;
  products: { total: number; active: number };
}

function CategoryDialog({ cat, all, onClose }: { cat: Partial<Category> | null; all: Category[]; onClose: () => void }) {
  const tx = useTx();
  const [f, setF] = useState<Partial<Category>>(cat ?? { is_active: true, button_style: 'primary' });
  const { run, busy } = useAction();
  const set = <K extends keyof Category>(k: K, v: Category[K] | null) => setF({ ...f, [k]: v });
  const save = async () => {
    const payload = {
      parent_id: f.parent_id || null, name_en: f.name_en ?? '', name_ar: f.name_ar || null,
      description_en: f.description_en || null, description_ar: f.description_ar || null,
      emoji: f.emoji || null, custom_emoji_id: f.custom_emoji_id || null, image_url: f.image_url || null,
      button_style: f.button_style ?? 'primary', is_active: f.is_active ?? true,
    };
    const ok = await run('save', () => cat?.id ? api(`/categories/${cat.id}`, { method: 'PATCH', body: payload }) : api('/categories', { body: payload }), { success: tx('Saved', 'تم الحفظ'), invalidate: ['/categories'] });
    if (ok) onClose();
  };
  return (
    <Dialog open onClose={onClose} title={cat?.id ? tx('Edit category', 'تعديل القسم') : tx('New category', 'قسم جديد')} wide
      footer={<><Button onClick={onClose}>{tx('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy === 'save'} onClick={save}>{tx('Save', 'حفظ')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx('Name (EN)', 'الاسم (إنجليزي)')}><Input value={f.name_en ?? ''} onChange={(e) => set('name_en', e.target.value)} /></Field>
        <Field label={tx('Name (AR)', 'الاسم (عربي)')}><Input dir="rtl" value={f.name_ar ?? ''} onChange={(e) => set('name_ar', e.target.value)} /></Field>
        <Field label={tx('Description (EN)', 'الوصف (إنجليزي)')}><Textarea value={f.description_en ?? ''} onChange={(e) => set('description_en', e.target.value)} /></Field>
        <Field label={tx('Description (AR)', 'الوصف (عربي)')}><Textarea dir="rtl" value={f.description_ar ?? ''} onChange={(e) => set('description_ar', e.target.value)} /></Field>
        <Field label={tx('Emoji (fallback)', 'إيموجي (احتياطي)')}><Input value={f.emoji ?? ''} onChange={(e) => set('emoji', e.target.value)} placeholder="🤖" /></Field>
        <Field label={tx('Custom emoji ID (premium)', 'معرّف إيموجي مميز (بريميوم)')} hint={tx('Send the emoji to the bot with /emoji to get its ID', 'أرسل الإيموجي للبوت مع /emoji لتحصل على معرّفه')}><Input value={f.custom_emoji_id ?? ''} onChange={(e) => set('custom_emoji_id', e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label={tx('Button color', 'لون الزر')}><StyleSelect value={f.button_style} onChange={(v) => set('button_style', v ?? 'primary')} /></Field>
        <Field label={tx('Parent category', 'القسم الأب')}>
          <Select value={f.parent_id ?? ''} onChange={(e) => set('parent_id', e.target.value || null)} options={[{ value: '', label: tx('— top level —', '— المستوى الأعلى —') }, ...all.filter((c) => c.id !== cat?.id).map((c) => ({ value: c.id, label: c.name_en }))]} />
        </Field>
        <Field label={tx('Image', 'الصورة')} className="sm:col-span-2"><ImageInput value={f.image_url} onChange={(v) => set('image_url', v)} placeholder={tx('https://… or upload', 'https://… أو ارفع صورة')} /></Field>
        <Switch checked={f.is_active ?? true} onChange={(v) => set('is_active', v)} label={tx('Visible in the bot', 'ظاهر في البوت')} />
      </div>
    </Dialog>
  );
}

export default function Categories() {
  const tx = useTx();
  const q = useApi<{ categories: Category[] }>('/categories');
  const { run } = useAction();
  const owner = useIsOwner();
  const [edit, setEdit] = useState<Partial<Category> | null | undefined>(undefined);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const cats = q.data!.categories;
  const name = (id: string | null) => cats.find((c) => c.id === id)?.name_en;

  const move = (i: number, d: number) => {
    const ids = cats.map((c) => c.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run('reorder', () => api('/categories/reorder', { body: { ids } }), { invalidate: ['/categories'] });
  };
  const actions = (c: Category) => owner && (
    <>
      <Button size="sm" variant="ghost" onClick={() => setEdit(c)} aria-label={tx('Edit', 'تعديل')}><Pencil className="h-3.5 w-3.5" /></Button>
      <Button size="sm" variant="ghost" aria-label={tx('Delete', 'حذف')} onClick={() => {
        if (confirm(tx(`Delete "${c.name_en}"? Products stay but lose their category.`, `حذف "${c.name_en}"؟ المنتجات تبقى لكن بدون قسم.`))) void run('del', () => api(`/categories/${c.id}`, { method: 'DELETE' }), { success: tx('Deleted', 'تم الحذف'), invalidate: ['/categories'] });
      }}><Trash2 className="h-3.5 w-3.5" /></Button>
    </>
  );
  const arrows = (i: number) => owner && (
    <div className="flex">
      <button onClick={() => move(i, -1)} className="p-1 text-ink-400 hover:text-white" aria-label={tx('Move up', 'تحريك لأعلى')}><ArrowUp className="h-3.5 w-3.5" /></button>
      <button onClick={() => move(i, 1)} className="p-1 text-ink-400 hover:text-white" aria-label={tx('Move down', 'تحريك لأسفل')}><ArrowDown className="h-3.5 w-3.5" /></button>
    </div>
  );
  const status = (c: Category) => (c.is_active ? <Badge tone="green">{tx('visible', 'ظاهر')}</Badge> : <Badge>{tx('hidden', 'مخفي')}</Badge>);

  return (
    <>
      <PageHeader title={tx('Categories', 'الأقسام')} sub={tx('Shown as buttons in the bot\'s Shop menu. The Catalog page manages categories, products and packs together.', 'تظهر كأزرار في قائمة المتجر في البوت. صفحة الكتالوج تدير الأقسام والمنتجات والباقات معاً.')}
        actions={owner && <Button variant="primary" onClick={() => setEdit(null)}><Plus className="h-4 w-4" /> {tx('New category', 'قسم جديد')}</Button>} />
      <Card>
        {/* phones: stacked cards */}
        <div className="space-y-2 sm:hidden">
          {cats.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-ink-700 p-3">
              {arrows(i)}
              <div className="min-w-0 flex-1">
                <div className="break-words font-medium"><span className="me-1.5">{c.emoji}</span>{c.name_en}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-ink-400">
                  {status(c)}
                  <Link to={`/products${qs({ category_id: c.id })}`} className="hover:text-gold">{c.products.active} / {c.products.total} {tx('packs', 'باقات')}</Link>
                </div>
              </div>
              {actions(c)}
            </div>
          ))}
        </div>
        <div className="hidden sm:block">
          <Table head={['', tx('Name', 'الاسم'), tx('Parent', 'الأب'), tx('Packs', 'الباقات'), tx('Color', 'اللون'), tx('Status', 'الحالة'), '']} empty={!cats.length}>
            {cats.map((c, i) => (
              <tr key={c.id}>
                <td className="td w-16">{arrows(i)}</td>
                <td className="td"><span className="me-1.5">{c.emoji}</span>{c.name_en}{c.name_ar && <span className="ms-2 text-xs text-ink-400" dir="rtl">{c.name_ar}</span>}</td>
                <td className="td text-ink-400">{name(c.parent_id) ?? '—'}</td>
                <td className="td"><Link to={`/products${qs({ category_id: c.id })}`} className="hover:text-gold">{c.products.active} / {c.products.total}</Link></td>
                <td className="td"><StyleDot style={c.button_style} /></td>
                <td className="td">{status(c)}</td>
                <td className="td text-end">{actions(c)}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
      {edit !== undefined && <CategoryDialog cat={edit} all={cats} onClose={() => setEdit(undefined)} />}
    </>
  );
}
