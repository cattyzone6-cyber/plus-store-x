import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { currentLang } from './i18n';

export interface PublicConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  brandName: string;
  logoUrl: string;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let supabase: SupabaseClient | null = null;
let session: Session | null = null;

export async function loadConfig(): Promise<PublicConfig> {
  const res = await fetch('/api/admin/config');
  if (!res.ok) throw new Error(currentLang() === 'ar' ? 'تعذّر الوصول إلى خادم المتجر' : 'Could not reach the store API');
  return (await res.json()) as PublicConfig;
}

export function initSupabase(cfg: PublicConfig): SupabaseClient {
  if (!supabase) {
    supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'store-admin-auth' },
    });
    supabase.auth.onAuthStateChange((_e, s) => {
      session = s;
    });
  }
  return supabase;
}

export function getSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase not initialised');
  return supabase;
}

export function setSession(s: Session | null): void {
  session = s;
}

async function token(): Promise<string | null> {
  if (session && session.expires_at && session.expires_at * 1000 > Date.now() + 30_000) return session.access_token;
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  session = data.session;
  return session?.access_token ?? null;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
}

export async function api<T = Record<string, unknown>>(path: string, opts: ApiOptions = {}): Promise<T> {
  const t = await token();
  const headers: Record<string, string> = {};
  if (t) headers.authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/admin${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    if (res.status === 401 && supabase) void supabase.auth.signOut();
    throw new ApiError(json.error ?? `HTTP ${res.status}`, res.status);
  }
  return json as T;
}

/** Fetch an authenticated binary (images behind auth) as an object URL. */
export async function apiBlobUrl(path: string): Promise<string> {
  const t = await token();
  const res = await fetch(`/api/admin${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return URL.createObjectURL(await res.blob());
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const url = await apiBlobUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await api<{ url: string }>('/upload', { form, method: 'POST' });
  return res.url;
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
