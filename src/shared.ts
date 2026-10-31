import { ConvexError } from "convex/values";

/** Shared constants + pure utilities used by both `client/` and `component/`. */

export const COMPONENT_NAME = "wallet";

/** Default newest-first page size for {@link history} when the caller omits one. */
export const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Default ledger retention: rows older than this are pruned by the internal
 * cron. 90 days. Override per mount via {@link WalletOptions.ledgerRetentionMs}.
 */
export const DEFAULT_LEDGER_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Default idempotency window: a recorded `idempotencyKey` is honored (replays
 * are no-ops) for this long; afterwards the cron forgets it so the key can be
 * reused. 7 days. Override via {@link WalletOptions.idempotencyTtlMs}.
 */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Default cron cadence for the ledger/idempotency prune sweep. 1 hour. */
export const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Stable, code-tagged failure reasons returned on the `code` field of a result. */
export const ERROR_CODES = {
  /** A spend/transfer was short of funds. */
  INSUFFICIENT: "INSUFFICIENT",
  /** A transfer named the same subject as sender and receiver. */
  SELF_TRANSFER: "SELF_TRANSFER",
} as const;

/**
 * Thrown by {@link applyRegen} when a regen config has a non-finite or
 * non-positive field. Carries the stable `INVALID_REGEN` code so hosts can
 * branch without string-matching prose.
 */
export const INVALID_REGEN = "INVALID_REGEN";

/** A non-throwing result failure tag. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Thrown by {@link assertPositiveAmount} when an amount is non-finite or not
 * strictly positive. Carries the stable `INVALID_AMOUNT` code so hosts can
 * branch on `error.message` without string-matching prose.
 */
export const INVALID_AMOUNT = "INVALID_AMOUNT";

/** Opaque host-supplied subject reference. Never assume its shape or source. */
export type SubjectRef = string;

/**
 * Time-regen rule for an energy-style currency: gain `amount` units every
 * `intervalMs`, never exceeding `cap`. Coin/gem-style currencies omit it.
 */
export interface RegenConfig {
  amount: number;
  intervalMs: number;
  cap: number;
}

/**
 * Thrown (as a `ConvexError` with `data.code`) when a required string argument
 * (`subjectRef`, `currency`, `reason`, `idempotencyKey`) is empty.
 */
export const INVALID_ARGUMENT = "INVALID_ARGUMENT";

/** Thrown when a per-currency `max` ceiling is `NaN` or negative. */
export const INVALID_MAX = "INVALID_MAX";

/**
 * Thrown when a credit would push a balance (or lifetime counter) past
 * `Number.MAX_SAFE_INTEGER` (2^53 - 1), where doubles stop being exact.
 */
export const BALANCE_OVERFLOW = "BALANCE_OVERFLOW";

/**
 * Thrown when an `idempotencyKey` already recorded for a `(subjectRef,
 * currency)` by a credit is reused on a debit, or the reverse. Silently
 * treating it as a replay would drop the second operation.
 */
export const IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED";

/** Throw a `ConvexError` carrying a stable `code` (same shape as `INVALID_LIMIT`). */
export function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** Reject an empty string for a required argument. Throws `INVALID_ARGUMENT`. */
export function assertNonEmpty(name: string, value: string): void {
  if (value === "") {
    fail(INVALID_ARGUMENT, `${name} must not be empty`);
  }
}

/** Reject a `NaN` or negative per-currency `max`. Throws `INVALID_MAX`. */
export function assertValidMax(max: number | undefined): void {
  if (max !== undefined && (Number.isNaN(max) || max < 0)) {
    fail(INVALID_MAX, "max must be a number >= 0");
  }
}

/** Reject a balance/counter above 2^53 - 1. Throws `BALANCE_OVERFLOW`. */
export function assertSafeBalance(value: number): void {
  if (value > Number.MAX_SAFE_INTEGER) {
    fail(BALANCE_OVERFLOW, "balance would exceed Number.MAX_SAFE_INTEGER");
  }
}

/**
 * Guard every value-moving entry point. Rejects non-finite (`NaN`, `Infinity`),
 * non-positive (`0`, negative) and above-`Number.MAX_SAFE_INTEGER` amounts - a
 * negative `spend` would otherwise MINT funds, `NaN` would corrupt a balance,
 * and past 2^53 doubles silently lose precision. Throws `INVALID_AMOUNT`.
 * Fractional amounts are accepted; hosts should use integer minor units.
 *
 * @param amount - the caller-supplied amount to credit or debit.
 * @throws when `amount` is not a finite number in `(0, 2^53 - 1]`.
 */
export function assertPositiveAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER) {
    throw new Error(INVALID_AMOUNT);
  }
}

/**
 * Pure, deterministic lazy regen. Given a `stored` balance last touched at
 * `lastRegenAt`, project it forward to `now` under `regen`.
 *
 * - No `regen` → unchanged `{ amount: stored, lastRegenAt }`.
 * - Backwards/equal clock (`now <= lastRegenAt`) → unchanged: the pointer is
 *   never moved backward and never advanced past `now`, so a host that supplies
 *   a stale/rewound clock can never over-regen or rewind accrual.
 * - `ticks = floor((now - lastRegenAt) / intervalMs)`; zero ticks → unchanged
 *   (the clock pointer does not advance until a whole tick elapses).
 * - Otherwise grant `ticks * amount`, clamped to `cap` (never above `cap`,
 *   never below `stored`), and advance `lastRegenAt` by exactly the ticks
 *   consumed so partial-interval progress is preserved. Because
 *   `lastRegenAt + ticks * intervalMs <= now`, the pointer never passes `now`.
 *
 * @param stored - the persisted balance.
 * @param lastRegenAt - epoch ms the balance was last reconciled.
 * @param now - current epoch ms (read server-side via `Date.now()`).
 * @param regen - optional regen rule; when absent the balance is static.
 * @returns the projected `{ amount, lastRegenAt }`.
 */
export function applyRegen(
  stored: number,
  lastRegenAt: number,
  now: number,
  regen?: RegenConfig,
): { amount: number; lastRegenAt: number } {
  if (regen === undefined || now <= lastRegenAt) {
    return { amount: stored, lastRegenAt };
  }
  if (
    !Number.isFinite(regen.intervalMs) ||
    regen.intervalMs <= 0 ||
    !Number.isFinite(regen.amount) ||
    regen.amount <= 0 ||
    !Number.isFinite(regen.cap) ||
    regen.cap <= 0
  ) {
    throw new Error(INVALID_REGEN);
  }
  const ticks = Math.floor((now - lastRegenAt) / regen.intervalMs);
  return ticks === 0
    ? { amount: stored, lastRegenAt }
    : {
        amount: Math.max(stored, Math.min(regen.cap, stored + ticks * regen.amount)),
        lastRegenAt: lastRegenAt + ticks * regen.intervalMs,
      };
}
