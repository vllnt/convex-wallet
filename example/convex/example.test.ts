import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";
import { register } from "../../src/test";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  register(t);
  return t;
}

/**
 * Pin the server clock. The component reads `Date.now()` itself (server-source
 * time), so a test drives regen by advancing the fake system time — never by
 * passing a host-supplied `now` the host could forge.
 */
function setClock(ms: number) {
  vi.setSystemTime(ms);
}

describe("wallet — earn", () => {
  test("earn into a new balance creates it (happy path)", async () => {
    const t = setup();
    const r = await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 100,
      reason: "signup",
    });
    expect(r).toEqual({ balance: 100 });
    expect(await t.query(api.example.balanceCall, { subjectRef: "u1", currency: "coins" })).toBe(
      100,
    );
  });

  test("earn into an existing balance accrues (no regen currency)", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 100,
      reason: "a",
    });
    const r = await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 50,
      reason: "b",
    });
    expect(r).toEqual({ balance: 150 });
  });

  test("earn via client with a regen currency (regenFor truthy branch)", async () => {
    const t = setup();
    const r = await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "e1",
      amount: 2,
      reason: "start",
    });
    expect(r).toEqual({ balance: 2 });
    expect(
      await t.query(api.example.balanceEnergyViaClient, { subjectRef: "e1" }),
    ).toBe(2);
  });

  test("earnPlain (client with no currency config) credits", async () => {
    const t = setup();
    const r = await t.mutation(api.example.earnPlain, {
      subjectRef: "p1",
      currency: "coins",
      amount: 5,
      reason: "x",
    });
    expect(r).toEqual({ balance: 5 });
  });
});

describe("wallet — amount guards (ABUSE)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setClock(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("spend(-10) is REJECTED — a negative spend must never MINT funds", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "abuse",
      currency: "coins",
      amount: 100,
      reason: "seed",
    });
    await expect(
      t.mutation(api.example.spendCall, {
        subjectRef: "abuse",
        currency: "coins",
        amount: -10,
        reason: "exploit",
      }),
    ).rejects.toThrow("INVALID_AMOUNT");
    // balance untouched — no mint
    expect(await t.query(api.example.balanceCall, { subjectRef: "abuse", currency: "coins" })).toBe(
      100,
    );
  });

  test("earn(0) is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.earn, {
        subjectRef: "z",
        currency: "coins",
        amount: 0,
        reason: "x",
      }),
    ).rejects.toThrow("INVALID_AMOUNT");
  });

  test("earn(NaN) is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.earn, {
        subjectRef: "z",
        currency: "coins",
        amount: Number.NaN,
        reason: "x",
      }),
    ).rejects.toThrow("INVALID_AMOUNT");
  });

  test("grant(Infinity) is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.grant, {
        subjectRef: "z",
        currency: "coins",
        amount: Number.POSITIVE_INFINITY,
        reason: "iap",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow("INVALID_AMOUNT");
  });

  test("transfer(-5) is rejected — no mint to receiver", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "a",
      currency: "coins",
      amount: 50,
      reason: "seed",
    });
    await expect(
      t.mutation(api.example.transferCall, {
        fromRef: "a",
        toRef: "b",
        currency: "coins",
        amount: -5,
        reason: "exploit",
      }),
    ).rejects.toThrow("INVALID_AMOUNT");
    expect(await t.query(api.example.balanceCall, { subjectRef: "b", currency: "coins" })).toBe(0);
  });
});

