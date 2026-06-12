import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Hard cap on rows touched per sweep invocation — keeps each run bounded. */
const PRUNE_BATCH = 256;

/**
 * Idempotent retention + idempotency sweep, driven by the component's own cron
 * (see {@link crons}). One bounded batch per call:
 *
 * 1. Delete `ledger` rows older than `retentionMs` (oldest-first, ≤ `PRUNE_BATCH`).
 * 2. For surviving rows older than `idempotencyTtlMs`, clear `idempotencyKey` so
 *    the key is forgotten and may be reused — the idempotency window.
 *
 * At-least-once safe: deleting an already-gone row and clearing an already-clear
 * key are both no-ops, so a redelivered run converges to the same state. Returns
 * counts for observability/testing.
 */
export const pruneLedger = internalMutation({
  args: {
    retentionMs: v.number(),
    idempotencyTtlMs: v.number(),
  },
  returns: v.object({ deleted: v.number(), expired: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const deleteBefore = now - args.retentionMs;
    const expireBefore = now - args.idempotencyTtlMs;

    const oldest = await ctx.db
      .query("ledger")
      .withIndex("by_created", (q) => q.lt("createdAt", deleteBefore))
      .order("asc")
      .take(PRUNE_BATCH);
    for (const row of oldest) {
      await ctx.db.delete(row._id);
    }

    let expired = 0;
    if (oldest.length < PRUNE_BATCH) {
      const stale = await ctx.db
        .query("ledger")
        .withIndex("by_created", (q) =>
          q.gte("createdAt", deleteBefore).lt("createdAt", expireBefore),
        )
        .order("asc")
        .take(PRUNE_BATCH - oldest.length);
      for (const row of stale) {
        if (row.idempotencyKey !== undefined) {
          await ctx.db.patch(row._id, { idempotencyKey: undefined });
          expired += 1;
        }
      }
    }

    return { deleted: oldest.length, expired };
  },
});
