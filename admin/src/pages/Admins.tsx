import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useApi } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { dt } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, NumberInput, PageHeader, Select, Table } from '../components/ui';
import type { Admin } from '../lib/auth';

function InviteDialog({ onClose }: { onClose: () => void }) {
  const tx = useTx();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'owner' | 'support'>('support');
  const [tg, setTg] = useState<number | null>(null);
  const { run, busy } = useAction();
  return (
    <Dialog open onClose={onClose} title={tx('Add admin', 'إضافة مشرف')} footer={<><Button onClick={onClose}>{tx('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy === 'add'} disabled={!email} onClick={() => void run('add', () => api('/admins', { body: { email, password: password || undefined, role, telegram_id: tg } }), { success: tx('Admin added', 'تمت إضافة المشرف'), invalidate: ['/admins'] }).then((r) => r && onClose())}>{tx('Add', 'إضافة')}</Button></>}>
      <div className="space-y-3">
        <Field label={tx('Email', 'البريد الإلكتروني')}><Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={tx('Password', 'كلمة المرور')} hint={tx('Set one now (min 8 chars) or leave empty to send a Supabase invite email', 'عيّنها الآن (8 أحرف على الأقل) أو اتركها فارغة لإرسال دعوة بالبريد من Supabase')}><Input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label={tx('Role', 'الدور')}><Select value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'support')} options={[{ value: 'support', label: tx('Support — orders, deposits, tickets, users (no money/settings)', 'دعم — الطلبات والشحنات والتذاكر والزبائن (بدون الأموال والإعدادات)') }, { value: 'owner', label: tx('Owner — everything', 'مالك — كل شيء') }]} /></Field>
        <Field label={tx('Telegram user ID', 'رقم حساب تيليجرام')} hint={tx('Lets this admin receive alerts and use admin buttons in the bot', 'يتيح لهذا المشرف تلقي التنبيهات واستخدام أزرار الإدارة في البوت')}><NumberInput dir="ltr" allowNull value={tg} onChange={setTg} /></Field>
      </div>
    </Dialog>
  );
}

export default function Admins() {
  const tx = useTx();
  const q = useApi<{ items: Admin[] }>('/admins');
  const { admin: me, reloadAdmin } = useAuth();
  const { run } = useAction();
  const [adding, setAdding] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;

  return (
    <>
      <PageHeader title={tx('Admins', 'المشرفون')} sub={tx('People who can sign in to this panel.', 'الأشخاص الذين يمكنهم الدخول إلى هذه اللوحة.')} actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {tx('Add admin', 'إضافة مشرف')}</Button>} />
      <Card>
        <Table head={[tx('Email', 'البريد'), tx('Role', 'الدور'), tx('Telegram ID', 'رقم تيليجرام'), tx('Added', 'أضيف'), '']}>
          {q.data!.items.map((a) => (
            <tr key={a.user_id}>
              <td className="td max-w-[220px]"><span dir="ltr" className="break-all">{a.email}</span>{a.user_id === me?.user_id && <Badge className="ms-2" tone="gold">{tx('you', 'أنت')}</Badge>}</td>
              <td className="td w-40">
                <Select value={a.role} disabled={a.user_id === me?.user_id} onChange={(e) => void run('role', () => api(`/admins/${a.user_id}`, { method: 'PATCH', body: { role: e.target.value } }), { success: tx('Role updated', 'تم تحديث الدور'), invalidate: ['/admins'] })} options={[{ value: 'support', label: tx('Support', 'دعم') }, { value: 'owner', label: tx('Owner', 'مالك') }]} />
              </td>
              <td className="td w-48">
                <Input dir="ltr" defaultValue={a.telegram_id ?? ''} placeholder={tx('not linked', 'غير مربوط')} onBlur={(e) => {
                  const v = e.target.value.trim() ? Number(e.target.value) : null;
                  if (v !== a.telegram_id) void run('tg', () => api(`/admins/${a.user_id}`, { method: 'PATCH', body: { telegram_id: v } }), { success: tx('Telegram ID saved', 'تم حفظ رقم تيليجرام'), invalidate: ['/admins'] }).then(() => { if (a.user_id === me?.user_id) void reloadAdmin(); });
                }} />
              </td>
              <td className="td whitespace-nowrap text-xs text-ink-400">{dt((a as Admin & { created_at?: string }).created_at)}</td>
              <td className="td text-end">{a.user_id !== me?.user_id && <Button size="sm" variant="ghost" aria-label={tx('Remove', 'إزالة')} onClick={() => { if (confirm(tx(`Remove ${a.email}?`, `إزالة ${a.email}؟`))) void run('del', () => api(`/admins/${a.user_id}`, { method: 'DELETE' }), { success: tx('Removed', 'تمت الإزالة'), invalidate: ['/admins'] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-ink-400">{tx(
          'Owners listed in the Worker secret OWNER_EMAILS always get the owner role. Find your Telegram ID by sending /myid to the bot or using @userinfobot.',
          'المالكون المذكورون في سر الـ Worker ‏OWNER_EMAILS يحصلون دائماً على دور المالك. اعرف رقم تيليجرام الخاص بك بإرسال ‎/myid للبوت أو عبر ‎@userinfobot.',
        )}</p>
      </Card>
      {adding && <InviteDialog onClose={() => setAdding(false)} />}
    </>
  );
}