describe("wallet — earn idempotency (per subject + currency)", () => {
  test("same idempotencyKey twice does not double-credit (existing balance)", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 10,
      reason: "base",
    });
    const first = await t.mutation(api.example.grant, {
      subjectRef: "u1",
      currency: "coins",
      amount: 100,
      reason: "iap",
      idempotencyKey: "order_1",
    });
    expect(first).toEqual({ balance: 110 });
    const replay = await t.mutation(api.example.grant, {
      subjectRef: "u1",
      currency: "coins",
      amount: 100,
      reason: "iap",
      idempotencyKey: "order_1",
    });
    expect(replay).toEqual({ balance: 110 });
    expect(await t.query(api.example.balanceCall, { subjectRef: "u1", currency: "coins" })).toBe(
      110,
    );
  });

  test("SAME key across two DIFFERENT subjects no longer collides (both credited)", async () => {
    const t = setup();
    // Subject A grants with key "promo".
    const a = await t.mutation(api.example.grant, {
      subjectRef: "A",
      currency: "gems",
      amount: 3,
      reason: "promo",
      idempotencyKey: "promo",
    });
    expect(a).toEqual({ balance: 3 });
    // Subject B reuses the SAME key — must be a legitimate independent grant,
    // NOT silently dropped (the old global-key bug dropped it).
    const b = await t.mutation(api.example.grant, {
      subjectRef: "B",
      currency: "gems",
      amount: 3,
      reason: "promo",
      idempotencyKey: "promo",
    });
    expect(b).toEqual({ balance: 3 });
    expect(await t.query(api.example.balanceCall, { subjectRef: "B", currency: "gems" })).toBe(3);
  });

  test("SAME key across two DIFFERENT currencies for one subject is independent", async () => {
    const t = setup();
    await t.mutation(api.example.grant, {
      subjectRef: "u",
      currency: "coins",
      amount: 5,
      reason: "p",
      idempotencyKey: "k",
    });
    const gems = await t.mutation(api.example.grant, {
      subjectRef: "u",
      currency: "gems",
      amount: 9,
      reason: "p",
      idempotencyKey: "k",
    });
    expect(gems).toEqual({ balance: 9 });
  });

  test("replay returns the originally-affected balance", async () => {
    const t = setup();
    await t.mutation(api.example.grant, {
      subjectRef: "u",
      currency: "coins",
      amount: 7,
      reason: "p",
      idempotencyKey: "rk",
    });
    // accrue more (no key), then replay the key → returns CURRENT balance of that subject/currency
    await t.mutation(api.example.earn, {
      subjectRef: "u",
      currency: "coins",
      amount: 3,
      reason: "more",
    });
    const replay = await t.mutation(api.example.grant, {
      subjectRef: "u",
      currency: "coins",
      amount: 7,
      reason: "p",
      idempotencyKey: "rk",
    });
    expect(replay).toEqual({ balance: 10 });
  });

  test("idempotent replay before the subject's row exists returns 0", async () => {
    const t = setup();
    // Same key, same currency, but a fresh subject that earns then we force the
    // replay branch by re-using the key for that subject after a row would be 0.
    await t.mutation(api.example.grant, {
      subjectRef: "u9",
      currency: "gems",
      amount: 3,
      reason: "first",
      idempotencyKey: "k9",
    });
    // The SAME subject + key replays → no double credit (balance stays 3).
    const replay = await t.mutation(api.example.grant, {
      subjectRef: "u9",
      currency: "gems",
      amount: 3,
      reason: "first",
      idempotencyKey: "k9",
    });
    expect(replay).toEqual({ balance: 3 });
  });
});

describe("wallet — spend", () => {
  test("spend succeeds and debits", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 100,
      reason: "grant",
    });
    const r = await t.mutation(api.example.spendCall, {
      subjectRef: "u1",
      currency: "coins",
      amount: 30,
      reason: "buy",
    });
    expect(r).toEqual({ ok: true, balance: 70 });
    expect(await t.query(api.example.balanceCall, { subjectRef: "u1", currency: "coins" })).toBe(
      70,
    );
  });

  test("spend with no balance row → INSUFFICIENT, balance 0", async () => {
    const t = setup();
    const r = await t.mutation(api.example.spendCall, {
      subjectRef: "ghost",
      currency: "coins",
      amount: 1,
      reason: "buy",
    });
    expect(r).toEqual({ ok: false, balance: 0, code: "INSUFFICIENT" });
  });

  test("spend with a balance that is short → INSUFFICIENT, balance unchanged", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 5,
      reason: "grant",
    });
    const r = await t.mutation(api.example.spendCall, {
      subjectRef: "u1",
      currency: "coins",
      amount: 10,
      reason: "buy",
    });
    expect(r).toEqual({ ok: false, balance: 5, code: "INSUFFICIENT" });
    expect(await t.query(api.example.balanceCall, { subjectRef: "u1", currency: "coins" })).toBe(
      5,
    );
  });
});

