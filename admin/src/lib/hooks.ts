import { useCallback, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from './api';
import { useToast } from '../components/ui';
import { useAuth } from './auth';

/** GET an admin API path with react-query (key = path). */
export function useApi<T = Record<string, unknown>>(path: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api<T>(path!),
    enabled: !!path,
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval,
  });
}

/**
 * Run a mutation with a toast + cache invalidation.
 * `invalidate` are path prefixes whose queries are refetched afterwards.
 */
export function useAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, opts: { success?: string; invalidate?: string[] } = {}): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (opts.success) toast(opts.success);
        const prefixes = opts.invalidate ?? [];
        await qc.invalidateQueries({
          predicate: (q) => {
            const k = String(q.queryKey[0] ?? '');
            return prefixes.length === 0 || prefixes.some((p) => k.startsWith(p));
          },
        });
        return r;
      } catch (e) {
        toast((e as Error).message, 'err');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [qc, toast],
  );
  return { run, busy };
}

export function useIsOwner(): boolean {
  return useAuth().admin?.role === 'owner';
}

export interface Paged<T> {
  ok: boolean;
  total: number;
  page: number;
  limit: number;
  items: T[];
}
