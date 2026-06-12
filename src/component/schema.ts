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
  })
    .index("by_subject_currency", ["subjectRef", "currency", "createdAt"])
    // Idempotency is scoped per (subject, currency): the same key reused across
    // different subjects/currencies is independent, so a legitimate grant is
    // never silently dropped by a key collision.
    .index("by_idem", ["subjectRef", "currency", "idempotencyKey"])
    // Drives the retention/idempotency prune cron (oldest-first by createdAt).
    .index("by_created", ["createdAt"]),
});