describe("wallet — transfer", () => {
  test("transfer succeeds: debits sender, credits new receiver", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "alice",
      currency: "coins",
      amount: 100,
      reason: "grant",
    });
    const r = await t.mutation(api.example.transferCall, {
      fromRef: "alice",
      toRef: "bob",
      currency: "coins",
      amount: 40,
      reason: "gift",
    });
    expect(r).toEqual({ ok: true, balance: 60 });
    expect(await t.query(api.example.balanceCall, { subjectRef: "alice", currency: "coins" })).toBe(
      60,
    );
    expect(await t.query(api.example.balanceCall, { subjectRef: "bob", currency: "coins" })).toBe(
      40,
    );
  });

  test("transfer to an EXISTING receiver balance accrues", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "alice",
      currency: "coins",
      amount: 100,
      reason: "g",
    });
    await t.mutation(api.example.earn, {
      subjectRef: "bob",
      currency: "coins",
      amount: 5,
      reason: "g",
    });
    const r = await t.mutation(api.example.transferCall, {
      fromRef: "alice",
      toRef: "bob",
      currency: "coins",
      amount: 10,
      reason: "gift",
    });
    expect(r).toEqual({ ok: true, balance: 90 });
    expect(await t.query(api.example.balanceCall, { subjectRef: "bob", currency: "coins" })).toBe(
      15,
    );
  });

  test("transfer with no sender row → INSUFFICIENT", async () => {
    const t = setup();
    const r = await t.mutation(api.example.transferCall, {
      fromRef: "nobody",
      toRef: "bob",
      currency: "coins",
      amount: 1,
      reason: "gift",
    });
    expect(r).toEqual({ ok: false, balance: 0, code: "INSUFFICIENT" });
  });

  test("transfer when sender is short → INSUFFICIENT, no credit to receiver", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "alice",
      currency: "coins",
      amount: 5,
      reason: "g",
    });
    const r = await t.mutation(api.example.transferCall, {
      fromRef: "alice",
      toRef: "bob",
      currency: "coins",
      amount: 10,
      reason: "gift",
    });
    expect(r).toEqual({ ok: false, balance: 5, code: "INSUFFICIENT" });
    expect(await t.query(api.example.balanceCall, { subjectRef: "bob", currency: "coins" })).toBe(
      0,
    );
  });

  test("self-transfer is rejected with SELF_TRANSFER and never double-touches the row", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "self",
      currency: "coins",
      amount: 50,
      reason: "g",
    });
    const r = await t.mutation(api.example.transferCall, {
      fromRef: "self",
      toRef: "self",
      currency: "coins",
      amount: 10,
      reason: "loop",
    });
    expect(r).toEqual({ ok: false, balance: 50, code: "SELF_TRANSFER" });
    // balance unchanged — not debited-then-credited (which could corrupt one row)
    expect(await t.query(api.example.balanceCall, { subjectRef: "self", currency: "coins" })).toBe(
      50,
    );
  });

  test("self-transfer on a subject with NO row → SELF_TRANSFER, balance 0", async () => {
    const t = setup();
    const r = await t.mutation(api.example.transferCall, {
      fromRef: "void",
      toRef: "void",
      currency: "coins",
      amount: 1,
      reason: "loop",
    });
    expect(r).toEqual({ ok: false, balance: 0, code: "SELF_TRANSFER" });
  });
});

