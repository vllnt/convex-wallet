import { v } from "convex/values";

/**
 * Optional per-call time-regen rule, injected by the client from its
 * per-currency config. The component itself is config-less. `max`, when set,
 * is the hard ceiling on stored balance for the currency — credits are clamped
 * to it (see {@link mutations}).
 */
export const regenArg = v.optional(
  v.object({
    amount: v.number(),
    intervalMs: v.number(),
    cap: v.number(),
  }),
);

/**
 * Optional per-currency hard ceiling on the stored balance. A credit that would
 * carry the balance above `max` is clamped to `max`; an `earn`/`grant`/receive
 * leg that is ALREADY at or above `max` is a no-op credit (idempotent ceiling).
 */
export const maxArg = v.optional(v.number());

/** Per-currency regen map for the multi-currency {@link queries.balances} read. */
export const regenMapArg = v.optional(
  v.record(
    v.string(),
    v.object({ amount: v.number(), intervalMs: v.number(), cap: v.number() }),
  ),
);

/** Stable, code-tagged failure reasons. `reason` (free text) is the ledger note. */
export const errorCode = v.union(v.literal("INSUFFICIENT"), v.literal("SELF_TRANSFER"));

/**
 * Result of a spend/transfer that may be rejected. `code` carries a stable
 * machine-readable tag when `ok` is false; it is absent on success.
 */
export const spendResult = v.object({
  ok: v.boolean(),
  balance: v.number(),
  code: v.optional(errorCode),
});

/** A single currency balance in the multi-currency overview. */
export const balanceEntry = v.object({
  currency: v.string(),
  amount: v.number(),
});

/** A ledger row projected for history reads (sandbox fields omitted). */
export const ledgerDoc = v.object({
  currency: v.string(),
  delta: v.number(),
  reason: v.string(),
  idempotencyKey: v.optional(v.string()),
  createdAt: v.number(),
});
