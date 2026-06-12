import { v } from "convex/values";
import type { DataModel } from "./_generated/dataModel";
import type { GenericMutationCtx } from "convex/server";
import { mutation } from "./_generated/server";
import { applyRegen, assertPositiveAmount } from "../shared";
import { maxArg, regenArg, spendResult } from "./validators";

const balanceObject = v.object({ balance: v.number() });

type MutCtx = GenericMutationCtx<DataModel>;

/**
 * Find the prior ledger row for a replayed `idempotencyKey`, scoped to this
 * exact `(subjectRef, currency)`. A key reused across different subjects or
 * currencies is independent — so a legitimate grant is never dropped.
 */
async function findIdempotent(
  ctx: MutCtx,
  subjectRef: string,
  currency: string,
  idempotencyKey: string,
) {
  return ctx.db
    .query("ledger")
    .withIndex("by_idem", (q) =>
      q
        .eq("subjectRef", subjectRef)
        .eq("currency", currency)
        .eq("idempotencyKey", idempotencyKey),
    )
    .first();
}

/** Clamp a post-credit balance to an optional per-currency `max` ceiling. */
function clampToMax(balance: number, max: number | undefined): number {
  return max === undefined ? balance : Math.min(balance, max);
}

/**
 * Credit `amount` of `currency` to `subjectRef`. When `idempotencyKey` is
 * supplied and already recorded for this `(subjectRef, currency)`, this is a
 * no-op replay — the current (regen-aware) balance is returned without
 * double-crediting. A credit that would exceed `max` is clamped to `max`.
 */
export const earn = mutation({
  args: {
    subjectRef: v.string(),
    currency: v.string(),
    amount: v.number(),
    reason: v.string(),
    idempotencyKey: v.optional(v.string()),
    regen: regenArg,
    max: maxArg,
  },
  returns: balanceObject,
  handler: async (ctx, args) => {
    assertPositiveAmount(args.amount);
    const now = Date.now();
    const row = await ctx.db
      .query("balances")
      .withIndex("by_subject_currency", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("currency", args.currency),
      )
      .unique();

    let balance: number;
    if (row === null) {
      // No balance row → no recorded key for it can exist, so the idempotency
      // check is unnecessary: this is always a first credit.
      balance = clampToMax(args.amount, args.max);
      await ctx.db.insert("balances", {
        subjectRef: args.subjectRef,
        currency: args.currency,
        amount: balance,
        lastRegenAt: now,
        lifetimeEarned: balance,
        lifetimeSpent: 0,
      });
    } else {
      if (args.idempotencyKey !== undefined) {
        const seen = await findIdempotent(
          ctx,
          args.subjectRef,
          args.currency,
          args.idempotencyKey,
        );
        if (seen !== null) {
          // Replay: return the current (regen-aware) balance, no double-credit.
          return {
            balance: applyRegen(row.amount, row.lastRegenAt, now, args.regen).amount,
          };
        }
      }
      const r = applyRegen(row.amount, row.lastRegenAt, now, args.regen);
      balance = clampToMax(r.amount + args.amount, args.max);
      await ctx.db.patch(row._id, {
        amount: balance,
        lastRegenAt: r.lastRegenAt,
        lifetimeEarned: row.lifetimeEarned + (balance - r.amount),
      });
    }

    await ctx.db.insert("ledger", {
      subjectRef: args.subjectRef,
      currency: args.currency,
      delta: args.amount,
      reason: args.reason,
      idempotencyKey: args.idempotencyKey,
      createdAt: now,
    });
    return { balance };
  },
});

/**
 * Debit `amount` of `currency` from `subjectRef`. Never goes negative — when
 * the (regen-aware) balance is short, returns `{ ok: false, code:
 * "INSUFFICIENT" }` while still persisting any regen that accrued.
 */
