import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Link2, ListChecks, Unlink } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi, type Paged } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { dt } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select, Switch, Table } from '../components/ui';

interface SystemInfo {
  plan: 'free' | 'paid'; has_queue: boolean; app_env: string; base_url: string; expected_webhook: string;
  bot: { id?: number; username?: string; first_name?: string; error?: string };
  webhook: { url?: string; pending_update_count?: number; last_error_date?: number; last_error_message?: string; error?: string };
}

function AuditLog() {
  const tx = useTx();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = useApi<Paged<{ id: number; admin_email: string | null; action: string; entity: string | null; entity_id: string | null; data: unknown; created_at: string }>>(`/audit${qs({ page, action, limit: 50 })}`);
  return (
    <Card title={tx('Audit log', 'سجل العمليات')}>
      <Input dir="ltr" placeholder={tx('Filter by action prefix (order, product, settings…)', 'تصفية حسب بداية العملية (order, product, settings…)')} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="mb-3 sm:max-w-sm" />
      {q.isLoading ? <Loading /> : (
        <>
          <Table head={[tx('When', 'الوقت'), tx('Admin', 'المشرف'), tx('Action', 'العملية'), tx('Entity', 'العنصر'), tx('Data', 'البيانات')]} empty={!q.data?.items.length}>
            {(q.data?.items ?? []).map((a) => (
              <tr key={a.id}>
                <td className="td whitespace-nowrap text-xs text-ink-400">{dt(a.created_at)}</td>
                <td className="td text-xs">{a.admin_email ? <span dir="ltr">{a.admin_email}</span> : tx('system', 'النظام')}</td>
                <td className="td"><code className="text-xs" dir="ltr">{a.action}</code></td>
                <td className="td text-xs text-ink-400" dir="ltr">{a.entity} {a.entity_id}</td>
                <td className="td max-w-[320px] truncate font-mono text-[11px] text-ink-400" dir="ltr" title={JSON.stringify(a.data)}>{a.data ? JSON.stringify(a.data) : ''}</td>
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
  const tx = useTx();
  const q = useApi<SystemInfo>('/system');
  const settings = useApi<{ settings: { system: Record<string, unknown> & { plan: string; sync_enabled: boolean; public_base_url: string; broadcast_batch_free: number; broadcast_batch_paid: number } } }>('/settings');
  const { run, busy } = useAction();
  const [baseUrl, setBaseUrl] = useState<string | null>(null);

  if (q.isLoading || settings.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const info = q.data!;
  const sys = settings.data!.settings.system;
  const saveSystem = (patch: Record<string, unknown>, msg = tx('Saved', 'تم الحفظ')) => run('sys', () => api('/settings/system', { method: 'PUT', body: { ...sys, ...patch } }), { success: msg, invalidate: ['/settings', '/system'] });
  const webhookOk = info.webhook.url === info.expected_webhook;

  return (
    <>
      <PageHeader title={tx('System', 'النظام')} sub={<>{tx('Environment:', 'البيئة:')} <span dir="ltr">{info.app_env}</span></>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={tx('Telegram bot', 'بوت تيليجرام')}>
          {info.bot.error ? <ErrorBox error={tx(`Bot token problem: ${info.bot.error}`, `مشكلة في توكن البوت: ${info.bot.error}`)} /> : (
            <div className="space-y-1 text-sm">
              <div><span className="text-ink-400">{tx('Bot:', 'البوت:')}</span> <a className="text-gold" dir="ltr" href={`https://t.me/${info.bot.username}`} target="_blank" rel="noreferrer">@{info.bot.username}</a> ({info.bot.first_name})</div>
              <div className="flex flex-wrap items-center gap-2"><span className="text-ink-400">{tx('Webhook:', 'الويب هوك:')}</span> {webhookOk ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> {tx('connected', 'متصل')}</Badge> : <Badge tone="red"><AlertTriangle className="h-3 w-3" /> {tx('not set to this deployment', 'غير موجّه لهذا النشر')}</Badge>}</div>
              <div className="break-all text-xs text-ink-400" dir="ltr">{info.webhook.url || '—'}</div>
              {!!info.webhook.pending_update_count && <div className="text-xs text-gold">{tx(`${info.webhook.pending_update_count} pending updates`, `${info.webhook.pending_update_count} تحديث معلّق`)}</div>}
              {info.webhook.last_error_message && <div className="break-words text-xs text-red-300">{tx('Last error', 'آخر خطأ')} ({info.webhook.last_error_date ? dt(new Date(info.webhook.last_error_date * 1000).toISOString()) : ''}): <span dir="ltr">{info.webhook.last_error_message}</span></div>}
            </div>
          )}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="primary" loading={busy === 'wh'} onClick={() => void run('wh', () => api('/system/webhook', { method: 'POST' }), { success: tx('Webhook set', 'تم ضبط الويب هوك'), invalidate: ['/system', '/settings'] })}><Link2 className="h-4 w-4" /> {tx('Set webhook to this site', 'وجّه الويب هوك لهذا الموقع')}</Button>
            <Button loading={busy === 'cmd'} onClick={() => void run('cmd', () => api('/system/commands', { method: 'POST' }), { success: tx('Bot commands & descriptions updated', 'تم تحديث أوامر البوت ووصفه') })}><ListChecks className="h-4 w-4" /> {tx('Update bot commands', 'تحديث أوامر البوت')}</Button>
            {info.webhook.url && <Button variant="ghost" loading={busy === 'unwh'} onClick={() => { if (confirm(tx('Remove the webhook? The bot stops answering.', 'إزالة الويب هوك؟ سيتوقف البوت عن الرد.'))) void run('unwh', () => api('/system/webhook', { method: 'DELETE' }), { success: tx('Webhook removed', 'أُزيل الويب هوك'), invalidate: ['/system'] }); }}><Unlink className="h-4 w-4" /> {tx('Remove', 'إزالة')}</Button>}
          </div>
        </Card>

        <Card title={tx('Cloudflare plan', 'خطة Cloudflare')}>
          <div className="space-y-3 text-sm">
            <Field label={tx('Plan', 'الخطة')} hint={tx('Paid ($5/mo Workers plan): background jobs use a Cloudflare Queue and broadcasts send bigger batches.', 'المدفوعة (خطة Workers بـ 5$ شهرياً): المهام الخلفية تستخدم Cloudflare Queue والرسائل الجماعية تُرسل بدفعات أكبر.')}>
              <Select value={sys.plan} onChange={(e) => void saveSystem({ plan: e.target.value }, tx('Plan updated', 'تم تحديث الخطة'))} options={[{ value: 'free', label: tx('Free', 'مجانية') }, { value: 'paid', label: tx('Paid (Workers Paid)', 'مدفوعة (Workers Paid)') }]} />
            </Field>
            <div className="flex flex-wrap items-center gap-2"><span className="text-ink-400">{tx('Queue binding (JOBS):', 'ربط الطابور (JOBS):')}</span>{info.has_queue ? <Badge tone="green">{tx('found', 'موجود')}</Badge> : <Badge>{tx('not configured', 'غير مضبوط')}</Badge>}</div>
            {sys.plan === 'paid' && !info.has_queue && <div className="rounded-lg border border-gold/30 bg-gold/10 p-2 text-xs text-gold">{tx('The queue binding is missing — jobs keep running inline. Uncomment the "queues" block in wrangler.jsonc and redeploy.', 'ربط الطابور غير موجود — المهام تعمل مباشرة. فعّل قسم "queues" في wrangler.jsonc وأعد النشر.')}</div>}
            <Switch checked={sys.sync_enabled} onChange={(v) => void saveSystem({ sync_enabled: v })} label={tx('Automatic provider sync (cron)', 'مزامنة المزوّدين التلقائية (cron)')} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tx('Broadcast batch (free)', 'دفعة الإرسال (مجانية)')}><Input dir="ltr" type="number" defaultValue={sys.broadcast_batch_free} onBlur={(e) => Number(e.target.value) !== sys.broadcast_batch_free && void saveSystem({ broadcast_batch_free: Number(e.target.value) })} /></Field>
              <Field label={tx('Broadcast batch (paid)', 'دفعة الإرسال (مدفوعة)')}><Input dir="ltr" type="number" defaultValue={sys.broadcast_batch_paid} onBlur={(e) => Number(e.target.value) !== sys.broadcast_batch_paid && void saveSystem({ broadcast_batch_paid: Number(e.target.value) })} /></Field>
            </div>
          </div>
        </Card>

        <Card title={tx('Public URL', 'الرابط العام')} className="lg:col-span-2">
          <Field label={tx('Base URL', 'الرابط الأساسي')} hint={tx('Used for webhooks (Telegram, NOWPayments, Binance) and links. Set it when you move to your own domain, then press “Set webhook”.', 'يُستخدم للويب هوك (تيليجرام، NOWPayments، بينانس) والروابط. عيّنه عند الانتقال لنطاقك الخاص، ثم اضغط «وجّه الويب هوك».')}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input dir="ltr" value={baseUrl ?? sys.public_base_url ?? ''} placeholder={info.base_url} onChange={(e) => setBaseUrl(e.target.value)} />
              <Button variant="primary" disabled={baseUrl === null} onClick={() => void saveSystem({ public_base_url: (baseUrl ?? '').replace(/\/+$/, '') }).then(() => setBaseUrl(null))}>{tx('Save', 'حفظ')}</Button>
            </div>
          </Field>
          <div className="mt-2 space-y-0.5 break-all text-xs text-ink-400">
            <div>{tx('Telegram:', 'تيليجرام:')} <code dir="ltr">{info.base_url}/webhook/telegram</code></div>
            <div>NOWPayments IPN: <code dir="ltr">{info.base_url}/webhook/nowpayments</code></div>
            <div>Binance Pay: <code dir="ltr">{info.base_url}/webhook/binance-pay</code></div>
          </div>
        </Card>
      </div>
      <div className="mt-4"><AuditLog /></div>
    </>
  );
}
