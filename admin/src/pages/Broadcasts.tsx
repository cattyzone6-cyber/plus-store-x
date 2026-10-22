import { useState } from 'react';
import { Plus, Send, Trash2, XCircle } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { dt, label } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, ImageInput, Input, Loading, PageHeader, Pagination, Select, Table, Textarea } from '../components/ui';

interface Broadcast {
  id: string; text_en: string; text_ar: string | null; image_url: string | null; buttons: { text: string; url: string }[];
  target: string; status: string; sent: number; failed: number; created_at: string; started_at: string | null; finished_at: string | null;
}

function useTargets() {
  const tx = useTx();
  return [
    { value: 'all', label: tx('Everyone', 'الجميع') }, { value: 'lang_en', label: tx('English users', 'مستخدمو الإنجليزية') }, { value: 'lang_ar', label: tx('Arabic users', 'مستخدمو العربية') },
    { value: 'buyers', label: tx('Customers who bought', 'من اشترى سابقاً') }, { value: 'non_buyers', label: tx('Never bought', 'لم يشترِ بعد') },
  ];
}

function Composer({ onDone }: { onDone: () => void }) {
  const tx = useTx();
  const targets = useTargets();
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
    }, { success: send ? tx('Broadcast started', 'بدأ الإرسال') : tx('Draft saved', 'تم حفظ المسودة'), invalidate: ['/broadcasts'] });
    if (r) onDone();
  };

  return (
    <Card title={tx('New broadcast', 'رسالة جماعية جديدة')}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={tx('Message (EN)', 'الرسالة (إنجليزي)')} hint={tx('Telegram HTML: <b>, <i>, <a href>, <code>', 'HTML تيليجرام: <b>, <i>, <a href>, <code>')}><Textarea dir="ltr" rows={8} value={textEn} onChange={(e) => setTextEn(e.target.value)} /></Field>
        <Field label={tx('Message (AR)', 'الرسالة (عربي)')} hint={tx('Arabic users get this one (falls back to English)', 'تصل لمستخدمي العربية (وإلا تُرسل الإنجليزية)')}><Textarea dir="rtl" rows={8} value={textAr} onChange={(e) => setTextAr(e.target.value)} /></Field>
        <Field label={tx('Image (optional)', 'صورة (اختياري)')}><ImageInput value={image} onChange={setImage} /></Field>
        <Field label={tx('Audience', 'الجمهور')} hint={audience.data ? tx(`${audience.data.count} recipients`, `${audience.data.count} مستلم`) : undefined}><Select value={target} onChange={(e) => setTarget(e.target.value)} options={targets} /></Field>
        <div className="lg:col-span-2">
          <div className="label">{tx('Link buttons', 'أزرار روابط')}</div>
          {buttons.map((b, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_auto] gap-2 sm:flex">
              <Input placeholder={tx('Text', 'النص')} value={b.text} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <Button variant="ghost" className="sm:order-last" aria-label={tx('Remove', 'إزالة')} onClick={() => setButtons(buttons.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              <Input dir="ltr" placeholder="https://…" className="col-span-2" value={b.url} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            </div>
          ))}
          {buttons.length < 6 && <Button size="sm" onClick={() => setButtons([...buttons, { text: '', url: '' }])}><Plus className="h-3.5 w-3.5" /> {tx('Add button', 'إضافة زر')}</Button>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2 max-sm:[&>*]:flex-1">
        <Button disabled={!textEn.trim()} loading={busy === 'create'} onClick={() => void create(false)}>{tx('Save draft', 'حفظ كمسودة')}</Button>
        <Button variant="primary" disabled={!textEn.trim()} loading={busy === 'create'} onClick={() => { if (confirm(tx(`Send to ${audience.data?.count ?? '?'} users?`, `إرسال إلى ${audience.data?.count ?? '?'} مستخدم؟`))) void create(true); }}><Send className="h-4 w-4" /> {tx('Send now', 'إرسال الآن')}</Button>
      </div>
    </Card>
  );
}

export default function Broadcasts() {
  const tx = useTx();
  const targets = useTargets();
  const [page, setPage] = useState(1);
  const [composing, setComposing] = useState(false);
  const { run } = useAction();
  const list = useApi<Paged<Broadcast>>(`/broadcasts${qs({ page, limit: 20 })}`, { refetchInterval: 10_000 });
  const targetLabel = (t: string) => targets.find((x) => x.value === t)?.label ?? (t === 'alerts' ? tx('Stock alerts', 'تنبيهات المخزون') : t);

  return (
    <>
      <PageHeader title={tx('Broadcast', 'رسائل جماعية')} sub={tx('Message all customers. Sending runs in the background in batches.', 'راسل كل الزبائن. يتم الإرسال في الخلفية على دفعات.')} actions={!composing && <Button variant="primary" onClick={() => setComposing(true)}><Plus className="h-4 w-4" /> {tx('New broadcast', 'رسالة جديدة')}</Button>} />
      {composing && <div className="mb-4"><Composer onDone={() => setComposing(false)} /></div>}
      <Card>
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <>
            <Table head={[tx('Message', 'الرسالة'), tx('Audience', 'الجمهور'), tx('Status', 'الحالة'), tx('Sent', 'أُرسلت'), tx('Failed', 'فشلت'), tx('Created', 'التاريخ'), '']} empty={!list.data?.items.length}>
              {list.data!.items.map((b) => (
                <tr key={b.id}>
                  <td className="td max-w-[200px] truncate sm:max-w-[320px]" dir="auto">{b.text_en.replace(/<[^>]+>/g, '')}</td>
                  <td className="td text-xs">{targetLabel(b.target)}</td>
                  <td className="td"><Badge tone={b.status === 'done' ? 'green' : b.status === 'sending' || b.status === 'queued' ? 'gold' : 'gray'}>{label(b.status)}</Badge></td>
                  <td className="td">{b.sent}</td>
                  <td className="td">{b.failed}</td>
                  <td className="td whitespace-nowrap text-xs text-ink-400">{dt(b.created_at)}</td>
                  <td className="td whitespace-nowrap text-end">
                    {b.status === 'draft' && <Button size="sm" variant="primary" aria-label={tx('Send', 'إرسال')} onClick={() => { if (confirm(tx('Send this broadcast now?', 'إرسال هذه الرسالة الآن؟'))) void run('send', () => api(`/broadcasts/${b.id}/send`, { method: 'POST' }), { success: tx('Started', 'بدأ الإرسال'), invalidate: ['/broadcasts'] }); }}><Send className="h-3.5 w-3.5" /></Button>}
                    {(b.status === 'queued' || b.status === 'sending') && <Button size="sm" variant="ghost" aria-label={tx('Cancel', 'إلغاء')} onClick={() => void run('cancel', () => api(`/broadcasts/${b.id}/cancel`, { method: 'POST' }), { success: tx('Cancelled', 'أُلغي الإرسال'), invalidate: ['/broadcasts'] })}><XCircle className="h-3.5 w-3.5" /></Button>}
                    {['draft', 'done', 'cancelled'].includes(b.status) && <Button size="sm" variant="ghost" aria-label={tx('Delete', 'حذف')} onClick={() => { if (confirm(tx('Delete?', 'حذف؟'))) void run('del', () => api(`/broadcasts/${b.id}`, { method: 'DELETE' }), { invalidate: ['/broadcasts'] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
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
