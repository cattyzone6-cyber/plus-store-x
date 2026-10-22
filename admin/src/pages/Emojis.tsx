import { useState } from 'react';
import { Trash2, Info } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi, useIsOwner } from '../lib/hooks';
import { useTx } from '../lib/i18n';
import { dt } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Input, Loading, PageHeader, Select, Switch, Table } from '../components/ui';

interface EmojiItem { key: string; default_fallback: string; fallback: string; custom_emoji_id: string | null; label: string | null }
interface InboxItem { custom_emoji_id: string; fallback: string | null; captured_by: number | null; created_at: string }

function Preview({ id, fallback }: { id: string | null; fallback: string }) {
  const [broken, setBroken] = useState(false);
  if (!id || broken) return <span className="text-xl">{fallback}</span>;
  return <img src={`/api/admin/emojis/preview/${id}`} alt={fallback} className="h-7 w-7 object-contain" onError={() => setBroken(true)} />;
}

function EmojiRow({ e, owner, inbox }: { e: EmojiItem; owner: boolean; inbox: InboxItem[] }) {
  const tx = useTx();
  const [fallback, setFallback] = useState(e.fallback);
  const [cid, setCid] = useState(e.custom_emoji_id ?? '');
  const { run, busy } = useAction();
  const dirty = fallback !== e.fallback || cid !== (e.custom_emoji_id ?? '');
  return (
    <tr>
      <td className="td"><code className="text-xs" dir="ltr">{e.key}</code></td>
      <td className="td"><Preview id={e.custom_emoji_id} fallback={e.fallback} /></td>
      <td className="td w-24"><Input value={fallback} disabled={!owner} onChange={(x) => setFallback(x.target.value)} className="!py-1 text-center" /></td>
      <td className="td">
        <div className="flex gap-2">
          <Input dir="ltr" value={cid} disabled={!owner} placeholder={tx('custom emoji id', 'رقم الإيموجي المخصص')} onChange={(x) => setCid(x.target.value.replace(/\D/g, ''))} className="!py-1 font-mono text-xs" />
          {owner && inbox.length > 0 && (
            <Select className="!w-28 !py-1 text-xs" value="" onChange={(x) => x.target.value && setCid(x.target.value)} options={[{ value: '', label: tx('from inbox', 'من الوارد') }, ...inbox.map((i) => ({ value: i.custom_emoji_id, label: `${i.fallback ?? ''} ${i.custom_emoji_id.slice(-6)}` }))]} />
          )}
        </div>
      </td>
      <td className="td text-end">
        {owner && dirty && <Button size="sm" variant="primary" loading={busy === 'save'} onClick={() => void run('save', () => api(`/emojis/${e.key}`, { method: 'PUT', body: { fallback: fallback || e.default_fallback, custom_emoji_id: cid || null } }), { success: tx('Saved', 'تم الحفظ'), invalidate: ['/emojis'] })}>{tx('Save', 'حفظ')}</Button>}
      </td>
    </tr>
  );
}

