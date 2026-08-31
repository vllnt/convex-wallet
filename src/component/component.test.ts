import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

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
