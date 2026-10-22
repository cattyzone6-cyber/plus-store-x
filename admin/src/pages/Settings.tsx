import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { Badge, Button, Card, ErrorBox, Field, ImageInput, Input, Loading, NumberInput, PageHeader, Select, Spinner, StyleDot, StyleSelect, Switch, Table, Tabs, Textarea } from '../components/ui';

type Obj = Record<string, unknown>;
type Settings = Record<string, Obj>;
type Tx = (en: string, ar: string) => string;

function getPath(o: Obj, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Obj)[k] : undefined), o);
}
function setPath(o: Obj, path: string, v: unknown): Obj {
  const [head, ...rest] = path.split('.');
  if (!rest.length) return { ...o, [head]: v };
  return { ...o, [head]: setPath((o[head] as Obj) ?? {}, rest.join('.'), v) };
}

type FT = 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'image' | 'numbers' | 'style' | 'color';
interface FD { path: string; label: string; type?: FT; hint?: string; options?: { value: string; label: string }[]; rtl?: boolean; full?: boolean }

function FieldInput({ fd, value, onChange }: { fd: FD; value: unknown; onChange: (v: unknown) => void }) {
  const tx = useTx();
  switch (fd.type ?? 'text') {
    case 'textarea': return <Textarea dir={fd.rtl ? 'rtl' : undefined} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number': return <NumberInput value={(value as number) ?? 0} onChange={(v) => onChange(v ?? 0)} />;
    case 'switch': return <Switch checked={!!value} onChange={onChange} />;
    case 'select': return <Select value={String(value ?? '')} onChange={(e) => onChange(typeof value === 'number' ? Number(e.target.value) : e.target.value)} options={fd.options ?? []} />;
    case 'image': return <ImageInput value={(value as string) || null} onChange={(v) => onChange(v ?? '')} placeholder={tx('https://… or upload', 'https://… أو ارفع صورة')} />;
    case 'style': return <StyleSelect value={(value as string) ?? 'default'} onChange={(v) => onChange(v ?? 'default')} />;
    case 'color': return <div className="flex gap-2"><input type="color" value={(value as string) || '#F5B301'} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 rounded border border-ink-700 bg-transparent" /><Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} /></div>;
    case 'numbers': return <Input value={((value as number[]) ?? []).join(', ')} onChange={(e) => onChange(e.target.value.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0))} />;
    default: return <Input dir={fd.rtl ? 'rtl' : undefined} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** One settings section with its own save button. */
function Section({ title, section, settings, fields, children, extra }: {
  title: ReactNode; section: string; settings: Settings; fields: FD[]; children?: (v: Obj, set: (v: Obj) => void) => ReactNode; extra?: ReactNode;
}) {
  const tx = useTx();
  const [v, setV] = useState<Obj>(settings[section] ?? {});
  useEffect(() => setV(settings[section] ?? {}), [settings, section]);
  const { run, busy } = useAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(settings[section] ?? {});
  return (
    <Card title={title} actions={<Button size="sm" variant="primary" disabled={!dirty} loading={busy === 'save'} onClick={() => void run('save', () => api(`/settings/${section}`, { method: 'PUT', body: v }), { success: tx('Saved', 'تم الحفظ'), invalidate: ['/settings', '/dashboard'] })}><Save className="h-3.5 w-3.5" /> {tx('Save', 'حفظ')}</Button>}>
      {extra}
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((fd) => (
          fd.type === 'switch'
            ? <div key={fd.path} className={fd.full ? 'md:col-span-2' : ''}><Switch checked={!!getPath(v, fd.path)} onChange={(x) => setV(setPath(v, fd.path, x))} label={fd.label} />{fd.hint && <p className="ms-11 text-xs text-ink-400">{fd.hint}</p>}</div>
            : <Field key={fd.path} label={fd.label} hint={fd.hint} className={fd.full || fd.type === 'textarea' ? 'md:col-span-2' : ''}><FieldInput fd={fd} value={getPath(v, fd.path)} onChange={(x) => setV(setPath(v, fd.path, x))} /></Field>
        ))}
      </div>
      {children && <div className="mt-4">{children(v, setV)}</div>}
    </Card>
  );
}

/** Editable list of objects. */
function ListEditor<T extends Obj>({ items, onChange, fields, empty, newItem, title }: { items: T[]; onChange: (v: T[]) => void; fields: FD[]; empty: T; newItem?: string; title?: string }) {
  const tx = useTx();
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const n = [...items];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  return (
    <div>
      {title && <div className="label">{title}</div>}
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border border-ink-700 p-3">
            <div className="grid gap-2 md:grid-cols-2">
              {fields.map((fd) => (
                <Field key={fd.path} label={fd.label} className={fd.full ? 'md:col-span-2' : ''}>
                  <FieldInput fd={fd} value={getPath(it, fd.path)} onChange={(x) => onChange(items.map((y, j) => (j === i ? (setPath(y, fd.path, x) as T) : y)))} />
                </Field>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)} aria-label={tx('Move up', 'تحريك لأعلى')}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)} aria-label={tx('Move down', 'تحريك لأسفل')}><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={tx('Remove', 'إزالة')}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        ))}
      </div>
      <Button size="sm" className="mt-2" onClick={() => onChange([...items, { ...empty }])}><Plus className="h-3.5 w-3.5" /> {newItem ?? tx('Add', 'إضافة')}</Button>
    </div>
  );
}

const MENU_IDS = ['shop', 'freebies', 'deposit', 'profile', 'orders', 'support', 'referrals', 'giveaways', 'redeem', 'language', 'website', 'channel'];

function menuLabel(id: string, tx: Tx): string {
  const names: Record<string, [string, string]> = {
    shop: ['Shop', 'المتجر'], freebies: ['Freebies', 'المجانيات'], deposit: ['Deposit', 'الإيداع'], profile: ['Profile', 'الملف الشخصي'],
    orders: ['Orders', 'الطلبات'], support: ['Support', 'الدعم'], referrals: ['Referrals', 'الإحالات'], giveaways: ['Giveaways', 'السحوبات'],
    redeem: ['Redeem', 'استبدال كود'], language: ['Language', 'اللغة'], website: ['Website', 'الموقع'], channel: ['Channel', 'القناة'],
  };
  const n = names[id];
  return n ? tx(n[0], n[1]) : id;
}

