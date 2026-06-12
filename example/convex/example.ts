import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { Wallet } from "../../src/client";

/**
 * Host-app wrappers. The host owns auth + payment confirmation: resolve identity
 * (and verify any IAP) here, then pass an opaque `subjectRef` and `currency`
 * string into the wallet client.
 */

/**
 * Default client — `coins` is static, `energy` regenerates (1/s up to 10), and
 * `gold` is a static currency with a hard `max` ceiling of 100.
 */
const wallet = new Wallet(components.wallet, {
  currencies: {
    energy: { regen: { amount: 1, intervalMs: 1000, cap: 10 } },
    gold: { max: 100 },
  },
});

/** A second client with no per-currency config — exercises `regenFor`'s miss branch. */
const plainWallet = new Wallet(components.wallet);

const spend = v.object({
  ok: v.boolean(),
  balance: v.number(),
  code: v.optional(v.union(v.literal("INSUFFICIENT"), v.literal("SELF_TRANSFER"))),
});
const ledgerEntry = v.object({
  currency: v.string(),
  delta: v.number(),
  reason: v.string(),
  idempotencyKey: v.optional(v.string()),
  createdAt: v.number(),
});

export const earn = mutation({
  args: {
    subjectRef: v.string(),
    currency: v.string(),
    amount: v.number(),
    reason: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({ balance: v.number() }),
  handler: (ctx, a) =>
    wallet.earn(ctx, a.subjectRef, a.currency, a.amount, a.reason, {
      idempotencyKey: a.idempotencyKey,
    }),
});

export const grant = mutation({
  args: {
    subjectRef: v.string(),
    currency: v.string(),
    amount: v.number(),
    reason: v.string(),
    idempotencyKey: v.string(),
  },
  returns: v.object({ balance: v.number() }),
  handler: (ctx, a) =>
    wallet.grant(ctx, a.subjectRef, a.currency, a.amount, a.reason, a.idempotencyKey),
});

export const spendCall = mutation({
  args: { subjectRef: v.string(), currency: v.string(), amount: v.number(), reason: v.string() },
  returns: spend,
  handler: (ctx, a) => wallet.spend(ctx, a.subjectRef, a.currency, a.amount, a.reason),
});

export const transferCall = mutation({
  args: {
    fromRef: v.string(),
    toRef: v.string(),
    currency: v.string(),
    amount: v.number(),
    reason: v.string(),
  },
  returns: spend,
  handler: (ctx, a) =>
    wallet.transfer(ctx, a.fromRef, a.toRef, a.currency, a.amount, a.reason),
});

export const balanceCall = query({
  args: { subjectRef: v.string(), currency: v.string() },
  returns: v.number(),
  handler: (ctx, a) => wallet.balance(ctx, a.subjectRef, a.currency),
});

export const balancesCall = query({
  args: { subjectRef: v.string() },
  returns: v.array(v.object({ currency: v.string(), amount: v.number() })),
  handler: (ctx, a) => wallet.balances(ctx, a.subjectRef),
});

export const historyCall = query({
  args: { subjectRef: v.string(), currency: v.string(), limit: v.optional(v.number()) },
  returns: v.array(ledgerEntry),
  handler: (ctx, a) => wallet.history(ctx, a.subjectRef, a.currency, a.limit),
});

/**
 * Uses the default `wallet` client with the `energy` currency, which HAS a regen
 * config — exercises the truthy branch of `regenFor`'s optional chaining.
 */
export const earnEnergyViaClient = mutation({
  args: { subjectRef: v.string(), amount: v.number(), reason: v.string() },
  returns: v.object({ balance: v.number() }),
  handler: (ctx, a) => wallet.earn(ctx, a.subjectRef, "energy", a.amount, a.reason),
});

export const balanceEnergyViaClient = query({
  args: { subjectRef: v.string() },
  returns: v.number(),
  handler: (ctx, a) => wallet.balance(ctx, a.subjectRef, "energy"),
});

/** Earn into the `gold` currency, which carries a hard `max` of 100. */
export const earnGoldViaClient = mutation({
  args: { subjectRef: v.string(), amount: v.number(), reason: v.string() },
  returns: v.object({ balance: v.number() }),
  handler: (ctx, a) => wallet.earn(ctx, a.subjectRef, "gold", a.amount, a.reason),
});

/** Transfer `gold` — exercises the receiver-side `max` clamp on transfer. */
export const transferGoldViaClient = mutation({
  args: { fromRef: v.string(), toRef: v.string(), amount: v.number(), reason: v.string() },
  returns: spend,
  handler: (ctx, a) => wallet.transfer(ctx, a.fromRef, a.toRef, "gold", a.amount, a.reason),
});

export const earnPlain = mutation({
  args: { subjectRef: v.string(), currency: v.string(), amount: v.number(), reason: v.string() },
  returns: v.object({ balance: v.number() }),
  handler: (ctx, a) => plainWallet.earn(ctx, a.subjectRef, a.currency, a.amount, a.reason),
});

export const historyPlain = query({
  args: { subjectRef: v.string(), currency: v.string() },
  returns: v.array(ledgerEntry),
  handler: (ctx, a) => plainWallet.history(ctx, a.subjectRef, a.currency),
});

/** Multi-currency overview via the plain client (no regen map). */
export const balancesPlain = query({
  args: { subjectRef: v.string() },
  returns: v.array(v.object({ currency: v.string(), amount: v.number() })),
  handler: (ctx, a) => plainWallet.balances(ctx, a.subjectRef),
});

/**
 * Drive the component's internal retention/idempotency sweep directly, so a test
 * can exercise it without waiting on the cron. Reaches the component's
 * `internalMutation` through the host's `runMutation` (cross-boundary call).
 */
export const pruneCall = mutation({
  args: { retentionMs: v.number(), idempotencyTtlMs: v.number() },
  returns: v.object({ deleted: v.number(), expired: v.number() }),
  handler: (ctx, a) =>
    ctx.runMutation(components.wallet.internal_mutations.pruneLedger, {
      retentionMs: a.retentionMs,
      idempotencyTtlMs: a.idempotencyTtlMs,
    }),
});
