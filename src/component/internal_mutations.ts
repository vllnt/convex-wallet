import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

/** Hard cap on rows touched per sweep invocation — keeps each run bounded. */
const PRUNE_BATCH = 256;

/**
 * Idempotent retention + idempotency sweep, driven by the component's own cron
 * (see {@link crons}). One bounded batch of at most `PRUNE_BATCH` rows per call:
 *
 * 1. Delete `ledger` rows older than `retentionMs` (oldest-first).
 * 2. With the rest of the batch, clear `idempotencyKey` on rows older than
 *    `idempotencyTtlMs` so the key is forgotten and may be reused — the
 *    idempotency window. Only rows that may still hold a key are read
 *    (`by_no_key_created`, `noKey` absent); each is marked `noKey: true`, so it
 *    leaves that range and the next batch reaches newer rows.
 *
 * A call that fills its batch schedules an immediate continuation, so any
 * backlog drains in one sweep. At-least-once safe: deleting an already-gone
 * row and clearing an already-clear key are both no-ops, so a redelivered run
 * converges to the same state. Returns counts for observability/testing;
 * `expired` counts cleared keys only.
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
      await ctx.db.delete("ledger", row._id);
    }

    let expired = 0;
    let visited = 0;
    if (oldest.length < PRUNE_BATCH) {
      const stale = await ctx.db
        .query("ledger")
        .withIndex("by_no_key_created", (q) =>
          q
            .eq("noKey", undefined)
            .gte("createdAt", deleteBefore)
            .lt("createdAt", expireBefore),
        )
        .order("asc")
        .take(PRUNE_BATCH - oldest.length);
      for (const row of stale) {
        if (row.idempotencyKey !== undefined) {
          expired += 1;
        }
        await ctx.db.patch("ledger", row._id, { idempotencyKey: undefined, noKey: true });
      }
      visited = stale.length;
    }

    if (oldest.length + visited === PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.internal_mutations.pruneLedger, args);
    }

    return { deleted: oldest.length, expired };
  },
});
