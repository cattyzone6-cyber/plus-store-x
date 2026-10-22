import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useTx } from './lib/i18n';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Login } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Providers = lazy(() => import('./pages/Providers'));
const ProviderCatalog = lazy(() => import('./pages/ProviderCatalog'));
const Catalog = lazy(() => import('./pages/Catalog'));
const Categories = lazy(() => import('./pages/Categories'));
const Products = lazy(() => import('./pages/Products'));
const ProductEditor = lazy(() => import('./pages/ProductEditor'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const Deposits = lazy(() => import('./pages/Deposits'));
const Users = lazy(() => import('./pages/Users'));
const UserDetail = lazy(() => import('./pages/UserDetail'));
const Tickets = lazy(() => import('./pages/Tickets'));
const Marketing = lazy(() => import('./pages/Marketing'));
const Broadcasts = lazy(() => import('./pages/Broadcasts'));
const Emojis = lazy(() => import('./pages/Emojis'));
const Settings = lazy(() => import('./pages/Settings'));
const Admins = lazy(() => import('./pages/Admins'));
const System = lazy(() => import('./pages/System'));

function OwnerOnly({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  const tx = useTx();
  if (admin?.role !== 'owner') return <div className="card p-6 text-sm text-ink-400">{tx('Only the store owner can open this page.', 'هذه الصفحة لمالك المتجر فقط.')}</div>;
  return <>{children}</>;
}

export function App() {
  const { ready, session, admin, error } = useAuth();
  if (!ready) return <Loading />;
  if (!session || !admin) return <Login error={session && !admin ? error : null} />;

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="providers" element={<OwnerOnly><Providers /></OwnerOnly>} />
          <Route path="providers/:id" element={<OwnerOnly><ProviderCatalog /></OwnerOnly>} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="categories" element={<Categories />} />
          <Route path="products" element={<Products />} />
          <Route path="products/:id" element={<ProductEditor />} />
          <Route path="orders" element={<Orders />} />
          <Route path="manual" element={<Orders manual />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="deposits" element={<Deposits />} />
          <Route path="users" element={<Users />} />
          <Route path="users/:id" element={<UserDetail />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="promos" element={<OwnerOnly><Marketing kind="promos" /></OwnerOnly>} />
          <Route path="redeem" element={<OwnerOnly><Marketing kind="redeem" /></OwnerOnly>} />
          <Route path="giveaways" element={<OwnerOnly><Marketing kind="giveaways" /></OwnerOnly>} />
          <Route path="freebies" element={<OwnerOnly><Marketing kind="freebies" /></OwnerOnly>} />
          <Route path="broadcasts" element={<OwnerOnly><Broadcasts /></OwnerOnly>} />
          <Route path="emojis" element={<Emojis />} />
          <Route path="settings" element={<OwnerOnly><Settings /></OwnerOnly>} />
          <Route path="settings/:section" element={<OwnerOnly><Settings /></OwnerOnly>} />
          <Route path="admins" element={<OwnerOnly><Admins /></OwnerOnly>} />
          <Route path="system" element={<OwnerOnly><System /></OwnerOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
