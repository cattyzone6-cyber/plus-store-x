import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useApi } from '../lib/hooks';
import { dt } from '../lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Loading, NumberInput, PageHeader, Select, Table } from '../components/ui';
import type { Admin } from '../lib/auth';

function InviteDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'owner' | 'support'>('support');
  const [tg, setTg] = useState<number | null>(null);
  const { run, busy } = useAction();
  return (
    <Dialog open onClose={onClose} title="Add admin" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy === 'add'} disabled={!email} onClick={() => void run('add', () => api('/admins', { body: { email, password: password || undefined, role, telegram_id: tg } }), { success: 'Admin added', invalidate: ['/admins'] }).then((r) => r && onClose())}>Add</Button></>}>
      <div className="space-y-3">
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" hint="Set one now (min 8 chars) or leave empty to send a Supabase invite email"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'support')} options={[{ value: 'support', label: 'Support — orders, deposits, tickets, users (no money/settings)' }, { value: 'owner', label: 'Owner — everything' }]} /></Field>
        <Field label="Telegram user ID" hint="Lets this admin receive alerts and use admin buttons in the bot"><NumberInput allowNull value={tg} onChange={setTg} /></Field>
      </div>
    </Dialog>
  );
}

export default function Admins() {
  const q = useApi<{ items: Admin[] }>('/admins');
  const { admin: me, reloadAdmin } = useAuth();
  const { run } = useAction();
  const [adding, setAdding] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;

  return (
    <>
      <PageHeader title="Admins" sub="People who can sign in to this panel." actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add admin</Button>} />
      <Card>
        <Table head={['Email', 'Role', 'Telegram ID', 'Added', '']}>
          {q.data!.items.map((a) => (
            <tr key={a.user_id}>
              <td className="td">{a.email}{a.user_id === me?.user_id && <Badge className="ms-2" tone="gold">you</Badge>}</td>
              <td className="td w-40">
                <Select value={a.role} disabled={a.user_id === me?.user_id} onChange={(e) => void run('role', () => api(`/admins/${a.user_id}`, { method: 'PATCH', body: { role: e.target.value } }), { success: 'Role updated', invalidate: ['/admins'] })} options={[{ value: 'support', label: 'Support' }, { value: 'owner', label: 'Owner' }]} />
              </td>
              <td className="td w-48">
                <Input defaultValue={a.telegram_id ?? ''} placeholder="not linked" onBlur={(e) => {
                  const v = e.target.value.trim() ? Number(e.target.value) : null;
                  if (v !== a.telegram_id) void run('tg', () => api(`/admins/${a.user_id}`, { method: 'PATCH', body: { telegram_id: v } }), { success: 'Telegram ID saved', invalidate: ['/admins'] }).then(() => { if (a.user_id === me?.user_id) void reloadAdmin(); });
                }} />
              </td>
              <td className="td text-xs text-ink-400">{dt((a as Admin & { created_at?: string }).created_at)}</td>
              <td className="td text-end">{a.user_id !== me?.user_id && <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove ${a.email}?`)) void run('del', () => api(`/admins/${a.user_id}`, { method: 'DELETE' }), { success: 'Removed', invalidate: ['/admins'] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-ink-400">Owners listed in the Worker secret OWNER_EMAILS always get the owner role. Find your Telegram ID by sending /myid to the bot or using @userinfobot.</p>
      </Card>
      {adding && <InviteDialog onClose={() => setAdding(false)} />}
    </>
  );
}
