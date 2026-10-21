import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Link2, ListChecks, Unlink } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { dt } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select, Switch, Table } from '../components/ui';

interface SystemInfo {
  plan: 'free' | 'paid'; has_queue: boolean; app_env: string; base_url: string; expected_webhook: string;
  bot: { id?: number; username?: string; first_name?: string; error?: string };
  webhook: { url?: string; pending_update_count?: number; last_error_date?: number; last_error_message?: string; error?: string };
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = useApi<Paged<{ id: number; admin_email: string | null; action: string; entity: string | null; entity_id: string | null; data: unknown; created_at: string }>>(`/audit${qs({ page, action, limit: 50 })}`);
  return (
    <Card title="Audit log">
      <Input placeholder="Filter by action prefix (order, product, settings…)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="mb-3 max-w-sm" />
      {q.isLoading ? <Loading /> : (
        <>
          <Table head={['When', 'Admin', 'Action', 'Entity', 'Data']} empty={!q.data?.items.length}>
            {(q.data?.items ?? []).map((a) => (
              <tr key={a.id}>
                <td className="td whitespace-nowrap text-xs text-ink-400">{dt(a.created_at)}</td>
                <td className="td text-xs">{a.admin_email ?? 'system'}</td>
                <td className="td"><code className="text-xs">{a.action}</code></td>
                <td className="td text-xs text-ink-400">{a.entity} {a.entity_id}</td>
                <td className="td max-w-[320px] truncate font-mono text-[11px] text-ink-400" title={JSON.stringify(a.data)}>{a.data ? JSON.stringify(a.data) : ''}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={q.data?.limit ?? 50} total={q.data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

export default function System() {
  const q = useApi<SystemInfo>('/system');
  const settings = useApi<{ settings: { system: Record<string, unknown> & { plan: string; sync_enabled: boolean; public_base_url: string; broadcast_batch_free: number; broadcast_batch_paid: number } } }>('/settings');
  const { run, busy } = useAction();
  const [baseUrl, setBaseUrl] = useState<string | null>(null);

  if (q.isLoading || settings.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const info = q.data!;
  const sys = settings.data!.settings.system;
  const saveSystem = (patch: Record<string, unknown>, msg = 'Saved') => run('sys', () => api('/settings/system', { method: 'PUT', body: { ...sys, ...patch } }), { success: msg, invalidate: ['/settings', '/system'] });
  const webhookOk = info.webhook.url === info.expected_webhook;

  return (
    <>
      <PageHeader title="System" sub={`Environment: ${info.app_env}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Telegram bot">
          {info.bot.error ? <ErrorBox error={`Bot token problem: ${info.bot.error}`} /> : (
            <div className="space-y-1 text-sm">
              <div><span className="text-ink-400">Bot:</span> <a className="text-gold" href={`https://t.me/${info.bot.username}`} target="_blank" rel="noreferrer">@{info.bot.username}</a> ({info.bot.first_name})</div>
              <div className="flex items-center gap-2"><span className="text-ink-400">Webhook:</span> {webhookOk ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> connected</Badge> : <Badge tone="red"><AlertTriangle className="h-3 w-3" /> not set to this deployment</Badge>}</div>
              <div className="break-all text-xs text-ink-400">{info.webhook.url || '—'}</div>
              {!!info.webhook.pending_update_count && <div className="text-xs text-gold">{info.webhook.pending_update_count} pending updates</div>}
              {info.webhook.last_error_message && <div className="text-xs text-red-300">Last error ({info.webhook.last_error_date ? new Date(info.webhook.last_error_date * 1000).toLocaleString() : ''}): {info.webhook.last_error_message}</div>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === 'wh'} onClick={() => void run('wh', () => api('/system/webhook', { method: 'POST' }), { success: 'Webhook set', invalidate: ['/system', '/settings'] })}><Link2 className="h-4 w-4" /> Set webhook to this site</Button>
            <Button loading={busy === 'cmd'} onClick={() => void run('cmd', () => api('/system/commands', { method: 'POST' }), { success: 'Bot commands & descriptions updated' })}><ListChecks className="h-4 w-4" /> Update bot commands</Button>
            {info.webhook.url && <Button variant="ghost" loading={busy === 'unwh'} onClick={() => { if (confirm('Remove the webhook? The bot stops answering.')) void run('unwh', () => api('/system/webhook', { method: 'DELETE' }), { success: 'Webhook removed', invalidate: ['/system'] }); }}><Unlink className="h-4 w-4" /> Remove</Button>}
          </div>
        </Card>

        <Card title="Cloudflare plan">
          <div className="space-y-3 text-sm">
            <Field label="Plan" hint="Paid ($5/mo Workers plan): background jobs use a Cloudflare Queue and broadcasts send bigger batches.">
              <Select value={sys.plan} onChange={(e) => void saveSystem({ plan: e.target.value }, 'Plan updated')} options={[{ value: 'free', label: 'Free' }, { value: 'paid', label: 'Paid (Workers Paid)' }]} />
            </Field>
            <div className="flex items-center gap-2"><span className="text-ink-400">Queue binding (JOBS):</span>{info.has_queue ? <Badge tone="green">found</Badge> : <Badge>not configured</Badge>}</div>
            {sys.plan === 'paid' && !info.has_queue && <div className="rounded-lg border border-gold/30 bg-gold/10 p-2 text-xs text-gold">The queue binding is missing — jobs keep running inline. Uncomment the "queues" block in wrangler.jsonc and redeploy.</div>}
            <Switch checked={sys.sync_enabled} onChange={(v) => void saveSystem({ sync_enabled: v })} label="Automatic provider sync (cron)" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Broadcast batch (free)"><Input type="number" defaultValue={sys.broadcast_batch_free} onBlur={(e) => Number(e.target.value) !== sys.broadcast_batch_free && void saveSystem({ broadcast_batch_free: Number(e.target.value) })} /></Field>
              <Field label="Broadcast batch (paid)"><Input type="number" defaultValue={sys.broadcast_batch_paid} onBlur={(e) => Number(e.target.value) !== sys.broadcast_batch_paid && void saveSystem({ broadcast_batch_paid: Number(e.target.value) })} /></Field>
            </div>
          </div>
        </Card>

        <Card title="Public URL" className="lg:col-span-2">
          <Field label="Base URL" hint="Used for webhooks (Telegram, NOWPayments, Binance) and links. Set it when you move to your own domain, then press “Set webhook”.">
            <div className="flex gap-2">
              <Input value={baseUrl ?? sys.public_base_url ?? ''} placeholder={info.base_url} onChange={(e) => setBaseUrl(e.target.value)} />
              <Button variant="primary" disabled={baseUrl === null} onClick={() => void saveSystem({ public_base_url: (baseUrl ?? '').replace(/\/+$/, '') }).then(() => setBaseUrl(null))}>Save</Button>
            </div>
          </Field>
          <div className="mt-2 space-y-0.5 text-xs text-ink-400">
            <div>Telegram: <code>{info.base_url}/webhook/telegram</code></div>
            <div>NOWPayments IPN: <code>{info.base_url}/webhook/nowpayments</code></div>
            <div>Binance Pay: <code>{info.base_url}/webhook/binance-pay</code></div>
          </div>
        </Card>
      </div>
      <div className="mt-4"><AuditLog /></div>
    </>
  );
}
