// Small WebCrypto helpers (Workers runtime).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function aesKey(secretB64: string): Promise<CryptoKey> {
  let k = keyCache.get(secretB64);
  if (!k) {
    const raw = b64decode(secretB64);
    if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded');
    k = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keyCache.set(secretB64, k);
  }
  return k;
}

/** AES-256-GCM encrypt → "v1:<iv b64>:<ciphertext b64>" */
export async function encrypt(plain: string, secretB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secretB64), enc.encode(plain));
  return `v1:${b64encode(iv)}:${b64encode(ct)}`;
}

export async function decrypt(payload: string, secretB64: string): Promise<string> {
  const [v, ivB64, ctB64] = payload.split(':');
  if (v !== 'v1' || !ivB64 || !ctB64) throw new Error('Bad encrypted payload');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(ivB64) }, await aesKey(secretB64), b64decode(ctB64));
  return dec.decode(pt);
}

export async function encryptJson(value: unknown, secretB64: string): Promise<string> {
  return encrypt(JSON.stringify(value), secretB64);
}

export async function decryptJson<T>(payload: string | null | undefined, secretB64: string): Promise<T | null> {
  if (!payload) return null;
  return JSON.parse(await decrypt(payload, secretB64)) as T;
}

async function hmac(algo: 'SHA-256' | 'SHA-512', key: string | Uint8Array, data: string | Uint8Array): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: algo }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, typeof data === 'string' ? enc.encode(data) : data);
}

export async function hmacSha256Hex(key: string, data: string): Promise<string> {
  return hex(await hmac('SHA-256', key, data));
}

export async function hmacSha512Hex(key: string, data: string): Promise<string> {
  return hex(await hmac('SHA-512', key, data));
}

export async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Random human-friendly code (no 0/O/1/I). */
export function randomCode(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function randomToken(bytes = 24): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Mask a secret for display: "abcd…wxyz". */
export function mask(secret: string | null | undefined): string {
  if (!secret) return '';
  if (secret.length <= 8) return '•'.repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
