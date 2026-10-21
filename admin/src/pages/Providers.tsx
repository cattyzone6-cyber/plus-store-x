import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, PlugZap, Trash2, Pencil, ListTree } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { ago, usd } from '../lib/format';
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Input, Loading, NumberInput, PageHeader, Select, Switch, Textarea, useToast } from '../components/ui';

interface Kind { kind: string; label: string; defaultBaseUrl: string; credentialFields: { key: string; label: string; secret: boolean }[] }
interface Provider {
  id: string; name: string; kind: string; kind_label: string; base_url: string; enabled: boolean; config: Record<string, unknown>;
  sync_interval_minutes: number; last_sync_at: string | null; last_sync_status: string | null; last_sync_error: string | null;
  last_sync_stats: Record<string, number> | null; balance: number | null; balance_checked_at: string | null;
  low_balance_threshold: number | null; rate_limited_until: string | null; sort: number;
  credentials: { key: string; label: string; secret: boolean; set: boolean; value: string }[];
  products: { total: number; removed: number; new: number };
}

function ProviderDialog({ open, onClose, kinds, provider }: { open: boolean; onClose: () => void; kinds: Kind[]; provider: Provider | null }) {
  const { run, busy } = useAction();
  const [kind, setKind] = useState(provider?.kind ?? kinds[0]?.kind ?? '');
  const k = kinds.find((x) => x.kind === kind);
  const [name, setName] = useState(provider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? k?.defaultBaseUrl ?? '');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [interval, setInterval] = useState<number | null>(provider?.sync_interval_minutes ?? 10);
  const [threshold, setThreshold] = useState<number | null>(provider?.low_balance_threshold ?? null);
  const [config, setConfig] = useState(JSON.stringify(provider?.config ?? {}, null, 2));
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    let cfg: Record<string, unknown> = {};
    try { cfg = config.trim() ? JSON.parse(config) : {}; } catch { setErr('Config must be valid JSON'); return; }
    const payload = { name, kind, base_url: baseUrl, credentials: creds, enabled, sync_interval_minutes: interval ?? 10, low_balance_threshold: threshold, config: cfg };
    const ok = await run('save', () => provider ? api(`/providers/${provider.id}`, { method: 'PATCH', body: payload }) : api('/providers', { body: payload }), { success: 'Provider saved', invalidate: ['/providers', '/dashboard'] });
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={provider ? `Edit ${provider.name}` : 'Add provider'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy === 'save'} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Provider type">
          <Select value={kind} disabled={!!provider} onChange={(e) => { setKind(e.target.value); const nk = kinds.find((x) => x.kind === e.target.value); if (nk && !provider) setBaseUrl(nk.defaultBaseUrl); }}
            options={kinds.map((x) => ({ value: x.kind, label: x.label }))} />
        </Field>
        <Field label="Display name" hint="e.g. Storebat, NovasGlobal, HitMeow Store"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Base URL"><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></Field>
        {(k?.credentialFields ?? []).map((f) => {
          const cur = provider?.credentials.find((c) => c.key === f.key);
          return (
            <Field key={f.key} label={f.label} hint={cur?.set ? `Current: ${cur.value} — leave empty to keep` : undefined}>
              <Input type={f.secret ? 'password' : 'text'} autoComplete="off" value={creds[f.key] ?? ''} onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })} />
            </Field>
          );
        })}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sync every (minutes)"><NumberInput value={interval} onChange={setInterval} min={1} /></Field>
          <Field label="Low balance alert ($)"><NumberInput value={threshold} onChange={setThreshold} allowNull /></Field>
        </div>
        <Field label="Advanced config (JSON)" hint='Adapter options, e.g. {"usd_rate": 25000}'><Textarea value={config} onChange={(e) => setConfig(e.target.value)} className="font-mono text-xs" /></Field>
        <Switch checked={enabled} onChange={setEnabled} label="Enabled" />
        <ErrorBox error={err} />
      </div>
    </Dialog>
  );
}