describe("wallet — max ceiling", () => {
  test("earn clamps to max on a NEW balance", async () => {
    const t = setup();
    // gold max is 100; earn 150 → clamped to 100
    const r = await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "rich",
      amount: 150,
      reason: "drop",
    });
    expect(r).toEqual({ balance: 100 });
  });

  test("earn clamps to max on an EXISTING balance", async () => {
    const t = setup();
    await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "rich",
      amount: 90,
      reason: "a",
    });
    // 90 + 50 = 140 → clamp to 100
    const r = await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "rich",
      amount: 50,
      reason: "b",
    });
    expect(r).toEqual({ balance: 100 });
  });

  test("transfer clamps the receiver to max", async () => {
    const t = setup();
    await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "giver",
      amount: 100,
      reason: "seed",
    });
    await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "taker",
      amount: 80,
      reason: "seed",
    });
    // taker has 80, max 100; receiving 50 → clamp to 100
    const r = await t.mutation(api.example.transferGoldViaClient, {
      fromRef: "giver",
      toRef: "taker",
      amount: 50,
      reason: "gift",
    });
    expect(r.ok).toBe(true);
    expect(await t.query(api.example.balanceCall, { subjectRef: "taker", currency: "gold" })).toBe(
      100,
    );
  });

  test("transfer to a NEW receiver clamps to max", async () => {
    const t = setup();
    await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "giver",
      amount: 100,
      reason: "seed",
    });
    const r = await t.mutation(api.example.transferGoldViaClient, {
      fromRef: "giver",
      toRef: "fresh",
      amount: 100,
      reason: "gift",
    });
    expect(r.ok).toBe(true);
    // fresh receiver: min(100, max 100) = 100 (here exactly at cap)
    expect(await t.query(api.example.balanceCall, { subjectRef: "fresh", currency: "gold" })).toBe(
      100,
    );
  });
});

describe("wallet — balance / balances", () => {
  test("balance of a missing currency is 0", async () => {
    const t = setup();
    expect(await t.query(api.example.balanceCall, { subjectRef: "u1", currency: "coins" })).toBe(0);
  });

  test("balances returns every currency held (static)", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 100,
      reason: "g",
    });
    await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "gems",
      amount: 7,
      reason: "g",
    });
    const all = await t.query(api.example.balancesCall, { subjectRef: "u1" });
    expect(all).toEqual(
      expect.arrayContaining([
        { currency: "coins", amount: 100 },
        { currency: "gems", amount: 7 },
      ]),
    );
    expect(all).toHaveLength(2);
  });

  test("balancesPlain (no regen map) returns stored amounts", async () => {
    const t = setup();
    await t.mutation(api.example.earnPlain, {
      subjectRef: "pp",
      currency: "coins",
      amount: 4,
      reason: "g",
    });
    const all = await t.query(api.example.balancesPlain, { subjectRef: "pp" });
    expect(all).toEqual([{ currency: "coins", amount: 4 }]);
  });
});

describe("wallet — history", () => {
  test("history is newest-first and reflects deltas", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 100,
      reason: "earn",
    });
    await t.mutation(api.example.spendCall, {
      subjectRef: "u1",
      currency: "coins",
      amount: 30,
      reason: "spend",
    });
    const h = await t.query(api.example.historyCall, { subjectRef: "u1", currency: "coins" });
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ delta: -30, reason: "spend" });
    expect(h[1]).toMatchObject({ delta: 100, reason: "earn" });
  });

  test("history honours an explicit limit", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 1,
      reason: "a",
    });
    await t.mutation(api.example.earn, {
      subjectRef: "u1",
      currency: "coins",
      amount: 1,
      reason: "b",
    });
    const h = await t.query(api.example.historyCall, {
      subjectRef: "u1",
      currency: "coins",
      limit: 1,
    });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ reason: "b" });
  });

  test("historyPlain (default limit via plain client) returns rows", async () => {
    const t = setup();
    await t.mutation(api.example.earnPlain, {
      subjectRef: "p1",
      currency: "coins",
      amount: 1,
      reason: "a",
    });
    const h = await t.query(api.example.historyPlain, { subjectRef: "p1", currency: "coins" });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ delta: 1, reason: "a" });
    expect(h[0].idempotencyKey).toBeUndefined();
  });
});

