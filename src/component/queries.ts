import { v } from "convex/values";
import { query } from "./_generated/server";
import { applyRegen } from "../shared";
import { balanceEntry, ledgerDoc, regenArg, regenMapArg } from "./validators";

/**
 * Regen-aware single-currency read. Projects the stored balance forward to the
 * server clock under the per-currency `regen` (compute-only — queries cannot
 * write, so the regen is reflected in the result but not persisted). Missing → 0.
 */
export const balance = query({
  args: {
    subjectRef: v.string(),
    currency: v.string(),
    regen: regenArg,
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await ctx.db
      .query("balances")
      .withIndex("by_subject_currency", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("currency", args.currency),
      )
      .unique();
    if (row === null) {
      return 0;
    }
    return applyRegen(row.amount, row.lastRegenAt, now, args.regen).amount;
  },
});

/**
 * Multi-currency overview for `subjectRef`, regen-aware. The client passes its
 * per-currency `regen` map so each row is projected exactly as {@link balance}
 * would — no stale divergence. A currency absent from the map is static.
 */
export const balances = query({
  args: { subjectRef: v.string(), regen: regenMapArg },
  returns: v.array(balanceEntry),
  handler: async (ctx, args) => {
    const now = Date.now();
    const regenMap = args.regen ?? {};
    const rows = await ctx.db
      .query("balances")
      .withIndex("by_subject_currency", (q) => q.eq("subjectRef", args.subjectRef))
      .collect();
    return rows.map((row) => ({
      currency: row.currency,
      amount: applyRegen(row.amount, row.lastRegenAt, now, regenMap[row.currency])
        .amount,
    }));
  },
});

/** Newest-first ledger entries for one currency, capped at `limit`. */
export const history = query({
  args: { subjectRef: v.string(), currency: v.string(), limit: v.number() },
  returns: v.array(ledgerDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ledger")
      .withIndex("by_subject_currency", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("currency", args.currency),
      )
      .order("desc")
      .take(args.limit);
    return rows.map((row) => ({
      currency: row.currency,
      delta: row.delta,
      reason: row.reason,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
    }));
  },
});
