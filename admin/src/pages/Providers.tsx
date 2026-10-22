import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, PlugZap, Trash2, Pencil, ListTree } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { useTx } from '../lib/i18n';
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
  import_category_id: string | null; import_markup_percent: number | null; import_markup_fixed: number | null;
  import_min_margin_percent: number | null; max_jump_percent: number | null;
  import_description_en: string | null; import_description_ar: string | null;
}

function ProviderDialog({ open, onClose, kinds, provider }: { open: boolean; onClose: () => void; kinds: Kind[]; provider: Provider | null }) {
  const tx = useTx();
  const { run, busy } = useAction();
  const cats = useApi<{ categories: { id: string; name_en: string }[] }>('/categories');
  const [kind, setKind] = useState(provider?.kind ?? kinds[0]?.kind ?? '');
  const k = kinds.find((x) => x.kind === kind);
  const [name, setName] = useState(provider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? k?.defaultBaseUrl ?? '');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [interval, setInterval] = useState<number | null>(provider?.sync_interval_minutes ?? 10);
  const [threshold, setThreshold] = useState<number | null>(provider?.low_balance_threshold ?? null);
  const [config, setConfig] = useState(JSON.stringify(provider?.config ?? {}, null, 2));
  // import defaults (empty = store-wide setting from Settings → Pricing)
  const [defCat, setDefCat] = useState(provider?.import_category_id ?? '');
  const [markupPct, setMarkupPct] = useState<number | null>(provider?.import_markup_percent ?? null);
  const [markupFixed, setMarkupFixed] = useState<number | null>(provider?.import_markup_fixed ?? null);
  const [minMargin, setMinMargin] = useState<number | null>(provider?.import_min_margin_percent ?? null);
  const [maxJump, setMaxJump] = useState<number | null>(provider?.max_jump_percent ?? null);
  const [descEn, setDescEn] = useState(provider?.import_description_en ?? '');
  const [descAr, setDescAr] = useState(provider?.import_description_ar ?? '');
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    let cfg: Record<string, unknown> = {};
    try { cfg = config.trim() ? JSON.parse(config) : {}; } catch { setErr(tx('Advanced config must be valid JSON', 'الإعدادات المتقدمة يجب أن تكون JSON صحيحاً')); return; }
    const payload = {
      name, kind, base_url: baseUrl, credentials: creds, enabled, sync_interval_minutes: interval ?? 10, low_balance_threshold: threshold, config: cfg,
      import_category_id: defCat || null, import_markup_percent: markupPct, import_markup_fixed: markupFixed,
      import_min_margin_percent: minMargin, max_jump_percent: maxJump,
      import_description_en: descEn.trim() || null, import_description_ar: descAr.trim() || null,
    };
    const ok = await run('save', () => provider ? api(`/providers/${provider.id}`, { method: 'PATCH', body: payload }) : api('/providers', { body: payload }), { success: tx('Provider saved', 'تم حفظ المزوّد'), invalidate: ['/providers', '/dashboard'] });
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} wide title={provider ? tx(`Edit ${provider.name}`, `تعديل ${provider.name}`) : tx('Add provider', 'إضافة مزوّد')}
      footer={<><Button onClick={onClose}>{tx('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy === 'save'} onClick={save}>{tx('Save', 'حفظ')}</Button></>}>
      <div className="space-y-5">
        <section className="space-y-3">
          <Field label={tx('Provider type', 'نوع المزوّد')}>
            <Select value={kind} disabled={!!provider} onChange={(e) => { setKind(e.target.value); const nk = kinds.find((x) => x.kind === e.target.value); if (nk && !provider) setBaseUrl(nk.defaultBaseUrl); }}
              options={kinds.map((x) => ({ value: x.kind, label: x.label }))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx('Display name', 'الاسم الظاهر')} hint={tx('e.g. Storebat, NovasGlobal', 'مثلاً Storebat أو NovasGlobal')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={tx('Base URL', 'رابط الـ API')}><Input dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></Field>
          </div>
          {(k?.credentialFields ?? []).map((f) => {
            const cur = provider?.credentials.find((c) => c.key === f.key);
            return (
              <Field key={f.key} label={f.label} hint={cur?.set ? tx(`Current: ${cur.value} — leave empty to keep`, `الحالي: ${cur.value} — اتركه فارغاً للإبقاء عليه`) : undefined}>
                <Input dir="ltr" type={f.secret ? 'password' : 'text'} autoComplete="off" value={creds[f.key] ?? ''} onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })} />
              </Field>
            );
          })}
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx('Sync every (minutes)', 'المزامنة كل (دقيقة)')}><NumberInput value={interval} onChange={setInterval} min={1} /></Field>
            <Field label={tx('Low balance alert ($)', 'تنبيه انخفاض الرصيد ($)')}><NumberInput value={threshold} onChange={setThreshold} allowNull /></Field>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label={tx('Enabled', 'مفعّل')} />
        </section>

        <section className="space-y-3 rounded-lg border border-ink-700 p-3">
          <div>
            <h4 className="font-medium">{tx('Import defaults', 'إعدادات الاستيراد الافتراضية')}</h4>
            <p className="text-xs text-ink-400">{tx('Used for packs imported from this provider. Leave a field empty to use the store setting (Settings → Pricing).',
              'تُطبّق على الباقات المستوردة من هذا المزوّد. اترك الحقل فارغاً لاستخدام إعداد المتجر (الإعدادات ← التسعير).')}</p>
          </div>
          <Field label={tx('Default category for new products', 'القسم الافتراضي للمنتجات الجديدة')}>
            <Select value={defCat} onChange={(e) => setDefCat(e.target.value)} options={[{ value: '', label: tx('— none —', '— بدون —') }, ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name_en }))]} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={tx('Markup %', 'نسبة الربح %')}><NumberInput value={markupPct} onChange={setMarkupPct} allowNull min={0} /></Field>
            <Field label={tx('Markup fixed ($)', 'ربح ثابت ($)')}><NumberInput value={markupFixed} onChange={setMarkupFixed} allowNull min={0} /></Field>
            <Field label={tx('Minimum margin %', 'أقل هامش ربح %')}><NumberInput value={minMargin} onChange={setMinMargin} allowNull min={0} /></Field>
            <Field label={tx('Pause if cost jumps over %', 'إيقاف إذا ارتفعت التكلفة أكثر من %')}><NumberInput value={maxJump} onChange={setMaxJump} allowNull min={0} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx('Product description template (EN)', 'قالب وصف المنتج (إنجليزي)')} hint={tx('{name} is replaced by the product name', '{name} يُستبدل باسم المنتج')}>
              <Textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} placeholder="{name} — instant delivery, full warranty." />
            </Field>
            <Field label={tx('Product description template (AR)', 'قالب وصف المنتج (عربي)')}>
              <Textarea dir="rtl" value={descAr} onChange={(e) => setDescAr(e.target.value)} placeholder="{name} — تسليم فوري مع ضمان كامل." />
            </Field>
          </div>
        </section>

        <Field label={tx('Advanced config (JSON)', 'إعدادات متقدمة (JSON)')} hint='e.g. {"usd_rate": 25000}'><Textarea dir="ltr" value={config} onChange={(e) => setConfig(e.target.value)} className="font-mono text-xs" /></Field>
        <ErrorBox error={err} />
      </div>
    </Dialog>
  );
}

