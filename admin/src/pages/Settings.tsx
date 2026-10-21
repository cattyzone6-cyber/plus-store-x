import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { Badge, Button, Card, ErrorBox, Field, ImageInput, Input, Loading, NumberInput, PageHeader, Select, StyleDot, StyleSelect, Switch, Table, Tabs, Textarea } from '../components/ui';

type Obj = Record<string, unknown>;
type Settings = Record<string, Obj>;

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
  switch (fd.type ?? 'text') {
    case 'textarea': return <Textarea dir={fd.rtl ? 'rtl' : undefined} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number': return <NumberInput value={(value as number) ?? 0} onChange={(v) => onChange(v ?? 0)} />;
    case 'switch': return <Switch checked={!!value} onChange={onChange} />;
    case 'select': return <Select value={String(value ?? '')} onChange={(e) => onChange(typeof value === 'number' ? Number(e.target.value) : e.target.value)} options={fd.options ?? []} />;
    case 'image': return <ImageInput value={(value as string) || null} onChange={(v) => onChange(v ?? '')} />;
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
  const [v, setV] = useState<Obj>(settings[section] ?? {});
  useEffect(() => setV(settings[section] ?? {}), [settings, section]);
  const { run, busy } = useAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(settings[section] ?? {});
  return (
    <Card title={title} actions={<Button size="sm" variant="primary" disabled={!dirty} loading={busy === 'save'} onClick={() => void run('save', () => api(`/settings/${section}`, { method: 'PUT', body: v }), { success: 'Saved', invalidate: ['/settings', '/dashboard'] })}><Save className="h-3.5 w-3.5" /> Save</Button>}>
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
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        ))}
      </div>
      <Button size="sm" className="mt-2" onClick={() => onChange([...items, { ...empty }])}><Plus className="h-3.5 w-3.5" /> {newItem ?? 'Add'}</Button>
    </div>
  );
}

const MENU_IDS = ['shop', 'freebies', 'deposit', 'profile', 'orders', 'support', 'referrals', 'giveaways', 'redeem', 'language', 'website', 'channel'];