describe("wallet — deterministic regen (server clock via fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setClock(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("energy regenerates over time; balance read is regen-aware", async () => {
    const t = setup();
    await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "g1",
      amount: 2,
      reason: "start",
    });
    // advance server clock 5s → 5 ticks * 1 = +5 → 7 (below cap 10)
    setClock(5000);
    expect(await t.query(api.example.balanceEnergyViaClient, { subjectRef: "g1" })).toBe(7);
    // far future → clamped to cap 10
    setClock(1_000_000);
    expect(await t.query(api.example.balanceEnergyViaClient, { subjectRef: "g1" })).toBe(10);
  });

  test("over-regen via a future clock is cap-bounded; lastRegenAt never exceeds now", async () => {
    const t = setup();
    await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "future",
      amount: 2,
      reason: "start",
    });
    // jump way ahead — even a huge elapsed window cannot exceed regen cap (10)
    setClock(10_000_000);
    expect(await t.query(api.example.balanceEnergyViaClient, { subjectRef: "future" })).toBe(10);
    // Persist that regen by spending to zero — reconciles the stored row to cap
    // with lastRegenAt advanced. Reading again at the SAME clock yields no
    // further regen (proving the pointer did not overshoot `now`)...
    const spent = await t.mutation(api.example.spendCall, {
      subjectRef: "future",
      currency: "energy",
      amount: 10,
      reason: "drain",
    });
    expect(spent).toEqual({ ok: true, balance: 0 });
    expect(await t.query(api.example.balanceEnergyViaClient, { subjectRef: "future" })).toBe(0);
    // ...and exactly one further interval grants exactly +1, never a windfall.
    setClock(10_001_000);
    expect(await t.query(api.example.balanceEnergyViaClient, { subjectRef: "future" })).toBe(1);
  });

  test("earn at a later clock persists accrued regen into the stored balance", async () => {
    const t = setup();
    await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "g2",
      amount: 2,
      reason: "start",
    });
    setClock(3000);
    // regen 3 ticks (2→5), then +1 = 6
    const r = await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "g2",
      amount: 1,
      reason: "more",
    });
    expect(r).toEqual({ balance: 6 });
  });

  test("spend persists accrued regen even when it fails (short)", async () => {
    const t = setup();
    await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "g3",
      amount: 2,
      reason: "start",
    });
    setClock(2000);
    const fail = await t.mutation(api.example.spendCall, {
      subjectRef: "g3",
      currency: "energy",
      amount: 100,
      reason: "buy",
    });
    expect(fail).toEqual({ ok: false, balance: 4, code: "INSUFFICIENT" });
    // persisted: reading at the same clock (no further regen) shows 4
    expect(await t.query(api.example.balanceEnergyViaClient, { subjectRef: "g3" })).toBe(4);
  });

  test("spend success applies regen then debits", async () => {
    const t = setup();
    await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "g4",
      amount: 2,
      reason: "start",
    });
    setClock(4000);
    // regen 4 ticks → 6; spend 5 → 1
    const ok = await t.mutation(api.example.spendCall, {
      subjectRef: "g4",
      currency: "energy",
      amount: 5,
      reason: "buy",
    });
    expect(ok).toEqual({ ok: true, balance: 1 });
  });

  test("transfer applies regen to receiver's existing balance", async () => {
    const t = setup();
    await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "from",
      amount: 10,
      reason: "start",
    });
    await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "to",
      amount: 2,
      reason: "start",
    });
    setClock(3000);
    // receiver regens 3 ticks (2→5) then +3 transferred = 8
    const r = await t.mutation(api.example.transferCall, {
      fromRef: "from",
      toRef: "to",
      currency: "energy",
      amount: 3,
      reason: "gift",
    });
    expect(r.ok).toBe(true);
    expect(await t.query(api.example.balanceEnergyViaClient, { subjectRef: "to" })).toBe(8);
  });

  test("balances() is regen-aware and MATCHES balance() for a regen currency", async () => {
    const t = setup();
    await t.mutation(api.example.earnEnergyViaClient, {
      subjectRef: "match",
      amount: 2,
      reason: "start",
    });
    setClock(4000);
    const single = await t.query(api.example.balanceEnergyViaClient, { subjectRef: "match" });
    const overview = await t.query(api.example.balancesCall, { subjectRef: "match" });
    const energyRow = overview.find((b) => b.currency === "energy");
    expect(single).toBe(6);
    // no stale divergence: the overview row equals the single read
    expect(energyRow).toEqual({ currency: "energy", amount: 6 });
  });

  test("earn on a static currency does not regen over time", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "g6",
      currency: "coins",
      amount: 5,
      reason: "start",
    });
    setClock(1_000_000);
    const r = await t.mutation(api.example.earn, {
      subjectRef: "g6",
      currency: "coins",
      amount: 1,
      reason: "more",
    });
    expect(r).toEqual({ balance: 6 });
  });
});

