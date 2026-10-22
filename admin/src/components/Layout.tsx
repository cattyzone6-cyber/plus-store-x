import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, LayoutGrid, Server, FolderTree, Package, ShoppingCart, Hand, Wallet, Users, LifeBuoy, TicketPercent, Gift,
  PartyPopper, Sparkles, Megaphone, Smile, Settings, ShieldCheck, Cpu, Menu, X, LogOut, Languages, ExternalLink,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useT, type UiKey } from '../lib/i18n';
import { useApi } from '../lib/hooks';
import { cx } from './ui';

interface NavItem { to: string; key: UiKey; icon: ReactNode; owner?: boolean; badge?: number }

export function Layout() {
  const { admin, config, signOut } = useAuth();
  const { t, tx, lang, setLang } = useT();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const dash = useApi<{ overview: Record<string, number> }>('/dashboard', { refetchInterval: 60_000 });
  const ov = dash.data?.overview ?? {};
  const isOwner = admin?.role === 'owner';

  const groups: { title: UiKey; items: NavItem[] }[] = [
    { title: 'store', items: [
      { to: '/', key: 'dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
      { to: '/providers', key: 'providers', icon: <Server className="h-4 w-4" />, owner: true, badge: ov.new_provider_products },
      { to: '/catalog', key: 'catalog', icon: <LayoutGrid className="h-4 w-4" /> },
      { to: '/categories', key: 'categories', icon: <FolderTree className="h-4 w-4" /> },
      { to: '/products', key: 'products', icon: <Package className="h-4 w-4" /> },
    ] },
    { title: 'sales', items: [
      { to: '/orders', key: 'orders', icon: <ShoppingCart className="h-4 w-4" /> },
      { to: '/manual', key: 'manual', icon: <Hand className="h-4 w-4" />, badge: (ov.manual_orders ?? 0) + (ov.failed_orders ?? 0) },
      { to: '/deposits', key: 'deposits', icon: <Wallet className="h-4 w-4" />, badge: ov.deposits_review },
    ] },
    { title: 'customers', items: [
      { to: '/users', key: 'users', icon: <Users className="h-4 w-4" /> },
      { to: '/tickets', key: 'tickets', icon: <LifeBuoy className="h-4 w-4" />, badge: ov.open_tickets },
    ] },
    { title: 'marketing', items: [
      { to: '/promos', key: 'promos', icon: <TicketPercent className="h-4 w-4" />, owner: true },
      { to: '/redeem', key: 'redeem', icon: <Gift className="h-4 w-4" />, owner: true },
      { to: '/giveaways', key: 'giveaways', icon: <PartyPopper className="h-4 w-4" />, owner: true },
      { to: '/freebies', key: 'freebies', icon: <Sparkles className="h-4 w-4" />, owner: true },
      { to: '/broadcasts', key: 'broadcasts', icon: <Megaphone className="h-4 w-4" />, owner: true },
    ] },
    { title: 'settings', items: [
      { to: '/emojis', key: 'emojis', icon: <Smile className="h-4 w-4" /> },
      { to: '/settings', key: 'settings', icon: <Settings className="h-4 w-4" />, owner: true },
      { to: '/admins', key: 'admins', icon: <ShieldCheck className="h-4 w-4" />, owner: true },
      { to: '/system', key: 'system', icon: <Cpu className="h-4 w-4" />, owner: true },
    ] },
  ];

  // title of the current page for the phone top bar
  const section = '/' + (loc.pathname.split('/')[1] ?? '');
  const current = groups.flatMap((g) => g.items).find((i) => (i.to === '/' ? section === '/' : section === i.to))?.key;

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
      {groups.map((g) => {
        const items = g.items.filter((i) => !i.owner || isOwner);
        if (!items.length) return null;
        return (
          <div key={g.title}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-ink-400">{t(g.title)}</div>
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) => cx(
                  'flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition lg:min-h-0 lg:py-1.5',
                  isActive ? 'bg-gold/10 text-gold' : 'text-ink-300 hover:bg-ink-800 hover:text-white',
                )}
              >
                {i.icon}
                <span className="flex-1">{t(i.key)}</span>
                {!!i.badge && <span className="rounded-full bg-gold px-1.5 text-[10px] font-bold text-black">{i.badge}</span>}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <img src={config?.logoUrl || '/assets/logo.jpg'} alt="" className="h-9 w-9 rounded-lg object-cover ring-1 ring-gold/30" />
      <div className="min-w-0">
        <div className="gold-text truncate text-sm font-bold">{config?.brandName ?? 'Store'}</div>
        <div className="text-[10px] uppercase tracking-widest text-ink-400">{t('admin')}</div>
      </div>
    </div>
  );

  const footer = (
    <div className="border-t border-ink-700 p-3 text-xs">
      <div className="mb-2 truncate px-2 text-ink-400" title={admin?.email}><span dir="ltr">{admin?.email}</span> · <span className="text-gold">{admin?.role === 'owner' ? t('owner') : t('support')}</span></div>
      <div className="flex gap-1">
        <a href="/" target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-ink-300 hover:bg-ink-800"><ExternalLink className="h-3.5 w-3.5" /> {t('site')}</a>
        <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-ink-300 hover:bg-ink-800"><Languages className="h-3.5 w-3.5" /> {t('language')}</button>
        <button onClick={() => void signOut()} title={t('signout')} aria-label={t('signout')} className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-ink-300 hover:bg-ink-800"><LogOut className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-e border-ink-700 bg-ink-900 lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-72 max-w-[85vw] flex-col border-e border-ink-700 bg-ink-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pe-2">{brand}<button onClick={() => setOpen(false)} aria-label={tx('Close', 'إغلاق')} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-ink-800"><X className="h-5 w-5" /></button></div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-ink-700 bg-ink-900/95 px-2 py-1.5 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} aria-label={t('menu')} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-ink-800"><Menu className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1 truncate font-semibold">{current ? t(current) : <span className="gold-text">{config?.brandName}</span>}</div>
          <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} className="flex h-10 items-center gap-1 rounded-lg px-2.5 text-xs text-ink-300 hover:bg-ink-800"><Languages className="h-4 w-4" /> {t('language')}</button>
        </header>
        <main key={loc.pathname.split('/')[1]} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