export default function Emojis() {
  const tx = useTx();
  const owner = useIsOwner();
  const list = useApi<{ items: EmojiItem[] }>('/emojis');
  const inbox = useApi<{ items: InboxItem[] }>('/emoji-inbox');
  const settings = useApi<{ settings: { bot: Record<string, unknown> & { premium_emoji: boolean } } }>(owner ? '/settings' : null);
  const { run } = useAction();
  const [q, setQ] = useState('');

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} />;
  const items = list.data!.items.filter((e) => !q || e.key.includes(q.toLowerCase()));
  const premium = settings.data?.settings.bot.premium_emoji ?? false;

  return (
    <>
      <PageHeader title={tx('Emoji library', 'مكتبة الإيموجي')} sub={tx('Every emoji the bot uses. With Telegram Premium you can swap any of them for an animated custom emoji.', 'كل الإيموجي التي يستخدمها البوت. مع تيليجرام بريميوم يمكنك استبدال أيٍّ منها بإيموجي مخصص متحرك.')} />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title={tx('Premium custom emoji', 'إيموجي بريميوم المخصص')} className="lg:col-span-2">
          <div className="flex items-start gap-3 text-sm text-ink-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <div className="space-y-1">
              <p>{tx('Telegram only shows custom emoji from bots whose ', 'تيليجرام يعرض الإيموجي المخصص فقط من البوتات التي ')}<b>{tx('BotFather owner has Telegram Premium', 'يملك صاحبها في BotFather اشتراك تيليجرام بريميوم')}</b>{tx('. Without it, the plain fallback emoji are used.', '. بدونه تُستخدم الإيموجي العادية.')}</p>
              <p>{tx('To capture IDs: link your Telegram ID in Admins, then send ', 'لالتقاط الأرقام: اربط رقم تيليجرام الخاص بك في صفحة المشرفين، ثم أرسل ')}<code dir="ltr">/emoji</code>{tx(' to the bot followed by a message containing your custom emoji. They appear in the inbox below.', ' للبوت متبوعاً برسالة فيها الإيموجي المخصص. ستظهر في الوارد أدناه.')}</p>
            </div>
          </div>
          {owner && (
            <div className="mt-3">
              <Switch checked={premium} onChange={(v) => void run('premium', () => api('/settings/bot', { method: 'PUT', body: { ...settings.data!.settings.bot, premium_emoji: v } }), { success: v ? tx('Custom emoji enabled', 'تم تفعيل الإيموجي المخصص') : tx('Using plain emoji', 'استخدام الإيموجي العادية'), invalidate: ['/settings'] })}
                label={premium ? tx('Custom emoji enabled', 'الإيموجي المخصص مفعّل') : tx('Custom emoji disabled (plain emoji)', 'الإيموجي المخصص معطّل (إيموجي عادية)')} />
            </div>
          )}
        </Card>
        <Card title={tx(`Inbox (${inbox.data?.items.length ?? 0})`, `الوارد (${inbox.data?.items.length ?? 0})`)}>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {(inbox.data?.items ?? []).length === 0 && <p className="text-sm text-ink-400">{tx('Send custom emoji to the bot after /emoji.', 'أرسل الإيموجي المخصص للبوت بعد ‎/emoji.')}</p>}
            {(inbox.data?.items ?? []).map((i) => (
              <div key={i.custom_emoji_id} className="flex items-center gap-2 text-xs">
                <Preview id={i.custom_emoji_id} fallback={i.fallback ?? '⭐'} />
                <code dir="ltr" className="min-w-0 flex-1 cursor-pointer truncate text-start hover:text-gold" title={tx('Copy', 'نسخ')} onClick={() => void navigator.clipboard.writeText(i.custom_emoji_id)}>{i.custom_emoji_id}</code>
                <span className="hidden text-ink-400 sm:inline">{dt(i.created_at)}</span>
                <button aria-label={tx('Delete', 'حذف')} onClick={() => void run('del', () => api(`/emoji-inbox/${i.custom_emoji_id}`, { method: 'DELETE' }), { invalidate: ['/emoji-inbox'] })} className="grid h-9 w-9 place-items-center text-ink-400 hover:text-red-400 sm:h-6 sm:w-6"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <Input dir="ltr" placeholder={tx('Filter keys…', 'تصفية المفاتيح…')} value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 sm:max-w-xs" />
        <Table head={[tx('Key', 'المفتاح'), tx('Preview', 'معاينة'), tx('Fallback', 'البديل'), tx('Custom emoji ID', 'رقم الإيموجي المخصص'), '']}>
          {items.map((e) => <EmojiRow key={`${e.key}:${e.fallback}:${e.custom_emoji_id}`} e={e} owner={owner} inbox={inbox.data?.items ?? []} />)}
        </Table>
        {!premium && owner && <div className="mt-3"><Badge tone="gold">{tx('Custom IDs are saved but only used once custom emoji are enabled.', 'الأرقام المخصصة محفوظة لكنها لا تُستخدم إلا بعد تفعيل الإيموجي المخصص.')}</Badge></div>}
      </Card>
    </>
  );
}