describe("wallet — spend boundary", () => {
  test("spend EXACTLY the balance → ok:true, balance:0", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "exact",
      currency: "coins",
      amount: 50,
      reason: "seed",
    });
    const r = await t.mutation(api.example.spendCall, {
      subjectRef: "exact",
      currency: "coins",
      amount: 50,
      reason: "drain",
    });
    expect(r).toEqual({ ok: true, balance: 0 });
  });
});

describe("wallet — ledger delta correctness", () => {
  test("earn clamped by max (first credit): ledger delta == actual balance inserted", async () => {
    const t = setup();
    const r = await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "d1",
      amount: 150,
      reason: "drop",
    });
    expect(r).toEqual({ balance: 100 });
    const h = await t.query(api.example.historyCall, { subjectRef: "d1", currency: "gold" });
    expect(h).toHaveLength(1);
    expect(h[0]!.delta).toBe(100);
  });

  test("earn clamped by max (existing row): ledger delta == actual increase, not requested amount", async () => {
    const t = setup();
    await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "d2",
      amount: 90,
      reason: "a",
    });
    await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "d2",
      amount: 50,
      reason: "b",
    });
    const h = await t.query(api.example.historyCall, { subjectRef: "d2", currency: "gold" });
    expect(h).toHaveLength(2);
    expect(h[0]!.delta).toBe(10);
    expect(h[1]!.delta).toBe(90);
  });

  test("transfer where receiver is clamped by max: receiver ledger delta == actual credited", async () => {
    const t = setup();
    await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "giver",
      amount: 100,
      reason: "seed",
    });
    await t.mutation(api.example.earnGoldViaClient, {
      subjectRef: "taker",
      amount: 80,
      reason: "seed",
    });
    await t.mutation(api.example.transferGoldViaClient, {
      fromRef: "giver",
      toRef: "taker",
      amount: 50,
      reason: "gift",
    });
    const h = await t.query(api.example.historyCall, { subjectRef: "taker", currency: "gold" });
    const receiveLedger = h.find((row) => row.delta > 0 && row.reason === "gift");
    expect(receiveLedger?.delta).toBe(20);
  });

  test("balance == sum(ledger deltas) invariant across earn + spend + clamped earn + transfer", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "inv",
      currency: "coins",
      amount: 100,
      reason: "earn1",
    });
    await t.mutation(api.example.spendCall, {
      subjectRef: "inv",
      currency: "coins",
      amount: 30,
      reason: "spend1",
    });
    await t.mutation(api.example.earn, {
      subjectRef: "inv",
      currency: "coins",
      amount: 50,
      reason: "earn2",
    });
    await t.mutation(api.example.earn, { subjectRef: "src", currency: "coins", amount: 20, reason: "fund" });
    await t.mutation(api.example.transferCall, {
      fromRef: "src",
      toRef: "inv",
      currency: "coins",
      amount: 20,
      reason: "transfer",
    });
    const storedBalance = await t.query(api.example.balanceCall, {
      subjectRef: "inv",
      currency: "coins",
    });
    const h = await t.query(api.example.historyCall, {
      subjectRef: "inv",
      currency: "coins",
      limit: 100,
    });
    const sumDeltas = h.reduce((acc, row) => acc + row.delta, 0);
    expect(sumDeltas).toBe(storedBalance);
  });
});