export const spend = mutation({
  args: {
    subjectRef: v.string(),
    currency: v.string(),
    amount: v.number(),
    reason: v.string(),
    regen: regenArg,
  },
  returns: spendResult,
  handler: async (ctx, args) => {
    assertPositiveAmount(args.amount);
    const now = Date.now();
    const row = await ctx.db
      .query("balances")
      .withIndex("by_subject_currency", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("currency", args.currency),
      )
      .unique();
    if (row === null) {
      return { ok: false, balance: 0, code: "INSUFFICIENT" as const };
    }
    const r = applyRegen(row.amount, row.lastRegenAt, now, args.regen);
    if (r.amount < args.amount) {
      await ctx.db.patch(row._id, { amount: r.amount, lastRegenAt: r.lastRegenAt });
      return { ok: false, balance: r.amount, code: "INSUFFICIENT" as const };
    }
    const balance = r.amount - args.amount;
    await ctx.db.patch(row._id, {
      amount: balance,
      lastRegenAt: r.lastRegenAt,
      lifetimeSpent: row.lifetimeSpent + args.amount,
    });
    await ctx.db.insert("ledger", {
      subjectRef: args.subjectRef,
      currency: args.currency,
      delta: -args.amount,
      reason: args.reason,
      createdAt: now,
    });
    return { ok: true, balance };
  },
});

/**
 * Move `amount` of `currency` from `fromRef` to `toRef` in one transaction.
 * Debits the sender (with the same insufficiency guard as {@link spend}); on
 * success credits the receiver (clamped to `max`) and ledgers both legs.
 * `fromRef === toRef` is rejected with `SELF_TRANSFER` (never double-touches one
 * row). Returns the sender's new balance.
 */
export const transfer = mutation({
  args: {
    fromRef: v.string(),
    toRef: v.string(),
    currency: v.string(),
    amount: v.number(),
    reason: v.string(),
    regen: regenArg,
    max: maxArg,
  },
  returns: spendResult,
  handler: async (ctx, args) => {
    assertPositiveAmount(args.amount);
    const now = Date.now();
    const fromRow = await ctx.db
      .query("balances")
      .withIndex("by_subject_currency", (q) =>
        q.eq("subjectRef", args.fromRef).eq("currency", args.currency),
      )
      .unique();
    if (args.fromRef === args.toRef) {
      const current =
        fromRow === null
          ? 0
          : applyRegen(fromRow.amount, fromRow.lastRegenAt, now, args.regen).amount;
      return { ok: false, balance: current, code: "SELF_TRANSFER" as const };
    }
    if (fromRow === null) {
      return { ok: false, balance: 0, code: "INSUFFICIENT" as const };
    }
    const fromR = applyRegen(fromRow.amount, fromRow.lastRegenAt, now, args.regen);
    if (fromR.amount < args.amount) {
      await ctx.db.patch(fromRow._id, {
        amount: fromR.amount,
        lastRegenAt: fromR.lastRegenAt,
      });
      return { ok: false, balance: fromR.amount, code: "INSUFFICIENT" as const };
    }
    const fromBalance = fromR.amount - args.amount;
    await ctx.db.patch(fromRow._id, {
      amount: fromBalance,
      lastRegenAt: fromR.lastRegenAt,
      lifetimeSpent: fromRow.lifetimeSpent + args.amount,
    });
    await ctx.db.insert("ledger", {
      subjectRef: args.fromRef,
      currency: args.currency,
      delta: -args.amount,
      reason: args.reason,
      createdAt: now,
    });

    const toRow = await ctx.db
      .query("balances")
      .withIndex("by_subject_currency", (q) =>
        q.eq("subjectRef", args.toRef).eq("currency", args.currency),
      )
      .unique();
    if (toRow === null) {
      const credited = clampToMax(args.amount, args.max);
      await ctx.db.insert("balances", {
        subjectRef: args.toRef,
        currency: args.currency,
        amount: credited,
        lastRegenAt: now,
        lifetimeEarned: credited,
        lifetimeSpent: 0,
      });
    } else {
      const toR = applyRegen(toRow.amount, toRow.lastRegenAt, now, args.regen);
      const credited = clampToMax(toR.amount + args.amount, args.max);
      await ctx.db.patch(toRow._id, {
        amount: credited,
        lastRegenAt: toR.lastRegenAt,
        lifetimeEarned: toRow.lifetimeEarned + (credited - toR.amount),
      });
    }
    await ctx.db.insert("ledger", {
      subjectRef: args.toRef,
      currency: args.currency,
      delta: args.amount,
      reason: args.reason,
      createdAt: now,
    });
    return { ok: true, balance: fromBalance };
  },
});
