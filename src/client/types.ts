/** Public TypeScript surface for the wallet client. */

import type { ErrorCode, RegenConfig } from "../shared.js";

export type { ErrorCode, RegenConfig };

/**
 * Result of a spend/transfer that may be rejected. `code` is a stable,
 * machine-readable failure tag, present only when `ok` is false.
 */
export interface SpendResult {
  /**
   * `true` when the debit (or transfer) was applied, or when `spend` replayed a
   * recorded `idempotencyKey`.
   */
  ok: boolean;
  /** The subject's (sender's) balance after the call. */
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
 * `max` optionally caps credits for this currency; it does not cap regen
 * (keep `regen.cap` at or below `max`).
 */
export interface CurrencyConfig {
  regen?: RegenConfig;
  /**
   * Credits never raise the balance above `max`. Does not cap regen and never
   * lowers a balance already above it.
   */
  max?: number;
}

/** Construction options for the {@link Wallet} client. */
export interface WalletOptions {
  /** Per-currency rules, keyed by the opaque currency string. */
  currencies?: Record<string, CurrencyConfig>;
  /** Default page size for {@link Wallet.history}. Default `50`. */
  defaultHistoryLimit?: number;
}
