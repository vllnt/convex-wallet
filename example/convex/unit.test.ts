import { describe, expect, test } from "vitest";
import {
  applyRegen,
  assertPositiveAmount,
  COMPONENT_NAME,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_LEDGER_RETENTION_MS,
  DEFAULT_PRUNE_INTERVAL_MS,
  ERROR_CODES,
  INVALID_AMOUNT,
  INVALID_REGEN,
} from "../../src/shared";
import crons from "../../src/component/crons";

describe("applyRegen — all branches", () => {
  test("no regen config → unchanged", () => {
    expect(applyRegen(7, 0, 999_999)).toEqual({ amount: 7, lastRegenAt: 0 });
  });

  test("regen but ticks === 0 → unchanged, clock pointer does not advance", () => {
    const regen = { amount: 1, intervalMs: 1000, cap: 10 };
    // 500ms < one interval → zero whole ticks
    expect(applyRegen(3, 0, 500, regen)).toEqual({ amount: 3, lastRegenAt: 0 });
  });

  test("ticks > 0, below cap → grants ticks*amount, advances clock by ticks", () => {
    const regen = { amount: 1, intervalMs: 1000, cap: 10 };
    // 3500ms → 3 whole ticks; 3 + 3 = 6 (< cap), clock to 3000 (partial 500 kept)
    expect(applyRegen(3, 0, 3500, regen)).toEqual({ amount: 6, lastRegenAt: 3000 });
  });

  test("ticks > 0, hitting cap → clamps to cap, never above", () => {
    const regen = { amount: 5, intervalMs: 1000, cap: 10 };
    // 4 ticks * 5 = 20, + stored 8 = 28 → clamp to 10; clock still advances 4 ticks
    expect(applyRegen(8, 0, 4000, regen)).toEqual({ amount: 10, lastRegenAt: 4000 });
  });

  test("clamps to cap exactly — never above cap", () => {
    const regen = { amount: 1, intervalMs: 1000, cap: 10 };
    // 2 ticks: min(cap=10, 9+2) = 10 (clamped exactly to cap)
    expect(applyRegen(9, 0, 2000, regen)).toEqual({ amount: 10, lastRegenAt: 2000 });
  });

  test("backwards clock (now < lastRegenAt) → unchanged, never rewinds", () => {
    const regen = { amount: 1, intervalMs: 1000, cap: 100 };
    // a rewound/stale clock must not grant or move the pointer backward
    expect(applyRegen(5, 10_000, 4_000, regen)).toEqual({
      amount: 5,
      lastRegenAt: 10_000,
    });
  });

  test("equal clock (now === lastRegenAt) → unchanged", () => {
    const regen = { amount: 1, intervalMs: 1000, cap: 100 };
    expect(applyRegen(5, 7_000, 7_000, regen)).toEqual({
      amount: 5,
      lastRegenAt: 7_000,
    });
  });

  test("pointer never advances past now (lastRegenAt + ticks*interval <= now)", () => {
    const regen = { amount: 1, intervalMs: 1000, cap: 1_000_000 };
    const r = applyRegen(0, 0, 9_999, regen);
    expect(r.lastRegenAt).toBeLessThanOrEqual(9_999);
    expect(r.lastRegenAt).toBe(9_000);
  });

  test("intervalMs:0 → throws INVALID_REGEN (NaN corruption guard)", () => {
    expect(() => applyRegen(5, 0, 10_000, { amount: 1, intervalMs: 0, cap: 10 })).toThrow(
      INVALID_REGEN,
    );
  });

  test("amount:0 in regen config → throws INVALID_REGEN", () => {
    expect(() => applyRegen(5, 0, 10_000, { amount: 0, intervalMs: 1000, cap: 10 })).toThrow(
      INVALID_REGEN,
    );
  });

  test("cap:0 in regen config → throws INVALID_REGEN", () => {
    expect(() => applyRegen(5, 0, 10_000, { amount: 1, intervalMs: 1000, cap: 0 })).toThrow(
      INVALID_REGEN,
    );
  });

  test("intervalMs:NaN → throws INVALID_REGEN", () => {
    expect(() =>
      applyRegen(5, 0, 10_000, { amount: 1, intervalMs: Number.NaN, cap: 10 }),
    ).toThrow(INVALID_REGEN);
  });

  test("stored > regen.cap → balance is NOT reduced below stored", () => {
    const regen = { amount: 1, intervalMs: 1000, cap: 5 };
    const r = applyRegen(10, 0, 3000, regen);
    expect(r.amount).toBeGreaterThanOrEqual(10);
  });

  test("stored exactly at cap → no change when regen would not increase beyond cap", () => {
    const regen = { amount: 1, intervalMs: 1000, cap: 10 };
    const r = applyRegen(10, 0, 5000, regen);
    expect(r.amount).toBe(10);
  });

  test("after INVALID_REGEN a valid regen call still works (no row corruption)", () => {
    let threw = false;
    try {
      applyRegen(5, 0, 10_000, { amount: 1, intervalMs: 0, cap: 10 });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const r = applyRegen(5, 0, 3_000, { amount: 1, intervalMs: 1000, cap: 10 });
    expect(r.amount).toBe(8);
  });
});

describe("assertPositiveAmount — abuse guard", () => {
  test("accepts a finite positive amount", () => {
    expect(() => assertPositiveAmount(1)).not.toThrow();
    expect(() => assertPositiveAmount(0.5)).not.toThrow();
  });

  test("rejects zero", () => {
    expect(() => assertPositiveAmount(0)).toThrow(INVALID_AMOUNT);
  });

  test("rejects negative (a negative spend would otherwise MINT funds)", () => {
    expect(() => assertPositiveAmount(-10)).toThrow(INVALID_AMOUNT);
  });

  test("rejects NaN", () => {
    expect(() => assertPositiveAmount(Number.NaN)).toThrow(INVALID_AMOUNT);
  });

  test("rejects Infinity", () => {
    expect(() => assertPositiveAmount(Number.POSITIVE_INFINITY)).toThrow(INVALID_AMOUNT);
    expect(() => assertPositiveAmount(Number.NEGATIVE_INFINITY)).toThrow(INVALID_AMOUNT);
  });
});

test("exported constants", () => {
  expect(COMPONENT_NAME).toBe("wallet");
  expect(DEFAULT_HISTORY_LIMIT).toBe(50);
  expect(DEFAULT_LEDGER_RETENTION_MS).toBe(90 * 24 * 60 * 60 * 1000);
  expect(DEFAULT_IDEMPOTENCY_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  expect(DEFAULT_PRUNE_INTERVAL_MS).toBe(60 * 60 * 1000);
  expect(ERROR_CODES).toEqual({
    INSUFFICIENT: "INSUFFICIENT",
    SELF_TRANSFER: "SELF_TRANSFER",
  });
  expect(INVALID_REGEN).toBe("INVALID_REGEN");
});

test("component registers the retention/idempotency prune cron", () => {
  const jobs = Object.values(crons.crons);
  expect(jobs).toHaveLength(1);
  const [job] = jobs;
  expect(job.schedule).toEqual({ type: "interval", hours: 1 });
  expect(job.args).toEqual([
    {
      retentionMs: DEFAULT_LEDGER_RETENTION_MS,
      idempotencyTtlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
    },
  ]);
});
