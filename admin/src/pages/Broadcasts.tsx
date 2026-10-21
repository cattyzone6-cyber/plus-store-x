import { useState } from 'react';
import { Plus, Send, Trash2, XCircle } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { dt } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, ImageInput, Input, Loading, PageHeader, Pagination, Select, Table, Textarea } from '../components/ui';

interface Broadcast {
  id: string; text_en: string; text_ar: string | null; image_url: string | null; buttons: { text: string; url: string }[];
  target: string; status: string; sent: number; failed: number; created_at: string; started_at: string | null; finished_at: string | null;
}

const TARGETS = [
  { value: 'all', label: 'Everyone' }, { value: 'lang_en', label: 'English users' }, { value: 'lang_ar', label: 'Arabic users' },
  { value: 'buyers', label: 'Customers who bought' }, { value: 'non_buyers', label: 'Never bought' },
];

function Composer({ onDone }: { onDone: () => void }) {
  const [textEn, setTextEn] = useState('');
  const [textAr, setTextAr] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [target, setTarget] = useState('all');
  const [buttons, setButtons] = useState<{ text: string; url: string }[]>([]);
  const audience = useApi<{ count: number }>(`/broadcasts/audience/${target}`);
  const { run, busy } = useAction();

  const create = async (send: boolean) => {
    const r = await run('create', async () => {
      const res = await api<{ item: Broadcast }>('/broadcasts', { body: { text_en: textEn, text_ar: textAr || null, image_url: image, target, buttons: buttons.filter((b) => b.text && b.url) } });
      if (send) await api(`/broadcasts/${res.item.id}/send`, { method: 'POST' });
      return res;
    }, { success: send ? 'Broadcast started' : 'Draft saved', invalidate: ['/broadcasts'] });
    if (r) onDone();
  };

  return (
    <Card title="New broadcast">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Message (EN)" hint="Telegram HTML: <b>, <i>, <a href>, <code>"><Textarea rows={8} value={textEn} onChange={(e) => setTextEn(e.target.value)} /></Field>
        <Field label="Message (AR)" hint="Arabic users get this one (falls back to English)"><Textarea dir="rtl" rows={8} value={textAr} onChange={(e) => setTextAr(e.target.value)} /></Field>
        <Field label="Image (optional)"><ImageInput value={image} onChange={setImage} /></Field>
        <Field label="Audience" hint={audience.data ? `${audience.data.count} recipients` : undefined}><Select value={target} onChange={(e) => setTarget(e.target.value)} options={TARGETS} /></Field>
        <div className="lg:col-span-2">
          <div className="label">Link buttons</div>
          {buttons.map((b, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Input placeholder="Text" value={b.text} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <Input placeholder="https://…" value={b.url} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <Button variant="ghost" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {buttons.length < 6 && <Button size="sm" onClick={() => setButtons([...buttons, { text: '', url: '' }])}><Plus className="h-3.5 w-3.5" /> Add button</Button>}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button disabled={!textEn.trim()} loading={busy === 'create'} onClick={() => void create(false)}>Save draft</Button>
        <Button variant="primary" disabled={!textEn.trim()} loading={busy === 'create'} onClick={() => { if (confirm(`Send to ${audience.data?.count ?? '?'} users?`)) void create(true); }}><Send className="h-4 w-4" /> Send now</Button>
      </div>
    </Card>
  );
}

export default function Broadcasts() {
  const [page, setPage] = useState(1);
  const [composing, setComposing] = useState(false);
  const { run } = useAction();
  const list = useApi<Paged<Broadcast>>(`/broadcasts${qs({ page, limit: 20 })}`, { refetchInterval: 10_000 });

  return (
    <>
      <PageHeader title="Broadcast" sub="Message all customers. Sending runs in the background in batches." actions={!composing && <Button variant="primary" onClick={() => setComposing(true)}><Plus className="h-4 w-4" /> New broadcast</Button>} />
      {composing && <div className="mb-4"><Composer onDone={() => setComposing(false)} /></div>}
      <Card>
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={['Message', 'Audience', 'Status', 'Sent', 'Failed', 'Created', '']} empty={!list.data?.items.length}>
              {list.data!.items.map((b) => (
                <tr key={b.id}>
                  <td className="td max-w-[320px] truncate">{b.text_en.replace(/<[^>]+>/g, '')}</td>
                  <td className="td text-xs">{TARGETS.find((t) => t.value === b.target)?.label}</td>
                  <td className="td"><Badge tone={b.status === 'done' ? 'green' : b.status === 'sending' || b.status === 'queued' ? 'gold' : 'gray'}>{b.status}</Badge></td>
                  <td className="td">{b.sent}</td>
                  <td className="td">{b.failed}</td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(b.created_at)}</td>
                  <td className="td whitespace-nowrap text-end">
                    {b.status === 'draft' && <Button size="sm" variant="primary" onClick={() => { if (confirm('Send this broadcast now?')) void run('send', () => api(`/broadcasts/${b.id}/send`, { method: 'POST' }), { success: 'Started', invalidate: ['/broadcasts'] }); }}><Send className="h-3.5 w-3.5" /></Button>}
                    {(b.status === 'queued' || b.status === 'sending') && <Button size="sm" variant="ghost" onClick={() => void run('cancel', () => api(`/broadcasts/${b.id}/cancel`, { method: 'POST' }), { success: 'Cancelled', invalidate: ['/broadcasts'] })}><XCircle className="h-3.5 w-3.5" /></Button>}
                    {['draft', 'done', 'cancelled'].includes(b.status) && <Button size="sm" variant="ghost" onClick={() => { if (confirm('Delete?')) void run('del', () => api(`/broadcasts/${b.id}`, { method: 'DELETE' }), { invalidate: ['/broadcasts'] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} limit={list.data!.limit} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
