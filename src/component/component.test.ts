import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

function setClock(ms: number) {
  vi.setSystemTime(new Date(ms));
}

async function earn(
  t: ReturnType<typeof setup>,
  reason: string,
  idempotencyKey?: string,
) {
  return await t.mutation(api.mutations.earn, {
    subjectRef: "u",
    currency: "coins",
    amount: 1,
    reason,
    idempotencyKey,
  });
}

async function prune(
  t: ReturnType<typeof setup>,
  retentionMs: number,
  idempotencyTtlMs: number,
) {
  return await t.mutation(internal.internal_mutations.pruneLedger, {
    retentionMs,
    idempotencyTtlMs,
  });
}

describe("wallet component — retention and idempotency sweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setClock(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("prunes old ledger rows and leaves fresh ones", async () => {
    const t = setup();
    await earn(t, "old");
    setClock(10_000);
    await earn(t, "new");
    expect(await prune(t, 5_000, 1_000_000)).toEqual({
      deleted: 1,
      expired: 0,
    });
    const history = await t.query(api.queries.history, {
      subjectRef: "u",
      currency: "coins",
      limit: 100,
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ reason: "new" });
  });

  test("expires an idempotency key so it can be reused", async () => {
    const t = setup();
    await earn(t, "iap", "receipt");
    setClock(10_000);
    expect(await prune(t, 1_000_000, 5_000)).toEqual({
      deleted: 0,
      expired: 1,
    });
    expect(await earn(t, "iap", "receipt")).toEqual({ balance: 2 });
  });

  test("is idempotent and converges to a no-op", async () => {
    const t = setup();
    await earn(t, "old");
    await earn(t, "iap", "k");
    setClock(10_000);
    expect((await prune(t, 1_000_000, 5_000)).expired).toBe(1);
    expect(await prune(t, 1_000_000, 5_000)).toEqual({
      deleted: 0,
      expired: 0,
    });
  });

  test("does nothing when no rows are stale", async () => {
    const t = setup();
    await earn(t, "iap", "k");
    expect(await prune(t, 1_000_000, 1_000_000)).toEqual({
      deleted: 0,
      expired: 0,
    });
  });

  test("caps a full prune batch and skips idempotency expiry", async () => {
    const t = setup();
    for (let i = 0; i < 256; i++) {
      await earn(t, `old-${i}`);
    }
    setClock(10_000);
    expect(await prune(t, 5_000, 1)).toEqual({
      deleted: 256,
      expired: 0,
    });
  });
});

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ data: { code } });
}

async function ledgerSum(t: ReturnType<typeof setup>, subjectRef: string) {
  const rows = await t.run((ctx) => ctx.db.query("ledger").collect());
  return rows
    .filter((row) => row.subjectRef === subjectRef)
    .reduce((sum, row) => sum + row.delta, 0);
}

const base = { subjectRef: "u", currency: "coins", amount: 1, reason: "r" };