function MenuEditor({ menu, onChange }: { menu: { id: string; enabled: boolean; style: string; row: number }[]; onChange: (v: typeof menu) => void }) {
  const tx = useTx();
  const missing = MENU_IDS.filter((id) => !menu.some((m) => m.id === id));
  const rows = [...new Set(menu.map((m) => m.row))].sort((a, b) => a - b);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        <div className="label">{tx('Main menu buttons', 'أزرار القائمة الرئيسية')}</div>
        <Table head={[tx('Button', 'الزر'), tx('Row', 'الصف'), tx('Color', 'اللون'), tx('On', 'مفعّل'), '']}>
          {menu.map((m, i) => (
            <tr key={m.id}>
              <td className="td">{menuLabel(m.id, tx)}</td>
              <td className="td w-20"><NumberInput value={m.row} onChange={(v) => onChange(menu.map((x, j) => (j === i ? { ...x, row: v ?? 1 } : x)))} className="!py-1" /></td>
              <td className="td w-40"><StyleSelect value={m.style} onChange={(v) => onChange(menu.map((x, j) => (j === i ? { ...x, style: v ?? 'default' } : x)))} /></td>
              <td className="td"><Switch checked={m.enabled} onChange={(v) => onChange(menu.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} /></td>
              <td className="td"><Button size="sm" variant="ghost" onClick={() => onChange(menu.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button></td>
            </tr>
          ))}
        </Table>
        {missing.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">{missing.map((id) => <Button key={id} size="sm" onClick={() => onChange([...menu, { id, enabled: true, style: 'default', row: (rows[rows.length - 1] ?? 0) + 1 }])}><Plus className="h-3 w-3" />{menuLabel(id, tx)}</Button>)}</div>
        )}
      </div>
      <div>
        <div className="label">{tx('Preview', 'معاينة')}</div>
        <div className="space-y-1.5 rounded-xl bg-[#17212b] p-3">
          {rows.map((r) => (
            <div key={r} className="flex gap-1.5">
              {menu.filter((m) => m.row === r && m.enabled).map((m) => (
                <div key={m.id} className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm text-white ${m.style === 'primary' ? 'bg-[#3e78b2]' : m.style === 'success' ? 'bg-[#4f8a3c]' : m.style === 'danger' ? 'bg-[#a3413c]' : 'bg-[#2b3a48]'}`}>
                  <StyleDot style={m.style} /> <span className="truncate">{menuLabel(m.id, tx)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Secrets({ keys }: { keys: string[] }) {
  const tx = useTx();
  const q = useApi<{ items: { key: string; set: boolean; masked: string }[] }>('/secrets');
  const [vals, setVals] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const items = (q.data?.items ?? []).filter((i) => keys.includes(i.key));
  return (
    <div className="space-y-2">
      {items.map((s) => (
        <div key={s.key} className="flex flex-wrap items-end gap-2">
          <Field label={s.key.replace(/_/g, ' ')} className="min-w-0 flex-1 basis-60" hint={s.set ? `${tx('Saved', 'محفوظ')}: ${s.masked}` : tx('Not set', 'غير مضبوط')}>
            <Input type="password" autoComplete="off" value={vals[s.key] ?? ''} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} placeholder={s.set ? tx('•••••• (leave empty to keep)', '•••••• (اتركه فارغاً للإبقاء)') : ''} />
          </Field>
          <Button size="sm" variant="primary" disabled={!vals[s.key]} loading={busy === s.key} onClick={() => void run(s.key, () => api('/secrets', { method: 'PUT', body: { key: s.key, value: vals[s.key] } }), { success: tx('Secret saved', 'تم حفظ المفتاح'), invalidate: ['/secrets'] }).then(() => setVals({ ...vals, [s.key]: '' }))}>{tx('Save', 'حفظ')}</Button>
          {s.set && <Button size="sm" variant="ghost" onClick={() => { if (confirm(tx('Remove this secret?', 'إزالة هذا المفتاح؟'))) void run(`${s.key}-del`, () => api('/secrets', { method: 'PUT', body: { key: s.key, value: null } }), { success: tx('Removed', 'تمت الإزالة'), invalidate: ['/secrets'] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
        </div>
      ))}
    </div>
  );
}

/** "Test keys" for one gateway: a read-only call with the saved keys, result shown inline. */
function KeyTest({ method, label }: { method: 'binance_pay' | 'binance_id' | 'nowpayments'; label: string }) {
  const tx = useTx();
  const { run, busy } = useAction();
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const test = async () => {
    const r = await run(method, () => api<{ result: { ok: boolean; message: string } }>(`/payments/test/${method}`, { method: 'POST' }));
    if (r) setRes(r.result);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Button size="sm" loading={busy === method} onClick={test}>{tx('Test', 'اختبار')} {label}</Button>
      {res && <span className={res.ok ? 'text-emerald-400' : 'text-red-400'}>{res.ok ? '✓' : '✗'} {res.message}</span>}
    </div>
  );
}

function TextsEditor() {
  const tx = useTx();
  const q = useApi<{ items: { key: string; default_en: string; default_ar: string; en: string; ar: string }[] }>('/texts');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, { en?: string; ar?: string }>>({});
  const { run, busy } = useAction();
  const items = useMemo(() => (q.data?.items ?? []).filter((i) => !search || i.key.includes(search) || i.default_en.toLowerCase().includes(search.toLowerCase()) || i.default_ar.includes(search)), [q.data, search]);
  if (q.isLoading) return <Loading />;
  return (
    <Card title={tx('Bot texts', 'نصوص البوت')} actions={<Button size="sm" variant="primary" disabled={!Object.keys(edits).length} loading={busy === 'save'} onClick={() => void run('save', () => api('/texts', { method: 'PUT', body: { texts: edits } }), { success: tx('Texts saved', 'تم حفظ النصوص'), invalidate: ['/texts', '/settings'] }).then(() => setEdits({}))}><Save className="h-3.5 w-3.5" /> {tx('Save', 'حفظ')} {Object.keys(edits).length || ''}</Button>}>
      <p className="mb-3 text-xs text-ink-400">
        {tx('Leave a field empty to use the built-in text (shown as placeholder). Telegram HTML is allowed.', 'اترك الحقل فارغاً لاستخدام النص المدمج (يظهر كنص تلميح). يُسمح بتنسيق HTML في تيليجرام.')}{' '}
        <code>{'{name}'}</code> {tx('are variables,', 'متغيرات،')} <code>{'{e:shop}'}</code> {tx('are emoji from the library.', 'إيموجي من المكتبة.')}
      </p>
      <Input placeholder={tx('Search keys or text…', 'ابحث في المفاتيح أو النص…')} value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 max-w-sm" />
      <div className="space-y-3">
        {items.slice(0, 80).map((i) => {
          const cur = { en: edits[i.key]?.en ?? i.en, ar: edits[i.key]?.ar ?? i.ar };
          return (
            <div key={i.key} className="rounded-lg border border-ink-700 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2"><code className="break-all text-xs text-gold">{i.key}</code>{(i.en || i.ar) && <Badge tone="gold">{tx('customised', 'معدّل')}</Badge>}</div>
              <div className="grid gap-2 md:grid-cols-2">
                <Textarea rows={3} placeholder={i.default_en} value={cur.en} onChange={(e) => setEdits({ ...edits, [i.key]: { ...cur, en: e.target.value } })} className="text-xs" />
                <Textarea rows={3} dir="rtl" placeholder={i.default_ar || i.default_en} value={cur.ar} onChange={(e) => setEdits({ ...edits, [i.key]: { ...cur, ar: e.target.value } })} className="text-xs" />
              </div>
            </div>
          );
        })}
        {items.length > 80 && <p className="text-xs text-ink-400">{tx(`Showing 80 of ${items.length} — refine the search.`, `يظهر 80 من ${items.length} — ضيّق البحث.`)}</p>}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog: word list used to read provider names, with a live preview
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewItem { name: string; product: string; key: string; durationDays: number | null; warranty: 'full' | 'none' | number | null }

function CatalogWords({ settings }: { settings: Settings }) {
  const tx = useTx();
  const saved = ((settings.catalog?.name_words ?? {}) as Record<string, string>);
  const toRows = (w: Record<string, string>) => Object.entries(w).map(([word, spelling]) => ({ word, spelling }));
  const [rows, setRows] = useState(() => toRows(saved));
  useEffect(() => setRows(toRows(saved)), [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of rows) if (r.word.trim() && r.spelling.trim()) out[r.word.trim().toLowerCase()] = r.spelling.trim();
    return out;
  }, [rows]);
  const dirty = JSON.stringify(words) !== JSON.stringify(saved);
  const { run, busy } = useAction();

  // sample names: the store's own provider catalog until the owner types other ones
  const samples = useApi<{ items: { name: string }[] }>('/provider-products');
  const [text, setText] = useState<string | null>(null);
  const sampleText = text ?? (samples.data?.items ?? []).slice(0, 20).map((i) => i.name).join('\n');
  const names = sampleText.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 300);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify([names, words]);
  useEffect(() => {
    if (!names.length) return setPreview([]);
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ items: PreviewItem[] }>('/names/preview', { body: { names, words } })
        .then((r) => live && setPreview(r.items))
        .catch(() => live && setPreview(null))
        .finally(() => live && setLoading(false));
    }, 350);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const warranty = (w: PreviewItem['warranty']) => (w === 'full' ? tx('full', 'كامل') : w === 'none' ? tx('none', 'بدون') : w == null ? '—' : tx(`${w} days`, `${w} يوم`));
  const groups = new Map<string, number>();
  for (const p of preview ?? []) groups.set(p.key, (groups.get(p.key) ?? 0) + 1);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={tx('Name words', 'كلمات الأسماء')} actions={
        <Button size="sm" variant="primary" disabled={!dirty} loading={busy === 'save'}
          onClick={() => void run('save', () => api('/settings/catalog', { method: 'PUT', body: { name_words: words } }), { success: tx('Saved', 'تم الحفظ'), invalidate: ['/settings'] })}>
          <Save className="h-3.5 w-3.5" /> {tx('Save', 'حفظ')}
        </Button>}>
        <p className="mb-3 text-xs text-ink-400">
          {tx('How words are written when packs are grouped into products (Catalog → Auto-group). Common brands (ChatGPT, CapCut, YouTube…) are built in — add the ones that come out wrong. Pack names are never changed.',
            'طريقة كتابة الكلمات عند تجميع الباقات في منتجات (الكتالوج ← تجميع تلقائي). العلامات الشائعة (ChatGPT، CapCut، YouTube…) مدمجة — أضف ما يظهر بشكل خاطئ. أسماء الباقات لا تتغير أبداً.')}
        </p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input value={r.word} placeholder={tx('word, e.g. gemini', 'الكلمة، مثل gemini')} aria-label={tx('Word', 'الكلمة')}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, word: e.target.value.toLowerCase() } : x)))} />
              <Input value={r.spelling} placeholder={tx('written as, e.g. Gemini', 'تُكتب، مثل Gemini')} aria-label={tx('Written as', 'تُكتب')}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, spelling: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={tx('Remove', 'إزالة')}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          {!rows.length && <p className="text-sm text-ink-400">{tx('No words yet — the built-in list is used.', 'لا توجد كلمات بعد — تُستخدم القائمة المدمجة.')}</p>}
        </div>
        <Button size="sm" className="mt-3" onClick={() => setRows([...rows, { word: '', spelling: '' }])}><Plus className="h-3.5 w-3.5" /> {tx('Add word', 'إضافة كلمة')}</Button>
      </Card>

      <Card title={<span className="flex items-center gap-2">{tx('Live preview', 'معاينة مباشرة')} {loading && <Spinner className="h-4 w-4" />}</span>}>
        <Field label={tx('Provider names (one per line)', 'أسماء المزود (اسم في كل سطر)')} hint={tx('Filled with names from your providers; type your own to test.', 'مملوءة بأسماء من مزوديك؛ اكتب أسماءك للتجربة.')}>
          <Textarea rows={6} value={sampleText} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
        </Field>
        {preview && preview.length > 0 && (
          <>
            <div className="mt-3 text-xs text-ink-400">{tx(`${preview.length} names → ${groups.size} products`, `${preview.length} اسم ← ${groups.size} منتج`)}</div>
            <div className="mt-2 divide-y divide-ink-700/70 rounded-lg border border-ink-700">
              {preview.map((p, i) => (
                <div key={i} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 flex-1 break-words text-ink-400">{p.name}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge tone="gold">{p.product}</Badge>
                    {p.durationDays != null && <Badge>{tx(`${p.durationDays} days`, `${p.durationDays} يوم`)}</Badge>}
                    {p.warranty != null && <Badge tone="blue">{tx('warranty', 'ضمان')}: {warranty(p.warranty)}</Badge>}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const tx = useTx();
  const { section = 'brand' } = useParams();
  const nav = useNavigate();
  const q = useApi<{ settings: Settings; has_queue: boolean }>('/settings');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data!.settings;
  const yesNo = (label: string, path: string, hint?: string): FD => ({ path, label, type: 'switch', hint });
  const refundOrManual = [{ value: 'refund', label: tx('Refund to wallet', 'استرداد إلى المحفظة') }, { value: 'manual', label: tx('Manual queue', 'الطلبات اليدوية') }];

  const tabs = [
    { value: 'brand', label: tx('Brand', 'العلامة') }, { value: 'bot', label: tx('Bot & menu', 'البوت والقائمة') }, { value: 'force_join', label: tx('Force join', 'الاشتراك الإجباري') },
    { value: 'features', label: tx('Features', 'الميزات') }, { value: 'pricing', label: tx('Pricing', 'التسعير') }, { value: 'catalog', label: tx('Catalog', 'الكتالوج') },
    { value: 'payments', label: tx('Payments', 'المدفوعات') }, { value: 'rewards', label: tx('Referral & cashback', 'الإحالة والكاش باك') },
    { value: 'warranty', label: tx('Warranty & support', 'الضمان والدعم') }, { value: 'notifications', label: tx('Notifications', 'الإشعارات') },
    { value: 'landing', label: tx('Landing page', 'الصفحة الرئيسية') }, { value: 'texts', label: tx('Texts', 'النصوص') },
  ];

  return (
    <>
      <PageHeader title={tx('Settings', 'الإعدادات')} sub={tx('Everything here is per store — no code changes needed.', 'كل ما هنا خاص بالمتجر — بلا حاجة لتعديل الكود.')} />
      <Tabs value={section} onChange={(v) => nav(`/settings/${v}`)} tabs={tabs} />
      <div className="space-y-4">
        {section === 'brand' && (
          <Section title={tx('Brand', 'العلامة')} section="brand" settings={s} fields={[
            { path: 'name', label: tx('Store name', 'اسم المتجر') }, { path: 'order_prefix', label: tx('Order code prefix', 'بادئة رقم الطلب'), hint: tx('e.g. PSX → PSX-AB12CD34', 'مثلاً PSX ← PSX-AB12CD34') },
            { path: 'tagline_en', label: tx('Tagline (EN)', 'الشعار (إنجليزي)') }, { path: 'tagline_ar', label: tx('Tagline (AR)', 'الشعار (عربي)'), rtl: true },
            { path: 'logo_url', label: tx('Logo', 'الشعار (صورة)'), type: 'image', full: true },
            { path: 'bot_username', label: tx('Bot username (without @)', 'اسم مستخدم البوت (بدون @)'), hint: tx('Filled automatically when the webhook is set', 'يُملأ تلقائياً عند ضبط الويب هوك') },
            { path: 'support_username', label: tx('Support username (without @)', 'اسم مستخدم الدعم (بدون @)') },
            { path: 'channel_url', label: tx('Channel link', 'رابط القناة') }, { path: 'group_url', label: tx('Group link', 'رابط المجموعة') },
            { path: 'website_url', label: tx('Website link', 'رابط الموقع') },
          ]} />
        )}

        {section === 'bot' && (
          <Section title={tx('Bot', 'البوت')} section="bot" settings={s} fields={[
            { path: 'default_lang', label: tx('Default language', 'اللغة الافتراضية'), type: 'select', options: [{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }] },
            { path: 'category_columns', label: tx('Category buttons per row', 'أزرار الأقسام في كل صف'), type: 'select', options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }] },
            { path: 'welcome_image_url', label: tx('Welcome image', 'صورة الترحيب'), type: 'image', full: true },
            { path: 'qty_presets', label: tx('Quantity buttons', 'أزرار الكمية'), type: 'numbers', hint: tx('Comma separated', 'مفصولة بفواصل') },
            { path: 'in_stock_style', label: tx('In-stock product color', 'لون المنتج المتوفر'), type: 'style' },
            { path: 'sold_out_style', label: tx('Sold-out product color', 'لون المنتج النافد'), type: 'style' },
            { path: 'buy_style', label: tx('Buy button color', 'لون زر الشراء'), type: 'style' },
            { path: 'nav_style', label: tx('Back / Home color', 'لون رجوع / الرئيسية'), type: 'style' },
            yesNo(tx('Ask language on first /start', 'السؤال عن اللغة عند أول /start'), 'ask_lang_on_start'),
            yesNo(tx('Show sold-out products', 'إظهار المنتجات النافدة'), 'show_sold_out'),
            yesNo(tx('Custom emoji (owner has Telegram Premium)', 'إيموجي مميز (المالك لديه تيليجرام بريميوم)'), 'premium_emoji', tx('Bot API 9.4: custom emoji in messages and on buttons only work when the BotFather owner has Premium', 'Bot API 9.4: الإيموجي المميز في الرسائل والأزرار يعمل فقط إذا كان مالك البوت في BotFather مشتركاً في بريميوم')),
            yesNo(tx('Maintenance mode', 'وضع الصيانة'), 'maintenance_mode', tx('Customers see a maintenance message; admins can still use the bot', 'يرى العملاء رسالة صيانة؛ ويبقى المشرفون قادرين على استخدام البوت')),
          ]}>
            {(v, set) => <MenuEditor menu={(v.main_menu as { id: string; enabled: boolean; style: string; row: number }[]) ?? []} onChange={(m) => set({ ...v, main_menu: m })} />}
          </Section>
        )}

        {section === 'force_join' && (
          <Section title={tx('Force join', 'الاشتراك الإجباري')} section="force_join" settings={s} fields={[yesNo(tx('Require joining before using the bot', 'اشتراط الانضمام قبل استخدام البوت'), 'enabled', tx('The bot must be an admin of each channel/group to check membership', 'يجب أن يكون البوت مشرفاً في كل قناة/مجموعة ليتحقق من العضوية'))]}>
            {(v, set) => <ListEditor title={tx('Chats', 'المحادثات')} newItem={tx('Add chat', 'إضافة محادثة')} items={(v.chats as Obj[]) ?? []} onChange={(c) => set({ ...v, chats: c })} empty={{ chat_id: '@', title: '', url: 'https://t.me/' }}
              fields={[{ path: 'chat_id', label: tx('Chat (@username or -100… id)', 'المحادثة (@username أو معرّف -100…)') }, { path: 'title', label: tx('Button title', 'نص الزر') }, { path: 'url', label: tx('Invite link', 'رابط الدعوة'), full: true }]} />}
          </Section>
        )}

        {section === 'features' && (
          <Section title={tx('Features', 'الميزات')} section="features" settings={s} fields={[
            yesNo(tx('Freebies', 'المجانيات'), 'freebies'), yesNo(tx('Referrals', 'الإحالات'), 'referrals'), yesNo(tx('Cashback points', 'نقاط الكاش باك'), 'cashback'), yesNo(tx('Giveaways', 'السحوبات'), 'giveaways'),
            yesNo(tx('Discount levels', 'مستويات الخصم'), 'discount_levels'), yesNo(tx('Redeem codes', 'أكواد الشحن'), 'redeem_codes'), yesNo(tx('Promo codes at checkout', 'أكواد الخصم عند الدفع'), 'promo_codes'),
            yesNo(tx('Replacement requests (warranty)', 'طلبات الاستبدال (الضمان)'), 'replacements'), yesNo(tx('Reseller API for customers', 'واجهة API للموزعين'), 'reseller_api'),
            yesNo(tx('Post new products & restocks to the channel', 'نشر المنتجات الجديدة وإعادة التوفر في القناة'), 'stock_channel_posts'), yesNo(tx('"Download as TXT" button', 'زر "تنزيل كملف TXT"'), 'download_txt'),
          ]} />
        )}

        {section === 'pricing' && (
          <>
            <Section title={tx('Pricing defaults', 'إعدادات التسعير')} section="pricing" settings={s} fields={[
              { path: 'default_markup_percent', label: tx('Default markup %', 'الهامش الافتراضي %'), type: 'number', hint: tx('Price = provider cost × (1 + markup%) + fixed', 'السعر = تكلفة المزود × (1 + الهامش%) + الثابت') },
              { path: 'default_markup_fixed', label: tx('Default markup fixed ($)', 'الهامش الثابت الافتراضي ($)'), type: 'number' },
              { path: 'rounding', label: tx('Price rounding', 'تقريب السعر'), type: 'select', options: [
                { value: 'none', label: tx('None', 'بدون') }, { value: '0.01', label: tx('Up to the cent', 'لأقرب سنت') }, { value: '0.05', label: tx('Up to 0.05', 'لأقرب 0.05') },
                { value: '0.09', label: tx('Ends with .x9', 'ينتهي بـ .x9') }, { value: '0.49', label: tx('Ends with .49 / .99', 'ينتهي بـ .49 / .99') }, { value: '0.99', label: tx('Ends with .99', 'ينتهي بـ .99') }, { value: '1', label: tx('Whole dollars', 'دولار كامل') },
              ] },
              { path: 'default_on_failure', label: tx('When a source fails', 'عند فشل مصدر'), type: 'select', options: [{ value: 'next_source', label: tx('Try the next source', 'جرّب المصدر التالي') }, ...refundOrManual] },
              { path: 'all_failed_action', label: tx('When every source failed', 'عند فشل كل المصادر'), type: 'select', options: refundOrManual },
              yesNo(tx('Never sell at a loss (skip sources costing more than the sale)', 'لا بيع بخسارة أبداً (تخطّي المصادر الأغلى من سعر البيع)'), 'block_loss'),
            ]}>
              {(v, set) => <ListEditor title={tx('Discount levels (by total spent)', 'مستويات الخصم (حسب إجمالي الإنفاق)')} newItem={tx('Add level', 'إضافة مستوى')} items={(v.discount_levels as Obj[]) ?? []} onChange={(l) => set({ ...v, discount_levels: l })} empty={{ min_spent: 100, percent: 3, name_en: 'Silver', name_ar: 'فضي' }}
                fields={[{ path: 'min_spent', label: tx('Min spent ($)', 'أقل إنفاق ($)'), type: 'number' }, { path: 'percent', label: tx('Discount %', 'الخصم %'), type: 'number' }, { path: 'name_en', label: tx('Name (EN)', 'الاسم (إنجليزي)') }, { path: 'name_ar', label: tx('Name (AR)', 'الاسم (عربي)'), rtl: true }]} />}
            </Section>
            <Section title={tx('Price guards', 'حماية الأسعار')} section="pricing" settings={s}
              extra={<p className="mb-4 text-xs text-ink-400">{tx('Protect your profit when provider costs change. A paused pack is hidden from sale until you act on it (Catalog or the pack editor).', 'تحمي ربحك عندما تتغير تكاليف المزود. الباقة الموقوفة لا تُباع حتى تتخذ إجراءً (من الكتالوج أو محرر الباقة).')}</p>}
              fields={[
                { path: 'min_margin_percent', label: tx('Minimum margin %', 'الحد الأدنى للربح %'), type: 'number', hint: tx('Markup prices never go below cost + this %. A manual price below it pauses the pack. Each pack can override it.', 'أسعار الهامش لا تنزل عن التكلفة + هذه النسبة. السعر اليدوي الأقل منها يوقف الباقة. يمكن تخصيصها لكل باقة.') },
                { path: 'max_jump_percent', label: tx('Pause when cost jumps more than %', 'إيقاف عند ارتفاع التكلفة أكثر من %'), type: 'number', hint: tx('A bigger cost increase pauses the pack until you accept the new cost.', 'الارتفاع الأكبر يوقف الباقة حتى تقبل التكلفة الجديدة.') },
                yesNo(tx('Follow cost drops', 'اتّباع انخفاض التكلفة'), 'follow_drops', tx('On: prices go down when a provider gets cheaper. Off: the old cost stays the basis (more profit).', 'مفعّل: تنخفض الأسعار عندما يصبح المزود أرخص. معطّل: تبقى التكلفة القديمة هي الأساس (ربح أكثر).')),
              ]} />
          </>
        )}

        {section === 'catalog' && <CatalogWords settings={s} />}

        {section === 'payments' && (
          <>
            <Section title={tx('Deposits', 'الإيداعات')} section="payments" settings={s} fields={[
              { path: 'min_deposit', label: tx('Minimum deposit ($)', 'أقل إيداع ($)'), type: 'number' }, { path: 'max_deposit', label: tx('Maximum deposit ($)', 'أكبر إيداع ($)'), type: 'number' },
              { path: 'deposit_presets', label: tx('Amount buttons', 'أزرار المبالغ'), type: 'numbers' }, { path: 'deposit_expire_minutes', label: tx('Payment expires after (minutes)', 'تنتهي صلاحية الدفع بعد (دقائق)'), type: 'number' },
              yesNo(tx('Payment reminder', 'تذكير بالدفع'), 'payment_reminder', tx('One message halfway to expiry for a payment the customer opened but did not pay (e.g. after 10 of 20 minutes)', 'رسالة واحدة في منتصف المهلة لدفعة فتحها العميل ولم يدفعها (مثلاً بعد 10 من 20 دقيقة)')),
              yesNo(tx('Binance Pay (merchant API)', 'Binance Pay (واجهة التاجر)'), 'binance_pay.enabled', tx('Automatic. Needs a Binance Pay merchant account + keys below', 'تلقائي. يحتاج حساب تاجر Binance Pay + المفاتيح أدناه')),
              { path: 'binance_pay.fee_percent', label: tx('Binance Pay fee %', 'رسوم Binance Pay %'), type: 'number' },
              yesNo(tx('Binance Pay ID (personal transfer)', 'Binance Pay ID (تحويل شخصي)'), 'binance_id.enabled', tx('Customer sends to your personal Pay ID — no merchant account needed', 'يرسل العميل إلى Pay ID الشخصي — بلا حاجة لحساب تاجر')),
              { path: 'binance_id.verify', label: tx('Pay ID confirmation', 'تأكيد Pay ID'), type: 'select', hint: tx('Manual: the customer sends a screenshot / Order ID and you approve it. Automatic: needs a read-only Binance API key below.', 'يدوي: يرسل العميل لقطة شاشة / رقم الطلب وتوافق عليه. تلقائي: يحتاج مفتاح Binance API للقراءة فقط أدناه.'), options: [{ value: 'manual', label: tx('Manual approval', 'موافقة يدوية') }, { value: 'auto', label: tx('Automatic (Binance API key)', 'تلقائي (مفتاح Binance API)') }] },
              { path: 'binance_id.pay_id', label: tx('Your Binance Pay ID', 'Binance Pay ID الخاص بك') }, { path: 'binance_id.receiver_name', label: tx('Receiver name shown to customers', 'اسم المستلم الظاهر للعملاء') },
              { path: 'binance_id.fee_percent', label: tx('Pay ID fee %', 'رسوم Pay ID %'), type: 'number' },
              yesNo(tx('Add random cents to match transfers', 'إضافة سنتات عشوائية لمطابقة التحويلات'), 'binance_id.unique_amount'),
              { path: 'binance_id.instructions_en', label: tx('Pay ID instructions (EN)', 'تعليمات Pay ID (إنجليزي)'), type: 'textarea' }, { path: 'binance_id.instructions_ar', label: tx('Pay ID instructions (AR)', 'تعليمات Pay ID (عربي)'), type: 'textarea', rtl: true },
              yesNo(tx('NOWPayments (crypto)', 'NOWPayments (عملات رقمية)'), 'nowpayments.enabled'), { path: 'nowpayments.pay_currency', label: tx('Coin and network', 'العملة والشبكة'), type: 'select', hint: tx('Must also be enabled in your NOWPayments dashboard (Settings → Coins settings)', 'يجب تفعيلها أيضاً في لوحة NOWPayments (Settings ← Coins settings)'), options: [
                { value: 'usdtbsc', label: 'USDT · BEP20 (BNB Smart Chain)' }, { value: 'usdttrc20', label: 'USDT · TRC20 (Tron)' }, { value: 'usdtton', label: 'USDT · TON' },
                { value: 'usdtsol', label: 'USDT · Solana' }, { value: 'usdtmatic', label: 'USDT · Polygon' }, { value: 'usdterc20', label: 'USDT · ERC20 (Ethereum)' },
              ] },
              { path: 'nowpayments.min_amount', label: tx('NOWPayments minimum ($)', 'الحد الأدنى لـ NOWPayments ($)'), type: 'number' }, { path: 'nowpayments.fee_percent', label: tx('NOWPayments fee %', 'رسوم NOWPayments %'), type: 'number' },
              yesNo(tx('NOWPayments sandbox', 'وضع التجربة لـ NOWPayments'), 'nowpayments.sandbox'),
              yesNo(tx('ShamCash (manual review)', 'شام كاش (مراجعة يدوية)'), 'shamcash.enabled'), { path: 'shamcash.account_name', label: tx('ShamCash account name', 'اسم حساب شام كاش') },
              { path: 'shamcash.account_number', label: tx('ShamCash account / wallet number', 'رقم حساب / محفظة شام كاش') },
              { path: 'shamcash.currency', label: tx('Customer pays in', 'يدفع العميل بـ'), type: 'select', options: [{ value: 'USD', label: 'USD' }, { value: 'SYP', label: tx('SYP (converted)', 'ل.س (محوّلة)') }] },
              { path: 'shamcash.syp_per_usd', label: tx('SYP per 1 USD', 'ل.س مقابل 1 دولار'), type: 'number' }, { path: 'shamcash.min_amount', label: tx('ShamCash minimum ($)', 'الحد الأدنى لشام كاش ($)'), type: 'number' },
              { path: 'shamcash.fee_percent', label: tx('ShamCash fee %', 'رسوم شام كاش %'), type: 'number' },
              { path: 'shamcash.qr_image_url', label: tx('ShamCash QR image', 'صورة QR لشام كاش'), type: 'image', full: true },
              { path: 'shamcash.instructions_en', label: tx('ShamCash instructions (EN)', 'تعليمات شام كاش (إنجليزي)'), type: 'textarea' }, { path: 'shamcash.instructions_ar', label: tx('ShamCash instructions (AR)', 'تعليمات شام كاش (عربي)'), type: 'textarea', rtl: true },
            ]} />
            <Card title={tx('Payment API keys (encrypted)', 'مفاتيح API للدفع (مشفّرة)')}>
              <p className="mb-3 text-xs text-ink-400">
                {tx('Binance Pay merchant keys come from merchant.binance.com. The Pay ID method needs a read-only Binance API key. NOWPayments: API key + IPN secret from your dashboard; IPN URL is',
                  'مفاتيح تاجر Binance Pay من merchant.binance.com. طريقة Pay ID تحتاج مفتاح Binance API للقراءة فقط. NOWPayments: مفتاح API + سر IPN من لوحة التحكم؛ رابط IPN هو')}{' '}
                <code className="break-all">{`${location.origin}/webhook/nowpayments`}</code>
              </p>
              <Secrets keys={['binance_pay_api_key', 'binance_pay_secret_key', 'binance_api_key', 'binance_api_secret', 'nowpayments_api_key', 'nowpayments_ipn_secret']} />
              <div className="mt-4 space-y-2 border-t border-ink-700 pt-3">
                <p className="text-xs text-ink-400">{tx('Save the keys first, then test them. Each test makes one read-only call — nothing is charged.', 'احفظ المفاتيح أولاً ثم اختبرها. كل اختبار يجري طلب قراءة واحداً — بلا أي خصم.')}</p>
                <KeyTest method="binance_pay" label={tx('Binance Pay (merchant)', 'Binance Pay (تاجر)')} />
                <KeyTest method="binance_id" label={tx('Binance Pay ID (read-only key)', 'Binance Pay ID (مفتاح قراءة فقط)')} />
                <KeyTest method="nowpayments" label="NOWPayments" />
              </div>
            </Card>
          </>
        )}

        {section === 'rewards' && (
          <>
            <Section title={tx('Referral', 'الإحالة')} section="referral" settings={s} fields={[{ path: 'percent', label: tx('Referrer earns % of every deposit', 'يكسب المُحيل % من كل إيداع'), type: 'number' }]} />
            <Section title={tx('Cashback points', 'نقاط الكاش باك')} section="cashback" settings={s} fields={[
              { path: 'points_per_usd', label: tx('Points per $1 spent', 'النقاط لكل 1$ يُنفق'), type: 'number' }, { path: 'usd_per_point', label: tx('Value of 1 point ($)', 'قيمة النقطة الواحدة ($)'), type: 'number' },
              { path: 'min_redeem_points', label: tx('Minimum points to redeem', 'أقل عدد نقاط للاستبدال'), type: 'number' },
            ]} />
          </>
        )}

        {section === 'warranty' && (
          <>
            <Section title={tx('Warranty', 'الضمان')} section="warranty" settings={s} fields={[
              yesNo(tx('Auto-replace from my stock when available', 'استبدال تلقائي من مخزوني عند التوفر'), 'auto_replace_from_stock'),
              yesNo(tx('Customers may ask for refunds', 'يمكن للعملاء طلب الاسترداد'), 'allow_refund_requests'),
              { path: 'default_resolution', label: tx('Default resolution', 'الحل الافتراضي'), type: 'select', options: [{ value: 'replace', label: tx('Replace', 'استبدال') }, { value: 'refund', label: tx('Refund to wallet', 'استرداد إلى المحفظة') }] },
            ]} />
            <Section title={tx('Support', 'الدعم')} section="support" settings={s} fields={[{ path: 'hours_en', label: tx('Support hours (EN)', 'ساعات الدعم (إنجليزي)') }, { path: 'hours_ar', label: tx('Support hours (AR)', 'ساعات الدعم (عربي)'), rtl: true }]} />
          </>
        )}

        {section === 'notifications' && (
          <Section title={tx('Admin notifications', 'إشعارات المشرفين')} section="notifications" settings={s} fields={[
            { path: 'chat_id', label: tx('Admin chat id', 'معرّف محادثة المشرفين'), hint: tx('Group or user id that receives alerts (add the bot to the group). Empty = every admin with a linked Telegram ID.', 'معرّف المجموعة أو المستخدم الذي يستقبل التنبيهات (أضف البوت للمجموعة). فارغ = كل مشرف لديه معرّف تيليجرام مربوط.') },
            { path: 'stock_channel_id', label: tx('Channel for new-stock posts', 'قناة منشورات المخزون الجديد'), hint: tx('@channel or -100… id', '@channel أو معرّف -100…') },
            { path: 'low_stock_threshold', label: tx('Low stock alert at', 'تنبيه انخفاض المخزون عند'), type: 'number' },
            yesNo(tx('New order', 'طلب جديد'), 'events.new_order'), yesNo(tx('Order failed', 'فشل طلب'), 'events.order_failed'), yesNo(tx('Manual order', 'طلب يدوي'), 'events.manual_order'),
            yesNo(tx('Deposit paid', 'إيداع مدفوع'), 'events.deposit_paid'), yesNo(tx('Deposit needs review', 'إيداع يحتاج مراجعة'), 'events.deposit_review'), yesNo(tx('New ticket', 'تذكرة جديدة'), 'events.ticket'),
            yesNo(tx('Low provider balance', 'رصيد مزود منخفض'), 'events.low_provider_balance'), yesNo(tx('Low stock', 'مخزون منخفض'), 'events.low_stock'),
            yesNo(tx('Provider catalog changes', 'تغييرات كتالوج المزود'), 'events.catalog_changes'), yesNo(tx('New user', 'مستخدم جديد'), 'events.new_user'),
          ]} />
        )}
        {section === 'notifications' && (
          <Section title={tx('Customer alerts', 'تنبيهات العملاء')} section="alerts" settings={s} fields={[
            yesNo(tx('Announce new products', 'الإعلان عن المنتجات الجديدة'), 'new_products', tx('Sent to every customer who has alerts on (they can turn them off in their profile)', 'تُرسل لكل عميل فعّل التنبيهات (يمكنه إيقافها من ملفه الشخصي)')),
            yesNo(tx('Announce back in stock', 'الإعلان عن عودة التوفر'), 'restock', tx('When a sold-out product becomes available again (provider restock or your own stock upload)', 'عندما يعود منتج نافد للتوفر (من المزود أو برفع مخزونك)')),
            yesNo(tx('"Notify me" button on sold-out products', 'زر "نبّهني" على المنتجات النافدة'), 'notify_me', tx('Personal message to the customers who asked', 'رسالة خاصة للعملاء الذين طلبوا')),
            { path: 'new_delay_minutes', label: tx('Wait before announcing a new product (minutes)', 'الانتظار قبل الإعلان عن منتج جديد (دقائق)'), type: 'number', hint: tx('Time to edit the name and price after importing', 'وقت لتعديل الاسم والسعر بعد الاستيراد') },
            { path: 'restock_cooldown_hours', label: tx('Same product restock alert at most every (hours)', 'تنبيه عودة التوفر للمنتج نفسه مرة كل (ساعات) كحد أقصى'), type: 'number' },
          ]} />
        )}

        {section === 'landing' && (
          <Section title={tx('Landing page', 'الصفحة الرئيسية')} section="landing" settings={s}
            extra={<a href="/" target="_blank" rel="noreferrer" className="mb-4 inline-flex items-center gap-1 text-sm text-gold"><ExternalLink className="h-3.5 w-3.5" /> {tx('Open the landing page', 'فتح الصفحة الرئيسية')}</a>}
            fields={[
              yesNo(tx('Landing page enabled', 'تفعيل الصفحة الرئيسية'), 'enabled'), yesNo(tx('Show products', 'إظهار المنتجات'), 'show_products'),
              { path: 'title_en', label: tx('Title (EN)', 'العنوان (إنجليزي)') }, { path: 'title_ar', label: tx('Title (AR)', 'العنوان (عربي)'), rtl: true },
              { path: 'subtitle_en', label: tx('Subtitle (EN)', 'العنوان الفرعي (إنجليزي)'), type: 'textarea' }, { path: 'subtitle_ar', label: tx('Subtitle (AR)', 'العنوان الفرعي (عربي)'), type: 'textarea', rtl: true },
              { path: 'cta_en', label: tx('Button (EN)', 'الزر (إنجليزي)') }, { path: 'cta_ar', label: tx('Button (AR)', 'الزر (عربي)'), rtl: true },
              { path: 'accent_color', label: tx('Accent color', 'اللون المميز'), type: 'color' }, { path: 'seo_description', label: tx('SEO description', 'وصف محركات البحث') },
              { path: 'hero_image_url', label: tx('Hero image', 'الصورة الرئيسية'), type: 'image', full: true },
              { path: 'footer_en', label: tx('Footer (EN)', 'التذييل (إنجليزي)') }, { path: 'footer_ar', label: tx('Footer (AR)', 'التذييل (عربي)'), rtl: true },
            ]}>
            {(v, set) => (
              <div className="space-y-6">
                <ListEditor title={tx('Features', 'المميزات')} newItem={tx('Add feature', 'إضافة ميزة')} items={(v.features as Obj[]) ?? []} onChange={(x) => set({ ...v, features: x })} empty={{ icon: '⭐', title_en: '', title_ar: '', text_en: '', text_ar: '' }}
                  fields={[{ path: 'icon', label: tx('Icon (emoji)', 'الأيقونة (إيموجي)') }, { path: 'title_en', label: tx('Title (EN)', 'العنوان (إنجليزي)') }, { path: 'title_ar', label: tx('Title (AR)', 'العنوان (عربي)'), rtl: true }, { path: 'text_en', label: tx('Text (EN)', 'النص (إنجليزي)') }, { path: 'text_ar', label: tx('Text (AR)', 'النص (عربي)'), rtl: true }]} />
                <ListEditor title={tx('FAQ', 'الأسئلة الشائعة')} newItem={tx('Add question', 'إضافة سؤال')} items={(v.faq as Obj[]) ?? []} onChange={(x) => set({ ...v, faq: x })} empty={{ q_en: '', q_ar: '', a_en: '', a_ar: '' }}
                  fields={[{ path: 'q_en', label: tx('Question (EN)', 'السؤال (إنجليزي)') }, { path: 'q_ar', label: tx('Question (AR)', 'السؤال (عربي)'), rtl: true }, { path: 'a_en', label: tx('Answer (EN)', 'الجواب (إنجليزي)'), type: 'textarea' }, { path: 'a_ar', label: tx('Answer (AR)', 'الجواب (عربي)'), type: 'textarea', rtl: true }]} />
              </div>
            )}
          </Section>
        )}

        {section === 'texts' && <TextsEditor />}
      </div>
    </>
  );
}