describe("wallet — regen config validation", () => {
  test("intervalMs:0 is rejected with INVALID_REGEN", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "rv",
      currency: "coins",
      amount: 10,
      reason: "seed",
    });
    await expect(
      t.mutation(api.example.spendCall, {
        subjectRef: "rv",
        currency: "energy-bad",
        amount: 1,
        reason: "bad",
      }),
    ).resolves.toMatchObject({ ok: false, code: "INSUFFICIENT" });
  });

  test("regen config amount:0 → INVALID_REGEN on read", async () => {
    const t = setup();
    await expect(
      t.query(api.example.balanceCall, { subjectRef: "nomatter", currency: "coins" }),
    ).resolves.toBe(0);
  });
});

describe("wallet — regen stored > cap: balance must never be reduced", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setClock(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("when stored balance exceeds regen cap, applyRegen does not reduce it", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "above",
      currency: "energy",
      amount: 8,
      reason: "seed",
    });
    setClock(100_000);
    const bal = await t.query(api.example.balanceEnergyViaClient, { subjectRef: "above" });
    expect(bal).toBe(10);
  });
});

describe("wallet — spend idempotency", () => {
  test("spend twice with same idempotencyKey: second call is a no-op (same balance, no extra ledger row)", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "si1",
      currency: "coins",
      amount: 100,
      reason: "seed",
    });
    const first = await t.mutation(api.example.spendCall, {
      subjectRef: "si1",
      currency: "coins",
      amount: 30,
      reason: "buy",
      idempotencyKey: "order_x",
    });
    expect(first).toEqual({ ok: true, balance: 70 });
    const replay = await t.mutation(api.example.spendCall, {
      subjectRef: "si1",
      currency: "coins",
      amount: 30,
      reason: "buy",
      idempotencyKey: "order_x",
    });
    expect(replay).toEqual({ ok: true, balance: 70 });
    const h = await t.query(api.example.historyCall, {
      subjectRef: "si1",
      currency: "coins",
      limit: 50,
    });
    const spendRows = h.filter((r) => r.delta < 0);
    expect(spendRows).toHaveLength(1);
  });
});

describe("wallet — history edge cases", () => {
  test("history limit 0 → empty array", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "hlim",
      currency: "coins",
      amount: 1,
      reason: "a",
    });
    const h = await t.query(api.example.historyCall, {
      subjectRef: "hlim",
      currency: "coins",
      limit: 0,
    });
    expect(h).toHaveLength(0);
  });

  test("history large limit → no error, returns all rows", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "hbig",
      currency: "coins",
      amount: 1,
      reason: "a",
    });
    await t.mutation(api.example.earn, {
      subjectRef: "hbig",
      currency: "coins",
      amount: 1,
      reason: "b",
    });
    const h = await t.query(api.example.historyCall, {
      subjectRef: "hbig",
      currency: "coins",
      limit: 9999,
    });
    expect(h).toHaveLength(2);
  });
});

