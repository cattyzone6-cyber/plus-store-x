import type { DeliveryKind, ProviderRow, Requirements } from '../types';

/**
 * Every supplier API is wrapped in an adapter implementing this interface.
 * Add a new provider type = add one file + register it in providers/registry.ts.
 * All money values returned by adapters are USD (adapters convert if needed).
 */

export interface ProviderCredentials {
  api_key: string;
  [k: string]: string;
}

/** Runtime context handed to an adapter. */
export interface ProviderContext {
  row: ProviderRow;
  credentials: ProviderCredentials;
  /** adapter specific options from providers.config */
  config: Record<string, unknown>;
}

export interface NormalizedProduct {
  external_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  emoji: string | null;
  delivery_kind: DeliveryKind;
  raw_type: string | null;
  cost: number | null;          // USD per unit
  cost_original: number | null; // provider currency per unit
  cost_currency: string;
  stock: number | null;         // null = unlimited / unknown
  sold: number | null;
  warranty_days: number | null;
  requirements: Requirements;
  price_tiers: { min_qty: number; max_qty?: number | null; price: number }[] | null;
  promotions: unknown[] | null;
  raw: unknown;
}

export interface BalanceInfo {
  balance: number;   // in `currency`
  currency: string;  // 'USD' normally
  balance_usd: number;
}

export interface PurchaseRequest {
  external_id: string;
  quantity: number;
  /** our idempotency key (stable per order attempt) */
  idempotency_key: string;
  /** our order code, sent as customer reference when supported */
  reference: string;
  /** customer inputs keyed by RequirementField.key: email, account (string[] when per_unit), identifier, months */
  inputs: Record<string, unknown>;
}

export type PurchaseStatus = 'completed' | 'pending' | 'failed';

export interface PurchaseResult {
  status: PurchaseStatus;
  /** provider order reference to poll later */
  provider_order_ref: string | null;
  provider_status: string | null;
  /** delivered items, one string per unit (credentials, codes, links) */
  items: string[];
  /** amount charged by the provider in USD, if known */
  cost_usd: number | null;
  /** human readable reason when failed */
  error?: string;
  /**
   * true when it is safe to try another source (nothing was charged: out of stock,
   * insufficient provider balance, product removed...). false when the outcome is
   * unknown (timeout) — then the order must not be re-routed automatically.
   */
  retryable?: boolean;
  raw: unknown;
}

export interface ProviderAdapter {
  kind: string;
  label: string;
  /** default base URL suggested in the admin panel */
  defaultBaseUrl: string;
  /** credential fields shown in the admin panel */
  credentialFields: { key: string; label: string; secret: boolean }[];

  /** check credentials + read wallet */
  getBalance(ctx: ProviderContext): Promise<BalanceInfo>;
  /** full catalog, normalized */
  listProducts(ctx: ProviderContext): Promise<NormalizedProduct[]>;
  /** place an order (must be idempotent on idempotency_key) */
  purchase(ctx: ProviderContext, req: PurchaseRequest): Promise<PurchaseResult>;
  /** re-read an order that was 'pending' */
  getOrder(ctx: ProviderContext, providerOrderRef: string, req?: Partial<PurchaseRequest>): Promise<PurchaseResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryAfterSec?: number,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}
