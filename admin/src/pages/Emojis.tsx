import { useState } from 'react';
import { Trash2, Info } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi, useIsOwner } from '../lib/hooks';
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
  const [fallback, setFallback] = useState(e.fallback);
  const [cid, setCid] = useState(e.custom_emoji_id ?? '');
  const { run, busy } = useAction();
  const dirty = fallback !== e.fallback || cid !== (e.custom_emoji_id ?? '');
  return (
    <tr>
      <td className="td"><code className="text-xs">{e.key}</code></td>
      <td className="td"><Preview id={e.custom_emoji_id} fallback={e.fallback} /></td>
      <td className="td w-24"><Input value={fallback} disabled={!owner} onChange={(x) => setFallback(x.target.value)} className="!py-1 text-center" /></td>
      <td className="td">
        <div className="flex gap-2">
          <Input value={cid} disabled={!owner} placeholder="custom emoji id" onChange={(x) => setCid(x.target.value.replace(/\D/g, ''))} className="!py-1 font-mono text-xs" />
          {owner && inbox.length > 0 && (
            <Select className="!w-28 !py-1 text-xs" value="" onChange={(x) => x.target.value && setCid(x.target.value)} options={[{ value: '', label: 'from inbox' }, ...inbox.map((i) => ({ value: i.custom_emoji_id, label: `${i.fallback ?? ''} ${i.custom_emoji_id.slice(-6)}` }))]} />
          )}
        </div>
      </td>
      <td className="td text-end">
        {owner && dirty && <Button size="sm" variant="primary" loading={busy === 'save'} onClick={() => void run('save', () => api(`/emojis/${e.key}`, { method: 'PUT', body: { fallback: fallback || e.default_fallback, custom_emoji_id: cid || null } }), { success: 'Saved', invalidate: ['/emojis'] })}>Save</Button>}
      </td>
    </tr>
  );
}

export default function Emojis() {
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
      <PageHeader title="Emoji library" sub="Every emoji the bot uses. With Telegram Premium you can swap any of them for an animated custom emoji." />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Premium custom emoji" className="lg:col-span-2">
          <div className="flex items-start gap-3 text-sm text-ink-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <div className="space-y-1">
              <p>Telegram only shows custom emoji from bots whose <b>BotFather owner has Telegram Premium</b>. Without it, the plain fallback emoji are used.</p>
              <p>To capture IDs: link your Telegram ID in Admins, then send <code>/emoji</code> to the bot followed by a message containing your custom emoji. They appear in the inbox below.</p>
            </div>
          </div>
          {owner && (
            <div className="mt-3">
              <Switch checked={premium} onChange={(v) => void run('premium', () => api('/settings/bot', { method: 'PUT', body: { ...settings.data!.settings.bot, premium_emoji: v } }), { success: v ? 'Custom emoji enabled' : 'Using plain emoji', invalidate: ['/settings'] })}
                label={premium ? 'Custom emoji enabled' : 'Custom emoji disabled (plain emoji)'} />
            </div>
          )}
        </Card>
        <Card title={`Inbox (${inbox.data?.items.length ?? 0})`}>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {(inbox.data?.items ?? []).length === 0 && <p className="text-sm text-ink-400">Send custom emoji to the bot after /emoji.</p>}
            {(inbox.data?.items ?? []).map((i) => (
              <div key={i.custom_emoji_id} className="flex items-center gap-2 text-xs">
                <Preview id={i.custom_emoji_id} fallback={i.fallback ?? '⭐'} />
                <code className="flex-1 cursor-pointer truncate hover:text-gold" title="Copy" onClick={() => void navigator.clipboard.writeText(i.custom_emoji_id)}>{i.custom_emoji_id}</code>
                <span className="text-ink-400">{dt(i.created_at)}</span>
                <button onClick={() => void run('del', () => api(`/emoji-inbox/${i.custom_emoji_id}`, { method: 'DELETE' }), { invalidate: ['/emoji-inbox'] })} className="text-ink-400 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <Input placeholder="Filter keys…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 max-w-xs" />
        <Table head={['Key', 'Preview', 'Fallback', 'Custom emoji ID', '']}>
          {items.map((e) => <EmojiRow key={`${e.key}:${e.fallback}:${e.custom_emoji_id}`} e={e} owner={owner} inbox={inbox.data?.items ?? []} />)}
        </Table>
        {!premium && owner && <div className="mt-3"><Badge tone="gold">Custom IDs are saved but only used once custom emoji are enabled.</Badge></div>}
      </Card>
    </>
  );
}