export default function Providers() {
  const list = useApi<{ providers: Provider[] }>('/providers');
  const kinds = useApi<{ kinds: Kind[] }>('/providers/kinds');
  const { run, busy } = useAction();
  const toast = useToast();
  const [edit, setEdit] = useState<Provider | null | 'new'>(null);

  if (list.isLoading || kinds.isLoading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} />;
  const providers = list.data?.providers ?? [];

  return (
    <>
      <PageHeader title="Providers" sub="Supplier APIs the store buys from. Tokens are stored encrypted."
        actions={<Button variant="primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Add provider</Button>} />
      {providers.length === 0 && <Card><Empty>No providers yet. Add Storebat (VenteBot), NovasGlobal or HitMeow (Canboso).</Empty></Card>}
      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((p) => {
          const low = p.balance != null && p.low_balance_threshold != null && Number(p.balance) < Number(p.low_balance_threshold);
          return (
            <Card key={p.id} title={<span className="flex items-center gap-2">{p.name} <Badge>{p.kind_label}</Badge> {!p.enabled && <Badge tone="red">disabled</Badge>}</span>}
              actions={<>
                <Button size="sm" variant="ghost" onClick={() => setEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete ${p.name}? Its products are unlinked from the store.`)) void run('del', () => api(`/providers/${p.id}`, { method: 'DELETE' }), { success: 'Deleted', invalidate: ['/providers'] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </>}>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="label">Balance</div><div className={`text-lg font-semibold ${low ? 'text-red-400' : 'text-gold'}`}>{usd(p.balance)}</div><div className="text-xs text-ink-400">{ago(p.balance_checked_at)}</div></div>
                <div><div className="label">Products</div><div className="text-lg font-semibold">{p.products.total}</div><div className="text-xs text-ink-400">{p.products.new} new · {p.products.removed} removed</div></div>
                <div><div className="label">Last sync</div>
                  <div>{p.last_sync_status === 'error' ? <Badge tone="red">error</Badge> : p.last_sync_status ? <Badge tone="green">{p.last_sync_status}</Badge> : <Badge>never</Badge>}</div>
                  <div className="text-xs text-ink-400">{ago(p.last_sync_at)} · every {p.sync_interval_minutes}m</div>
                </div>
              </div>
              {p.last_sync_error && <div className="mt-2 truncate text-xs text-red-300" title={p.last_sync_error}>{p.last_sync_error}</div>}
              {p.rate_limited_until && new Date(p.rate_limited_until) > new Date() && <div className="mt-2 text-xs text-gold">Rate limited until {new Date(p.rate_limited_until).toLocaleTimeString()}</div>}
              {p.last_sync_stats && <div className="mt-2 flex flex-wrap gap-1">{Object.entries(p.last_sync_stats).filter(([, v]) => typeof v === 'number').map(([k, v]) => <Badge key={k}>{k}: {v}</Badge>)}</div>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" loading={busy === `test${p.id}`} onClick={async () => {
                  const r = await run(`test${p.id}`, () => api<{ balance: { balance_usd: number } }>(`/providers/${p.id}/test`, { method: 'POST' }), { invalidate: ['/providers', '/dashboard'] });
                  if (r) toast(`Connected — balance ${usd(r.balance.balance_usd)}`);
                }}><PlugZap className="h-3.5 w-3.5" /> Test</Button>
                <Button size="sm" loading={busy === `sync${p.id}`} onClick={() => run(`sync${p.id}`, () => api(`/providers/${p.id}/sync`, { method: 'POST' }), { success: 'Catalog synced', invalidate: ['/providers', '/dashboard'] })}><RefreshCw className="h-3.5 w-3.5" /> Sync now</Button>
                <Link to={`/providers/${p.id}`}><Button size="sm" variant="primary"><ListTree className="h-3.5 w-3.5" /> Catalog {p.products.new > 0 && <Badge tone="gray" className="bg-black/20 text-black">{p.products.new} new</Badge>}</Button></Link>
              </div>
            </Card>
          );
        })}
      </div>
      {edit && <ProviderDialog open onClose={() => setEdit(null)} kinds={kinds.data?.kinds ?? []} provider={edit === 'new' ? null : edit} />}
    </>
  );
}