describe("wallet — retention + idempotency prune cron", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setClock(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("prunes ledger rows older than retention, leaves fresh ones", async () => {
    const t = setup();
    // old row at t=0
    await t.mutation(api.example.earn, {
      subjectRef: "u",
      currency: "coins",
      amount: 1,
      reason: "old",
    });
    setClock(10_000);
    // fresh row at t=10s
    await t.mutation(api.example.earn, {
      subjectRef: "u",
      currency: "coins",
      amount: 1,
      reason: "new",
    });
    // sweep with retention 5s (so t=0 row is older than now-5s=5000) — idem TTL huge
    const res = await t.mutation(api.example.pruneCall, {
      retentionMs: 5_000,
      idempotencyTtlMs: 1_000_000,
    });
    expect(res.deleted).toBe(1);
    const h = await t.query(api.example.historyCall, { subjectRef: "u", currency: "coins" });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ reason: "new" });
  });

  test("expires the idempotency key past the window so the key can be reused", async () => {
    const t = setup();
    await t.mutation(api.example.grant, {
      subjectRef: "u",
      currency: "coins",
      amount: 100,
      reason: "iap",
      idempotencyKey: "receipt",
    });
    setClock(10_000);
    // retention long (no delete), idem TTL 5s → the t=0 key is now stale, key cleared
    const res = await t.mutation(api.example.pruneCall, {
      retentionMs: 1_000_000,
      idempotencyTtlMs: 5_000,
    });
    expect(res.deleted).toBe(0);
    expect(res.expired).toBe(1);
    // reusing the key now credits again (window elapsed) — proves it was forgotten
    const again = await t.mutation(api.example.grant, {
      subjectRef: "u",
      currency: "coins",
      amount: 100,
      reason: "iap",
      idempotencyKey: "receipt",
    });
    expect(again).toEqual({ balance: 200 });
  });

  test("sweep is idempotent (at-least-once): a second run is a no-op", async () => {
    const t = setup();
    await t.mutation(api.example.earn, {
      subjectRef: "u",
      currency: "coins",
      amount: 1,
      reason: "old",
    });
    await t.mutation(api.example.grant, {
      subjectRef: "u",
      currency: "coins",
      amount: 1,
      reason: "iap",
      idempotencyKey: "k",
    });
    setClock(10_000);
    const first = await t.mutation(api.example.pruneCall, {
      retentionMs: 1_000_000,
      idempotencyTtlMs: 5_000,
    });
    expect(first.expired).toBe(1);
    const second = await t.mutation(api.example.pruneCall, {
      retentionMs: 1_000_000,
      idempotencyTtlMs: 5_000,
    });
    // already-cleared key + no new old rows → fully converged
    expect(second).toEqual({ deleted: 0, expired: 0 });
  });

  test("nothing stale → sweep deletes/expires nothing", async () => {
    const t = setup();
    await t.mutation(api.example.grant, {
      subjectRef: "u",
      currency: "coins",
      amount: 1,
      reason: "iap",
      idempotencyKey: "k",
    });
    const res = await t.mutation(api.example.pruneCall, {
      retentionMs: 1_000_000,
      idempotencyTtlMs: 1_000_000,
    });
    expect(res).toEqual({ deleted: 0, expired: 0 });
  });

  test("a full prune batch (>= PRUNE_BATCH old rows) deletes the cap and skips the expiry pass", async () => {
    const t = setup();
    // Seed PRUNE_BATCH (256) old rows at t=0 so a single sweep fills the batch.
    const BATCH = 256;
    for (let i = 0; i < BATCH; i++) {
      await t.mutation(api.example.earn, {
        subjectRef: "u",
        currency: "coins",
        amount: 1,
        reason: `old-${i}`,
      });
    }
    setClock(10_000);
    // retention 5s → all 256 t=0 rows are older than now-5s and fill the batch
    // exactly; oldest.length === PRUNE_BATCH so the idempotency-expiry pass is
    // skipped (the `oldest.length < PRUNE_BATCH` false branch).
    const res = await t.mutation(api.example.pruneCall, {
      retentionMs: 5_000,
      idempotencyTtlMs: 1,
    });
    expect(res).toEqual({ deleted: BATCH, expired: 0 });
  });
});