function MenuEditor({ menu, onChange }: { menu: { id: string; enabled: boolean; style: string; row: number }[]; onChange: (v: typeof menu) => void }) {
  const missing = MENU_IDS.filter((id) => !menu.some((m) => m.id === id));
  const rows = [...new Set(menu.map((m) => m.row))].sort((a, b) => a - b);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="label">Main menu buttons</div>
        <Table head={['Button', 'Row', 'Color', 'On', '']}>
          {menu.map((m, i) => (
            <tr key={m.id}>
              <td className="td capitalize">{m.id}</td>
              <td className="td w-20"><NumberInput value={m.row} onChange={(v) => onChange(menu.map((x, j) => (j === i ? { ...x, row: v ?? 1 } : x)))} className="!py-1" /></td>
              <td className="td w-40"><StyleSelect value={m.style} onChange={(v) => onChange(menu.map((x, j) => (j === i ? { ...x, style: v ?? 'default' } : x)))} /></td>
              <td className="td"><Switch checked={m.enabled} onChange={(v) => onChange(menu.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} /></td>
              <td className="td"><Button size="sm" variant="ghost" onClick={() => onChange(menu.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button></td>
            </tr>
          ))}
        </Table>
        {missing.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">{missing.map((id) => <Button key={id} size="sm" onClick={() => onChange([...menu, { id, enabled: true, style: 'default', row: (rows[rows.length - 1] ?? 0) + 1 }])}><Plus className="h-3 w-3" />{id}</Button>)}</div>
        )}
      </div>
      <div>
        <div className="label">Preview</div>
        <div className="space-y-1.5 rounded-xl bg-[#17212b] p-3">
          {rows.map((r) => (
            <div key={r} className="flex gap-1.5">
              {menu.filter((m) => m.row === r && m.enabled).map((m) => (
                <div key={m.id} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm capitalize text-white ${m.style === 'primary' ? 'bg-[#3e78b2]' : m.style === 'success' ? 'bg-[#4f8a3c]' : m.style === 'danger' ? 'bg-[#a3413c]' : 'bg-[#2b3a48]'}`}>
                  <StyleDot style={m.style} /> {m.id}
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
  const q = useApi<{ items: { key: string; set: boolean; masked: string }[] }>('/secrets');
  const [vals, setVals] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const items = (q.data?.items ?? []).filter((i) => keys.includes(i.key));
  return (
    <div className="space-y-2">
      {items.map((s) => (
        <div key={s.key} className="flex flex-wrap items-end gap-2">
          <Field label={s.key.replace(/_/g, ' ')} className="min-w-[240px] flex-1" hint={s.set ? `Saved: ${s.masked}` : 'Not set'}>
            <Input type="password" autoComplete="off" value={vals[s.key] ?? ''} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} placeholder={s.set ? '•••••• (leave empty to keep)' : ''} />
          </Field>
          <Button size="sm" variant="primary" disabled={!vals[s.key]} loading={busy === s.key} onClick={() => void run(s.key, () => api('/secrets', { method: 'PUT', body: { key: s.key, value: vals[s.key] } }), { success: 'Secret saved', invalidate: ['/secrets'] }).then(() => setVals({ ...vals, [s.key]: '' }))}>Save</Button>
          {s.set && <Button size="sm" variant="ghost" onClick={() => { if (confirm('Remove this secret?')) void run(`${s.key}-del`, () => api('/secrets', { method: 'PUT', body: { key: s.key, value: null } }), { success: 'Removed', invalidate: ['/secrets'] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
        </div>
      ))}
    </div>
  );
}

function TextsEditor() {
  const q = useApi<{ items: { key: string; default_en: string; default_ar: string; en: string; ar: string }[] }>('/texts');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, { en?: string; ar?: string }>>({});
  const { run, busy } = useAction();
  const items = useMemo(() => (q.data?.items ?? []).filter((i) => !search || i.key.includes(search) || i.default_en.toLowerCase().includes(search.toLowerCase())), [q.data, search]);
  if (q.isLoading) return <Loading />;
  return (
    <Card title="Bot texts" actions={<Button size="sm" variant="primary" disabled={!Object.keys(edits).length} loading={busy === 'save'} onClick={() => void run('save', () => api('/texts', { method: 'PUT', body: { texts: edits } }), { success: 'Texts saved', invalidate: ['/texts', '/settings'] }).then(() => setEdits({}))}><Save className="h-3.5 w-3.5" /> Save {Object.keys(edits).length || ''}</Button>}>
      <p className="mb-3 text-xs text-ink-400">Leave a field empty to use the built-in text (shown as placeholder). Telegram HTML is allowed. <code>{'{name}'}</code> are variables, <code>{'{e:shop}'}</code> are emoji from the library.</p>
      <Input placeholder="Search keys or text…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 max-w-sm" />
      <div className="space-y-3">
        {items.slice(0, 80).map((i) => {
          const cur = { en: edits[i.key]?.en ?? i.en, ar: edits[i.key]?.ar ?? i.ar };
          return (
            <div key={i.key} className="rounded-lg border border-ink-700 p-3">
              <div className="mb-2 flex items-center gap-2"><code className="text-xs text-gold">{i.key}</code>{(i.en || i.ar) && <Badge tone="gold">customised</Badge>}</div>
              <div className="grid gap-2 md:grid-cols-2">
                <Textarea rows={3} placeholder={i.default_en} value={cur.en} onChange={(e) => setEdits({ ...edits, [i.key]: { ...cur, en: e.target.value } })} className="text-xs" />
                <Textarea rows={3} dir="rtl" placeholder={i.default_ar || i.default_en} value={cur.ar} onChange={(e) => setEdits({ ...edits, [i.key]: { ...cur, ar: e.target.value } })} className="text-xs" />
              </div>
            </div>
          );
        })}
        {items.length > 80 && <p className="text-xs text-ink-400">Showing 80 of {items.length} — refine the search.</p>}
      </div>
    </Card>
  );
}

const TABS = [
  { value: 'brand', label: 'Brand' }, { value: 'bot', label: 'Bot & menu' }, { value: 'force_join', label: 'Force join' },
  { value: 'features', label: 'Features' }, { value: 'pricing', label: 'Pricing' }, { value: 'payments', label: 'Payments' },
  { value: 'rewards', label: 'Referral & cashback' }, { value: 'warranty', label: 'Warranty & support' },
  { value: 'notifications', label: 'Notifications' }, { value: 'landing', label: 'Landing page' }, { value: 'texts', label: 'Texts' },
];

const yesNo = (label: string, path: string, hint?: string): FD => ({ path, label, type: 'switch', hint });

export default function SettingsPage() {
  const { section = 'brand' } = useParams();
  const nav = useNavigate();
  const q = useApi<{ settings: Settings; has_queue: boolean }>('/settings');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data!.settings;

  return (
    <>
      <PageHeader title="Settings" sub="Everything here is per store — no code changes needed." />
      <Tabs value={section} onChange={(v) => nav(`/settings/${v}`)} tabs={TABS} />
      <div className="space-y-4">
        {section === 'brand' && (
          <Section title="Brand" section="brand" settings={s} fields={[
            { path: 'name', label: 'Store name' }, { path: 'order_prefix', label: 'Order code prefix', hint: 'e.g. PSX → PSX-AB12CD34' },
            { path: 'tagline_en', label: 'Tagline (EN)' }, { path: 'tagline_ar', label: 'Tagline (AR)', rtl: true },
            { path: 'logo_url', label: 'Logo', type: 'image', full: true },
            { path: 'bot_username', label: 'Bot username (without @)', hint: 'Filled automatically when the webhook is set' },
            { path: 'support_username', label: 'Support username (without @)' },
            { path: 'channel_url', label: 'Channel link' }, { path: 'group_url', label: 'Group link' },
            { path: 'website_url', label: 'Website link' },
          ]} />
        )}

        {section === 'bot' && (
          <Section title="Bot" section="bot" settings={s} fields={[
            { path: 'default_lang', label: 'Default language', type: 'select', options: [{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }] },
            { path: 'category_columns', label: 'Category buttons per row', type: 'select', options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }] },
            { path: 'welcome_image_url', label: 'Welcome image', type: 'image', full: true },
            { path: 'qty_presets', label: 'Quantity buttons', type: 'numbers', hint: 'Comma separated' },
            { path: 'in_stock_style', label: 'In-stock product color', type: 'style' },
            { path: 'sold_out_style', label: 'Sold-out product color', type: 'style' },
            { path: 'buy_style', label: 'Buy button color', type: 'style' },
            { path: 'nav_style', label: 'Back / Home color', type: 'style' },
            yesNo('Ask language on first /start', 'ask_lang_on_start'),
            yesNo('Show sold-out products', 'show_sold_out'),
            yesNo('Custom emoji (owner has Telegram Premium)', 'premium_emoji', 'Bot API 9.4: custom emoji in messages and on buttons only work when the BotFather owner has Premium'),
            yesNo('Maintenance mode', 'maintenance_mode', 'Customers see a maintenance message; admins can still use the bot'),
          ]}>
            {(v, set) => <MenuEditor menu={(v.main_menu as { id: string; enabled: boolean; style: string; row: number }[]) ?? []} onChange={(m) => set({ ...v, main_menu: m })} />}
          </Section>
        )}

        {section === 'force_join' && (
          <Section title="Force join" section="force_join" settings={s} fields={[yesNo('Require joining before using the bot', 'enabled', 'The bot must be an admin of each channel/group to check membership')]}>
            {(v, set) => <ListEditor title="Chats" newItem="Add chat" items={(v.chats as Obj[]) ?? []} onChange={(c) => set({ ...v, chats: c })} empty={{ chat_id: '@', title: '', url: 'https://t.me/' }}
              fields={[{ path: 'chat_id', label: 'Chat (@username or -100… id)' }, { path: 'title', label: 'Button title' }, { path: 'url', label: 'Invite link', full: true }]} />}
          </Section>
        )}

        {section === 'features' && (
          <Section title="Features" section="features" settings={s} fields={[
            yesNo('Freebies', 'freebies'), yesNo('Referrals', 'referrals'), yesNo('Cashback points', 'cashback'), yesNo('Giveaways', 'giveaways'),
            yesNo('Discount levels', 'discount_levels'), yesNo('Redeem codes', 'redeem_codes'), yesNo('Promo codes at checkout', 'promo_codes'),
            yesNo('Replacement requests (warranty)', 'replacements'), yesNo('Reseller API for customers', 'reseller_api'),
            yesNo('Post new stock to channel', 'stock_channel_posts'), yesNo('"Download as TXT" button', 'download_txt'),
          ]} />
        )}

        {section === 'pricing' && (
          <Section title="Pricing defaults" section="pricing" settings={s} fields={[
            { path: 'default_markup_percent', label: 'Default markup %', type: 'number', hint: 'Price = provider cost × (1 + markup%) + fixed' },
            { path: 'default_markup_fixed', label: 'Default markup fixed ($)', type: 'number' },
            { path: 'rounding', label: 'Price rounding', type: 'select', options: [
              { value: 'none', label: 'None' }, { value: '0.01', label: 'Up to the cent' }, { value: '0.05', label: 'Up to 0.05' },
              { value: '0.09', label: 'Ends with .x9' }, { value: '0.49', label: 'Ends with .49 / .99' }, { value: '0.99', label: 'Ends with .99' }, { value: '1', label: 'Whole dollars' },
            ] },
            { path: 'default_on_failure', label: 'When a source fails', type: 'select', options: [{ value: 'next_source', label: 'Try the next source' }, { value: 'refund', label: 'Refund to wallet' }, { value: 'manual', label: 'Manual queue' }] },
            { path: 'all_failed_action', label: 'When every source failed', type: 'select', options: [{ value: 'refund', label: 'Refund to wallet' }, { value: 'manual', label: 'Manual queue' }] },
            yesNo('Never sell at a loss (skip sources costing more than the sale)', 'block_loss'),
          ]}>
            {(v, set) => <ListEditor title="Discount levels (by total spent)" newItem="Add level" items={(v.discount_levels as Obj[]) ?? []} onChange={(l) => set({ ...v, discount_levels: l })} empty={{ min_spent: 100, percent: 3, name_en: 'Silver', name_ar: 'فضي' }}
              fields={[{ path: 'min_spent', label: 'Min spent ($)', type: 'number' }, { path: 'percent', label: 'Discount %', type: 'number' }, { path: 'name_en', label: 'Name (EN)' }, { path: 'name_ar', label: 'Name (AR)', rtl: true }]} />}
          </Section>
        )}

        {section === 'payments' && (
          <>
            <Section title="Deposits" section="payments" settings={s} fields={[
              { path: 'min_deposit', label: 'Minimum deposit ($)', type: 'number' }, { path: 'max_deposit', label: 'Maximum deposit ($)', type: 'number' },
              { path: 'deposit_presets', label: 'Amount buttons', type: 'numbers' }, { path: 'deposit_expire_minutes', label: 'Payment expires after (minutes)', type: 'number' },
              yesNo('Binance Pay (merchant API)', 'binance_pay.enabled', 'Automatic. Needs a Binance Pay merchant account + keys below'),
              { path: 'binance_pay.fee_percent', label: 'Binance Pay fee %', type: 'number' },
              yesNo('Binance Pay ID (personal transfer)', 'binance_id.enabled', 'Customer sends to your Pay ID; the bot matches the transfer using a read-only API key'),
              { path: 'binance_id.pay_id', label: 'Your Binance Pay ID' }, { path: 'binance_id.receiver_name', label: 'Receiver name shown to customers' },
              { path: 'binance_id.fee_percent', label: 'Pay ID fee %', type: 'number' },
              yesNo('Add random cents to match transfers', 'binance_id.unique_amount'),
              { path: 'binance_id.instructions_en', label: 'Pay ID instructions (EN)', type: 'textarea' }, { path: 'binance_id.instructions_ar', label: 'Pay ID instructions (AR)', type: 'textarea', rtl: true },
              yesNo('NOWPayments (USDT BEP20)', 'nowpayments.enabled'), { path: 'nowpayments.pay_currency', label: 'Pay currency code', hint: 'usdtbsc = USDT on BEP20' },
              { path: 'nowpayments.min_amount', label: 'NOWPayments minimum ($)', type: 'number' }, { path: 'nowpayments.fee_percent', label: 'NOWPayments fee %', type: 'number' },
              yesNo('NOWPayments sandbox', 'nowpayments.sandbox'),
              yesNo('ShamCash (manual review)', 'shamcash.enabled'), { path: 'shamcash.account_name', label: 'ShamCash account name' },
              { path: 'shamcash.account_number', label: 'ShamCash account / wallet number' },
              { path: 'shamcash.currency', label: 'Customer pays in', type: 'select', options: [{ value: 'USD', label: 'USD' }, { value: 'SYP', label: 'SYP (converted)' }] },
              { path: 'shamcash.syp_per_usd', label: 'SYP per 1 USD', type: 'number' }, { path: 'shamcash.min_amount', label: 'ShamCash minimum ($)', type: 'number' },
              { path: 'shamcash.fee_percent', label: 'ShamCash fee %', type: 'number' },
              { path: 'shamcash.qr_image_url', label: 'ShamCash QR image', type: 'image', full: true },
              { path: 'shamcash.instructions_en', label: 'ShamCash instructions (EN)', type: 'textarea' }, { path: 'shamcash.instructions_ar', label: 'ShamCash instructions (AR)', type: 'textarea', rtl: true },
            ]} />
            <Card title="Payment API keys (encrypted)">
              <p className="mb-3 text-xs text-ink-400">Binance Pay merchant keys come from merchant.binance.com. The Pay ID method needs a <b>read-only</b> Binance API key. NOWPayments: API key + IPN secret from your dashboard; IPN URL is <code>{`${location.origin}/webhook/nowpayments`}</code>.</p>
              <Secrets keys={['binance_pay_api_key', 'binance_pay_secret_key', 'binance_api_key', 'binance_api_secret', 'nowpayments_api_key', 'nowpayments_ipn_secret']} />
            </Card>
          </>
        )}

        {section === 'rewards' && (
          <>
            <Section title="Referral" section="referral" settings={s} fields={[{ path: 'percent', label: 'Referrer earns % of every deposit', type: 'number' }]} />
            <Section title="Cashback points" section="cashback" settings={s} fields={[
              { path: 'points_per_usd', label: 'Points per $1 spent', type: 'number' }, { path: 'usd_per_point', label: 'Value of 1 point ($)', type: 'number' },
              { path: 'min_redeem_points', label: 'Minimum points to redeem', type: 'number' },
            ]} />
          </>
        )}

        {section === 'warranty' && (
          <>
            <Section title="Warranty" section="warranty" settings={s} fields={[
              yesNo('Auto-replace from my stock when available', 'auto_replace_from_stock'),
              yesNo('Customers may ask for refunds', 'allow_refund_requests'),
              { path: 'default_resolution', label: 'Default resolution', type: 'select', options: [{ value: 'replace', label: 'Replace' }, { value: 'refund', label: 'Refund to wallet' }] },
            ]} />
            <Section title="Support" section="support" settings={s} fields={[{ path: 'hours_en', label: 'Support hours (EN)' }, { path: 'hours_ar', label: 'Support hours (AR)', rtl: true }]} />
          </>
        )}

        {section === 'notifications' && (
          <Section title="Admin notifications" section="notifications" settings={s} fields={[
            { path: 'chat_id', label: 'Admin chat id', hint: 'Group or user id that receives alerts (add the bot to the group). Empty = every admin with a linked Telegram ID.' },
            { path: 'stock_channel_id', label: 'Channel for new-stock posts', hint: '@channel or -100… id' },
            { path: 'low_stock_threshold', label: 'Low stock alert at', type: 'number' },
            yesNo('New order', 'events.new_order'), yesNo('Order failed', 'events.order_failed'), yesNo('Manual order', 'events.manual_order'),
            yesNo('Deposit paid', 'events.deposit_paid'), yesNo('Deposit needs review', 'events.deposit_review'), yesNo('New ticket', 'events.ticket'),
            yesNo('Low provider balance', 'events.low_provider_balance'), yesNo('Low stock', 'events.low_stock'),
            yesNo('Provider catalog changes', 'events.catalog_changes'), yesNo('New user', 'events.new_user'),
          ]} />
        )}

        {section === 'landing' && (
          <Section title="Landing page" section="landing" settings={s}
            extra={<a href="/" target="_blank" rel="noreferrer" className="mb-4 inline-flex items-center gap-1 text-sm text-gold"><ExternalLink className="h-3.5 w-3.5" /> Open the landing page</a>}
            fields={[
              yesNo('Landing page enabled', 'enabled'), yesNo('Show products', 'show_products'),
              { path: 'title_en', label: 'Title (EN)' }, { path: 'title_ar', label: 'Title (AR)', rtl: true },
              { path: 'subtitle_en', label: 'Subtitle (EN)', type: 'textarea' }, { path: 'subtitle_ar', label: 'Subtitle (AR)', type: 'textarea', rtl: true },
              { path: 'cta_en', label: 'Button (EN)' }, { path: 'cta_ar', label: 'Button (AR)', rtl: true },
              { path: 'accent_color', label: 'Accent color', type: 'color' }, { path: 'seo_description', label: 'SEO description' },
              { path: 'hero_image_url', label: 'Hero image', type: 'image', full: true },
              { path: 'footer_en', label: 'Footer (EN)' }, { path: 'footer_ar', label: 'Footer (AR)', rtl: true },
            ]}>
            {(v, set) => (
              <div className="space-y-6">
                <ListEditor title="Features" newItem="Add feature" items={(v.features as Obj[]) ?? []} onChange={(x) => set({ ...v, features: x })} empty={{ icon: '⭐', title_en: '', title_ar: '', text_en: '', text_ar: '' }}
                  fields={[{ path: 'icon', label: 'Icon (emoji)' }, { path: 'title_en', label: 'Title (EN)' }, { path: 'title_ar', label: 'Title (AR)', rtl: true }, { path: 'text_en', label: 'Text (EN)' }, { path: 'text_ar', label: 'Text (AR)', rtl: true }]} />
                <ListEditor title="FAQ" newItem="Add question" items={(v.faq as Obj[]) ?? []} onChange={(x) => set({ ...v, faq: x })} empty={{ q_en: '', q_ar: '', a_en: '', a_ar: '' }}
                  fields={[{ path: 'q_en', label: 'Question (EN)' }, { path: 'q_ar', label: 'Question (AR)', rtl: true }, { path: 'a_en', label: 'Answer (EN)', type: 'textarea' }, { path: 'a_ar', label: 'Answer (AR)', type: 'textarea', rtl: true }]} />
              </div>
            )}
          </Section>
        )}

        {section === 'texts' && <TextsEditor />}
      </div>
    </>
  );
}