describe("wallet component - money safety", () => {
  test("earn above a lowered max never debits the balance", async () => {
    const t = setup();
    await t.mutation(api.mutations.earn, { ...base, amount: 100 });
    // Host lowered `max` below the stored balance: the credit is a no-op.
    expect(await t.mutation(api.mutations.earn, { ...base, max: 40 })).toEqual({
      balance: 100,
    });
    const rows = await t.run((ctx) => ctx.db.query("ledger").collect());
    expect(rows.map((row) => row.delta)).toEqual([100, 0]);
    const [balanceRow] = await t.run((ctx) => ctx.db.query("balances").collect());
    expect(balanceRow).toMatchObject({ amount: 100, lifetimeEarned: 100 });
  });

  test("transfer into a receiver above a lowered max never debits the receiver", async () => {
    const t = setup();
    await t.mutation(api.mutations.earn, { ...base, subjectRef: "a", amount: 10 });
    await t.mutation(api.mutations.earn, { ...base, subjectRef: "b", amount: 100 });
    await t.mutation(api.mutations.transfer, {
      fromRef: "a",
      toRef: "b",
      currency: "coins",
      amount: 5,
      reason: "r",
      max: 40,
    });
    expect(
      await t.query(api.queries.balance, { subjectRef: "b", currency: "coins" }),
    ).toBe(100);
    expect(await ledgerSum(t, "b")).toBe(100);
  });

  test.each([
    ["NaN", Number.NaN],
    ["negative", -1],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["above 2^53 - 1", Number.MAX_SAFE_INTEGER + 2],
  ])("rejects a %s amount without touching state", async (_name, amount) => {
    const t = setup();
    await t.mutation(api.mutations.earn, base);
    for (const fn of [api.mutations.earn, api.mutations.spend]) {
      await expect(t.mutation(fn, { ...base, amount })).rejects.toThrow(
        "INVALID_AMOUNT",
      );
    }
    await expect(
      t.mutation(api.mutations.transfer, {
        fromRef: "u",
        toRef: "v",
        currency: "coins",
        amount,
        reason: "r",
      }),
    ).rejects.toThrow("INVALID_AMOUNT");
    expect(await ledgerSum(t, "u")).toBe(1);
  });

  test.each([Number.NaN, -1])("rejects max %s", async (max) => {
    const t = setup();
    await expectCode(t.mutation(api.mutations.earn, { ...base, max }), "INVALID_MAX");
    await expectCode(
      t.mutation(api.mutations.transfer, {
        fromRef: "u",
        toRef: "v",
        currency: "coins",
        amount: 1,
        reason: "r",
        max,
      }),
      "INVALID_MAX",
    );
    expect(await ledgerSum(t, "u")).toBe(0);
  });

  test("earn that would pass 2^53 - 1 is rejected and leaves the balance intact", async () => {
    const t = setup();
    await t.mutation(api.mutations.earn, { ...base, amount: Number.MAX_SAFE_INTEGER });
    await expectCode(t.mutation(api.mutations.earn, base), "BALANCE_OVERFLOW");
    await t.mutation(api.mutations.earn, { ...base, subjectRef: "v", amount: 1 });
    await expectCode(
      t.mutation(api.mutations.transfer, {
        fromRef: "v",
        toRef: "u",
        currency: "coins",
        amount: 1,
        reason: "r",
      }),
      "BALANCE_OVERFLOW",
    );
    expect(
      await t.query(api.queries.balance, { subjectRef: "u", currency: "coins" }),
    ).toBe(Number.MAX_SAFE_INTEGER);
    // The failed transfer rolled back the sender's debit too.
    expect(
      await t.query(api.queries.balance, { subjectRef: "v", currency: "coins" }),
    ).toBe(1);
  });

  test("lifetimeEarned overflow is rejected", async () => {
    const t = setup();
    await t.mutation(api.mutations.earn, { ...base, amount: Number.MAX_SAFE_INTEGER - 1 });
    await t.mutation(api.mutations.spend, { ...base, amount: Number.MAX_SAFE_INTEGER - 1 });
    await expectCode(
      t.mutation(api.mutations.earn, { ...base, amount: 2 }),
      "BALANCE_OVERFLOW",
    );
  });

  test("rejects empty identifiers and reasons", async () => {
    const t = setup();
    for (const patch of [
      { subjectRef: "" },
      { currency: "" },
      { reason: "" },
      { idempotencyKey: "" },
    ]) {
      await expectCode(
        t.mutation(api.mutations.earn, { ...base, ...patch }),
        "INVALID_ARGUMENT",
      );
      await expectCode(
        t.mutation(api.mutations.spend, { ...base, ...patch }),
        "INVALID_ARGUMENT",
      );
    }
    await expectCode(
      t.mutation(api.mutations.transfer, {
        fromRef: "",
        toRef: "v",
        currency: "coins",
        amount: 1,
        reason: "r",
      }),
      "INVALID_ARGUMENT",
    );
    expect(await ledgerSum(t, "u")).toBe(0);
  });
});

describe("wallet component - idempotency", () => {
  test("a key recorded by earn cannot silently swallow a spend", async () => {
    const t = setup();
    await t.mutation(api.mutations.earn, { ...base, amount: 10, idempotencyKey: "k" });
    await expectCode(
      t.mutation(api.mutations.spend, { ...base, amount: 4, idempotencyKey: "k" }),
      "IDEMPOTENCY_KEY_REUSED",
    );
    expect(await ledgerSum(t, "u")).toBe(10);
  });

  test("a key recorded by spend cannot silently swallow an earn", async () => {
    const t = setup();
    await t.mutation(api.mutations.earn, { ...base, amount: 10 });
    await t.mutation(api.mutations.spend, { ...base, amount: 4, idempotencyKey: "k" });
    await expectCode(
      t.mutation(api.mutations.earn, { ...base, amount: 4, idempotencyKey: "k" }),
      "IDEMPOTENCY_KEY_REUSED",
    );
    expect(await ledgerSum(t, "u")).toBe(6);
  });

  test("concurrent retries of one keyed earn and spend apply once", async () => {
    const t = setup();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        t.mutation(api.mutations.earn, { ...base, amount: 10, idempotencyKey: "e" }),
      ),
    );
    await Promise.all(
      Array.from({ length: 8 }, () =>
        t.mutation(api.mutations.spend, { ...base, amount: 3, idempotencyKey: "s" }),
      ),
    );
    expect(
      await t.query(api.queries.balance, { subjectRef: "u", currency: "coins" }),
    ).toBe(7);
    expect(await ledgerSum(t, "u")).toBe(7);
  });
});

describe("wallet component - ledger reconciles with balances", () => {
  test("after mixed earn, spend, transfer and clamped credits", async () => {
    const t = setup();
    const refs = ["a", "b", "c"] as const;
    for (let i = 0; i < 60; i++) {
      const subjectRef = refs[i % 3] as string;
      const other = refs[(i + 1) % 3] as string;
      const amount = (i % 7) + 1;
      if (i % 3 === 0) {
        await t.mutation(api.mutations.earn, { ...base, subjectRef, amount, max: 25 });
      } else if (i % 3 === 1) {
        await t.mutation(api.mutations.spend, { ...base, subjectRef, amount });
      } else {
        await t.mutation(api.mutations.transfer, {
          fromRef: subjectRef,
          toRef: other,
          currency: "coins",
          amount,
          reason: "r",
          max: 25,
        });
      }
    }
    for (const subjectRef of refs) {
      const balance = await t.query(api.queries.balance, {
        subjectRef,
        currency: "coins",
      });
      expect(balance).toBeGreaterThanOrEqual(0);
      expect(await ledgerSum(t, subjectRef)).toBe(balance);
    }
  });
});
