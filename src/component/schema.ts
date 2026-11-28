import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Sandboxed tables — the wallet's own concern. `subjectRef` is an opaque
 * host-owned reference (never assume it is a user id or its shape); `currency`
 * is an opaque host-chosen string (coins, energy, gems, credits).
 */
export default defineSchema({
  balances: defineTable({
    subjectRef: v.string(),
    currency: v.string(),
    amount: v.number(),
    lastRegenAt: v.number(),
    lifetimeEarned: v.number(),
    lifetimeSpent: v.number(),
  }).index("by_subject_currency", ["subjectRef", "currency"]),
  ledger: defineTable({
    subjectRef: v.string(),
    currency: v.string(),
    delta: v.number(),
    reason: v.string(),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
    // `true` once the row holds no idempotency key: written without one, or
    // cleared by the sweep. Absent while it may hold one, including every row
    // written before 0.2.0, so the sweep visits each such row at most once.
    noKey: v.optional(v.literal(true)),
  })
    .index("by_subject_currency", ["subjectRef", "currency", "createdAt"])
    // Idempotency is scoped per (subject, currency): the same key reused across
    // different subjects/currencies is independent, so a legitimate grant is
    // never silently dropped by a key collision.
    .index("by_idem", ["subjectRef", "currency", "idempotencyKey"])
    // Drives the retention prune cron (oldest-first by createdAt).
    .index("by_created", ["createdAt"])
    // Drives idempotency-key expiry: only rows that may still hold a key.
    .index("by_no_key_created", ["noKey", "createdAt"]),
});
