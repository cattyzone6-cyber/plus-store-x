import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, initSupabase, loadConfig, setSession, type PublicConfig } from './api';

export interface Admin {
  user_id: string;
  email: string;
  role: 'owner' | 'support';
  telegram_id: number | null;
  display_name: string | null;
}

interface AuthState {
  config: PublicConfig | null;
  session: Session | null;
  admin: Admin | null;
  ready: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reloadAdmin: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [session, setSess] = useState<Session | null>(null);
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadAdmin = async () => {
    try {
      const r = await api<{ admin: Admin }>('/me');
      setAdmin(r.admin);
      setError(null);
    } catch (e) {
      setAdmin(null);
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const cfg = await loadConfig();
        setConfig(cfg);
        document.title = `${cfg.brandName} — Admin`;
        const sb = initSupabase(cfg);
        const { data } = await sb.auth.getSession();
        setSession(data.session);
        setSess(data.session);
        if (data.session) await reloadAdmin();
        const sub = sb.auth.onAuthStateChange(async (_evt, s) => {
          setSession(s);
          setSess(s);
          if (!s) setAdmin(null);
        });
        unsub = () => sub.data.subscription.unsubscribe();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReady(true);
      }
    })();
    return () => unsub?.();
  }, []);

  const signIn = async (email: string, password: string) => {
    const sb = initSupabase(config!);
    const { data, error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) throw err;
    setSession(data.session);
    setSess(data.session);
    await reloadAdmin();
  };

  const signOut = async () => {
    const sb = initSupabase(config!);
    await sb.auth.signOut();
    setSession(null);
    setSess(null);
    setAdmin(null);
  };

  return <Ctx.Provider value={{ config, session, admin, ready, error, signIn, signOut, reloadAdmin }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
