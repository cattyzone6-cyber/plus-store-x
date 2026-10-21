import type { Env } from '../env';
import type { ProviderRow } from '../types';
import type { ProviderAdapter, ProviderContext, ProviderCredentials } from './types';
import { decryptJson } from '../lib/crypto';
import { ventebot } from './ventebot';
import { canboso } from './canboso';

/** All provider types the store knows. Add new adapters here. */
export const ADAPTERS: Record<string, ProviderAdapter> = {
  [ventebot.kind]: ventebot,
  [canboso.kind]: canboso,
};

export function getAdapter(kind: string): ProviderAdapter {
  const a = ADAPTERS[kind];
  if (!a) throw new Error(`Unknown provider kind: ${kind}`);
  return a;
}

export async function providerContext(env: Env, row: ProviderRow): Promise<ProviderContext> {
  const credentials = (await decryptJson<ProviderCredentials>(row.credentials_enc, env.ENCRYPTION_KEY)) ?? { api_key: '' };
  return { row, credentials, config: row.config ?? {} };
}
