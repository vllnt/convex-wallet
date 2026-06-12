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
 * Guard every value-moving entry point. Rejects non-finite (`NaN`, `Infinity`)
 * and non-positive (`0`, negative) amounts — a negative `spend` would otherwise
 * MINT funds, and `NaN` would corrupt a balance. Throws `INVALID_AMOUNT`.
 *
 * @param amount - the caller-supplied amount to credit or debit.
 * @throws when `amount` is not a finite number `> 0`.
 */
export function assertPositiveAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
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
  const ticks = Math.floor((now - lastRegenAt) / regen.intervalMs);
  if (ticks === 0) {
    return { amount: stored, lastRegenAt };
  }
  const amount = Math.min(regen.cap, stored + ticks * regen.amount);
  return { amount, lastRegenAt: lastRegenAt + ticks * regen.intervalMs };
}
