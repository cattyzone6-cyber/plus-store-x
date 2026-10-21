import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, useIsOwner } from '../lib/hooks';
import { Badge, Button, Card, Dialog, ErrorBox, Field, ImageInput, Input, Loading, PageHeader, Select, StyleDot, StyleSelect, Switch, Table, Textarea } from '../components/ui';

export interface Category {
  id: string; parent_id: string | null; name_en: string; name_ar: string | null; description_en: string | null; description_ar: string | null;
  emoji: string | null; custom_emoji_id: string | null; image_url: string | null; button_style: string; sort: number; is_active: boolean;
  products: { total: number; active: number };
}

function CategoryDialog({ cat, all, onClose }: { cat: Partial<Category> | null; all: Category[]; onClose: () => void }) {
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
    const ok = await run('save', () => cat?.id ? api(`/categories/${cat.id}`, { method: 'PATCH', body: payload }) : api('/categories', { body: payload }), { success: 'Saved', invalidate: ['/categories'] });
    if (ok) onClose();
  };
  return (
    <Dialog open onClose={onClose} title={cat?.id ? 'Edit category' : 'New category'} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy === 'save'} onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name (EN)"><Input value={f.name_en ?? ''} onChange={(e) => set('name_en', e.target.value)} /></Field>
        <Field label="Name (AR)"><Input dir="rtl" value={f.name_ar ?? ''} onChange={(e) => set('name_ar', e.target.value)} /></Field>
        <Field label="Description (EN)"><Textarea value={f.description_en ?? ''} onChange={(e) => set('description_en', e.target.value)} /></Field>
        <Field label="Description (AR)"><Textarea dir="rtl" value={f.description_ar ?? ''} onChange={(e) => set('description_ar', e.target.value)} /></Field>
        <Field label="Emoji (fallback)"><Input value={f.emoji ?? ''} onChange={(e) => set('emoji', e.target.value)} placeholder="🤖" /></Field>
        <Field label="Custom emoji ID (premium)" hint="Send the emoji to the bot with /emoji to get its ID"><Input value={f.custom_emoji_id ?? ''} onChange={(e) => set('custom_emoji_id', e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="Button color"><StyleSelect value={f.button_style} onChange={(v) => set('button_style', v ?? 'primary')} /></Field>
        <Field label="Parent category">
          <Select value={f.parent_id ?? ''} onChange={(e) => set('parent_id', e.target.value || null)} options={[{ value: '', label: '— top level —' }, ...all.filter((c) => c.id !== cat?.id).map((c) => ({ value: c.id, label: c.name_en }))]} />
        </Field>
        <Field label="Image" className="sm:col-span-2"><ImageInput value={f.image_url} onChange={(v) => set('image_url', v)} /></Field>
        <Switch checked={f.is_active ?? true} onChange={(v) => set('is_active', v)} label="Visible in the bot" />
      </div>
    </Dialog>
  );
}

export default function Categories() {
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

  return (
    <>
      <PageHeader title="Categories" sub="Shown as buttons in the bot's Shop menu."
        actions={owner && <Button variant="primary" onClick={() => setEdit(null)}><Plus className="h-4 w-4" /> New category</Button>} />
      <Card>
        <Table head={['', 'Name', 'Parent', 'Products', 'Color', 'Status', '']} empty={!cats.length}>
          {cats.map((c, i) => (
            <tr key={c.id}>
              <td className="td w-16">
                {owner && <div className="flex">
                  <button onClick={() => move(i, -1)} className="p-1 text-ink-400 hover:text-white"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button onClick={() => move(i, 1)} className="p-1 text-ink-400 hover:text-white"><ArrowDown className="h-3.5 w-3.5" /></button>
                </div>}
              </td>
              <td className="td"><span className="me-1.5">{c.emoji}</span>{c.name_en}{c.name_ar && <span className="ms-2 text-xs text-ink-400" dir="rtl">{c.name_ar}</span>}</td>
              <td className="td text-ink-400">{name(c.parent_id) ?? '—'}</td>
              <td className="td"><Link to={`/products${qs({ category_id: c.id })}`} className="hover:text-gold">{c.products.active} / {c.products.total}</Link></td>
              <td className="td"><StyleDot style={c.button_style} /></td>
              <td className="td">{c.is_active ? <Badge tone="green">visible</Badge> : <Badge>hidden</Badge>}</td>
              <td className="td text-end">
                {owner && <>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete "${c.name_en}"? Products stay but lose their category.`)) void run('del', () => api(`/categories/${c.id}`, { method: 'DELETE' }), { success: 'Deleted', invalidate: ['/categories'] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {edit !== undefined && <CategoryDialog cat={edit} all={cats} onClose={() => setEdit(undefined)} />}
    </>
  );
}