export default function Providers() {
  const tx = useTx();
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
      <PageHeader title={tx('Providers', 'المزوّدون')} sub={tx('Supplier APIs the store buys from. Tokens are stored encrypted.', 'واجهات المزوّدين التي يشتري منها المتجر. تُحفظ التوكنات مشفّرة.')}
        actions={<Button variant="primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {tx('Add provider', 'إضافة مزوّد')}</Button>} />
      {providers.length === 0 && <Card><Empty>{tx('No providers yet.', 'لا يوجد مزوّدون بعد.')}</Empty></Card>}
      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((p) => {
          const low = p.balance != null && p.low_balance_threshold != null && Number(p.balance) < Number(p.low_balance_threshold);
          return (
            <Card key={p.id} title={<span className="flex flex-wrap items-center gap-2">{p.name} <Badge>{p.kind_label}</Badge> {!p.enabled && <Badge tone="red">{tx('disabled', 'معطّل')}</Badge>}</span>}
              actions={<>
                <Button size="sm" variant="ghost" onClick={() => setEdit(p)} aria-label={tx('Edit', 'تعديل')}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" aria-label={tx('Delete', 'حذف')} onClick={() => { if (confirm(tx(`Delete ${p.name}? Its products are unlinked from the store.`, `حذف ${p.name}؟ ستُفصل منتجاته عن المتجر.`))) void run('del', () => api(`/providers/${p.id}`, { method: 'DELETE' }), { success: tx('Deleted', 'تم الحذف'), invalidate: ['/providers'] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </>}>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="label">{tx('Balance', 'الرصيد')}</div><div className={`text-lg font-semibold ${low ? 'text-red-400' : 'text-gold'}`}>{usd(p.balance)}</div><div className="text-xs text-ink-400">{ago(p.balance_checked_at)}</div></div>
                <div><div className="label">{tx('Products', 'المنتجات')}</div><div className="text-lg font-semibold">{p.products.total}</div><div className="text-xs text-ink-400">{tx(`${p.products.new} new · ${p.products.removed} removed`, `${p.products.new} جديد · ${p.products.removed} محذوف`)}</div></div>
                <div><div className="label">{tx('Last sync', 'آخر مزامنة')}</div>
                  <div>{p.last_sync_status === 'error' ? <Badge tone="red">{tx('error', 'خطأ')}</Badge> : p.last_sync_status ? <Badge tone="green">{p.last_sync_status}</Badge> : <Badge>{tx('never', 'لم تتم')}</Badge>}</div>
                  <div className="text-xs text-ink-400">{ago(p.last_sync_at)} · {tx(`every ${p.sync_interval_minutes}m`, `كل ${p.sync_interval_minutes} د`)}</div>
                </div>
              </div>
              {p.last_sync_error && <div className="mt-2 truncate text-xs text-red-300" title={p.last_sync_error}>{p.last_sync_error}</div>}
              {p.rate_limited_until && new Date(p.rate_limited_until) > new Date() && <div className="mt-2 text-xs text-gold">{tx('Rate limited until', 'محظور مؤقتاً حتى')} {new Date(p.rate_limited_until).toLocaleTimeString()}</div>}
              {p.last_sync_stats && <div className="mt-2 flex flex-wrap gap-1">{Object.entries(p.last_sync_stats).filter(([, v]) => typeof v === 'number').map(([k, v]) => <Badge key={k}>{k}: {v}</Badge>)}</div>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" loading={busy === `test${p.id}`} onClick={async () => {
                  const r = await run(`test${p.id}`, () => api<{ balance: { balance_usd: number } }>(`/providers/${p.id}/test`, { method: 'POST' }), { invalidate: ['/providers', '/dashboard'] });
                  if (r) toast(tx(`Connected — balance ${usd(r.balance.balance_usd)}`, `متصل — الرصيد ${usd(r.balance.balance_usd)}`));
                }}><PlugZap className="h-3.5 w-3.5" /> {tx('Test', 'اختبار')}</Button>
                <Button size="sm" loading={busy === `sync${p.id}`} onClick={() => run(`sync${p.id}`, () => api(`/providers/${p.id}/sync`, { method: 'POST' }), { success: tx('Catalog synced', 'تمت مزامنة الكتالوج'), invalidate: ['/providers', '/dashboard'] })}><RefreshCw className="h-3.5 w-3.5" /> {tx('Sync now', 'مزامنة الآن')}</Button>
                <Link to={`/providers/${p.id}`}><Button size="sm" variant="primary"><ListTree className="h-3.5 w-3.5" /> {tx('Choose packs', 'اختيار الباقات')} {p.products.new > 0 && <Badge tone="gray" className="bg-black/20 text-black">{tx(`${p.products.new} new`, `${p.products.new} جديد`)}</Badge>}</Button></Link>
              </div>
            </Card>
          );
        })}
      </div>
      {edit && <ProviderDialog open onClose={() => setEdit(null)} kinds={kinds.data?.kinds ?? []} provider={edit === 'new' ? null : edit} />}
    </>
  );
}
