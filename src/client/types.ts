/** Public TypeScript surface for the wallet client. */

import type { ErrorCode, RegenConfig } from "../shared.js";

export type { ErrorCode, RegenConfig };

/**
 * Result of a spend/transfer that may be rejected. `code` is a stable,
 * machine-readable failure tag, present only when `ok` is false.
 */
export interface SpendResult {
  ok: boolean;
  balance: number;
  /** Stable failure tag when `ok` is false: `INSUFFICIENT` | `SELF_TRANSFER`. */
  code?: ErrorCode;
}

/** A single currency balance in the multi-currency overview. */
export interface BalanceEntry {
  currency: string;
  amount: number;
}

/** A ledger row as returned by {@link Wallet.history}. */
export interface LedgerEntry {
  currency: string;
  /** Signed change: positive on earn/receive, negative on spend/send. */
  delta: number;
  reason: string;
  idempotencyKey?: string;
  createdAt: number;
}

/**
 * Per-currency configuration. Omit `regen` for static (coin/gem) currencies.
 * `max` is an optional hard ceiling on the stored balance for this currency —
 * credits are clamped to it.
 */
export interface CurrencyConfig {
  regen?: RegenConfig;
  /** Hard cap on the stored balance for this currency. Credits clamp to it. */
  max?: number;
}

/** Construction options for the {@link Wallet} client. */
export interface WalletOptions {
  /** Per-currency rules, keyed by the opaque currency string. */
  currencies?: Record<string, CurrencyConfig>;
  /** Default page size for {@link Wallet.history}. Default `50`. */
  defaultHistoryLimit?: number;
}
