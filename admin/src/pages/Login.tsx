import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { Button, ErrorBox, Input } from '../components/ui';

export function Login({ error }: { error?: string | null }) {
  const { config, signIn, signOut, session, error: cfgError } = useAuth();
  const { t, lang, setLang } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signIn(email.trim(), password);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[680px] -translate-x-1/2 rounded-full bg-gold/10 blur-3xl" />
      <form onSubmit={submit} className="card relative w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src={config?.logoUrl || '/assets/logo.jpg'} alt="" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-gold/40" />
          <div>
            <div className="gold-text text-lg font-bold">{config?.brandName ?? 'Store'}</div>
            <div className="text-xs uppercase tracking-widest text-ink-400">Admin panel</div>
          </div>
        </div>
        {!config && cfgError && <div className="mb-4"><ErrorBox error={cfgError} /></div>}
        {session && error && (
          <div className="mb-4 space-y-2">
            <ErrorBox error={error} />
            <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()}>Use another account</Button>
          </div>
        )}
        <label className="label">{t('email')}</label>
        <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className="mb-3" />
        <label className="label">{t('password')}</label>
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mb-4" />
        {err && <div className="mb-3"><ErrorBox error={err} /></div>}
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!config}>{t('signin')}</Button>
        <button type="button" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} className="mt-4 w-full text-center text-xs text-ink-400 hover:text-white">{t('language')}</button>
      </form>
    </div>
  );
}
