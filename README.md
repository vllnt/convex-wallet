# @vllnt/convex-wallet

TypeScript Convex component for virtual currency wallets: coin, credit and
energy balances with atomic spend, transfers, regen over time and a ledger.

## For coding agents

Docs for the installed version are in `node_modules/@vllnt/convex-wallet/`:
`docs/API.md`, `llms.txt`, `CHANGELOG.md` and the TypeScript `src/`. Read them
before writing code against this package.

## When to use

- Use it when users earn and spend an in-app currency (coins, gems, credits).
- Use it when a spend or transfer must never overdraw, even under concurrency.
- Use it when a currency refills over time up to a cap (energy, lives).
- Do not use it when the allowance resets on a schedule: use
  [`@vllnt/convex-quota`](https://oss.vllnt.com/packages/convex-quota).
- Do not use it when you bill recorded usage per period: use
  [`@vllnt/convex-metering`](https://oss.vllnt.com/packages/convex-metering).
- Do not use it when you track XP, levels or streaks that are never spent: use
  [`@vllnt/convex-progression`](https://oss.vllnt.com/packages/convex-progression).

## Install

```bash
pnpm add @vllnt/convex-wallet
```

## Quick start

```ts
// convex/convex.config.ts
import wallet from "@vllnt/convex-wallet/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(wallet);
export default app;
```

```ts
// convex/economy.ts
import { Wallet } from "@vllnt/convex-wallet";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";

// One client for the app, so every function applies the same currency rules.
export const wallet = new Wallet(components.wallet, {
  currencies: {
    energy: { regen: { amount: 1, intervalMs: 60_000, cap: 5 } },
  },
});

const PRICES = { shield: 20, sword: 30 };

// Call from your payment webhook after it has verified the receipt.
export const creditPurchase = internalMutation({
  args: { subjectRef: v.string(), coins: v.number(), receiptId: v.string() },
  returns: v.number(),
  handler: async (ctx, { subjectRef, coins, receiptId }) => {
    const { balance } = await wallet.grant(
      ctx,
      subjectRef,
      "coins",
      coins,
      "purchase",
      receiptId,
    );
    return balance;
  },
});

export const buyItem = mutation({
  args: { item: v.union(v.literal("shield"), v.literal("sword")) },
  returns: v.boolean(),
  handler: async (ctx, { item }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) return false;
    const result = await wallet.spend(
      ctx,
      user.tokenIdentifier,
      "coins",
      PRICES[item],
      `buy ${item}`,
    );
    return result.ok;
  },
});

export const myCoins = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) return 0;
    return wallet.balance(ctx, user.tokenIdentifier, "coins");
  },
});
```

Run `npx convex dev` once to generate `components.wallet`. The component never
reads auth or payments: the host derives `subjectRef` (here the user's
`tokenIdentifier`), sets prices, and calls `grant` only after it has verified a
purchase.

## API

Full reference: [docs/API.md](docs/API.md).

| Export                                                                                  | Import from                                 | What it does                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| [`Wallet`](docs/API.md#wallet)                                                          | `@vllnt/convex-wallet`                      | Host client: `new Wallet(components.wallet, options?)`    |
| [`earn(ctx, subjectRef, currency, amount, reason, opts?)`](docs/API.md#earn)            | `Wallet` method, mutation                   | Credit, clamped to `max`; returns `{ balance }`           |
| [`grant(ctx, subjectRef, currency, amount, reason, idempotencyKey)`](docs/API.md#grant) | `Wallet` method, mutation                   | Credit once per key (7-day window); returns `{ balance }` |
| [`spend(ctx, subjectRef, currency, amount, reason, opts?)`](docs/API.md#spend)          | `Wallet` method, mutation                   | Debit, never negative; returns `{ ok, balance, code? }`   |
| [`transfer(ctx, fromRef, toRef, currency, amount, reason)`](docs/API.md#transfer)       | `Wallet` method, mutation                   | Move between subjects; returns `{ ok, balance, code? }`   |
| [`balance(ctx, subjectRef, currency)`](docs/API.md#balance)                             | `Wallet` method, query                      | Regen-aware balance; `0` when missing                     |
| [`balances(ctx, subjectRef)`](docs/API.md#balances)                                     | `Wallet` method, query                      | Every stored currency balance, regen-aware                |
| [`history(ctx, subjectRef, currency, limit?)`](docs/API.md#history)                     | `Wallet` method, query                      | Newest-first ledger rows (default 50, max 1000)           |
| [`WalletComponent`](docs/API.md#walletcomponent)                                        | `@vllnt/convex-wallet` (type)               | Type of `components.wallet`                               |
| [`WalletOptions`](docs/API.md#walletoptions)                                            | `@vllnt/convex-wallet` (type)               | `{ currencies?, defaultHistoryLimit? }`                   |
| [`RegenConfig`](docs/API.md#regenconfig)                                                | `@vllnt/convex-wallet` (type)               | `{ amount, intervalMs, cap }`                             |
| [`SpendResult`](docs/API.md#spendresult)                                                | `@vllnt/convex-wallet` (type)               | Result of `spend` and `transfer`                          |
| [`ErrorCode`](docs/API.md#errorcode)                                                    | `@vllnt/convex-wallet` (type)               | `"INSUFFICIENT" \| "SELF_TRANSFER"`                       |
| [`BalanceEntry`](docs/API.md#balanceentry)                                              | `@vllnt/convex-wallet` (type)               | `{ currency, amount }`                                    |
| [`LedgerEntry`](docs/API.md#ledgerentry)                                                | `@vllnt/convex-wallet` (type)               | `{ currency, delta, reason, idempotencyKey?, createdAt }` |
| [`useBalance`](docs/API.md#usebalance)                                                  | `@vllnt/convex-wallet/react`                | React hook over your own `balance` query                  |
| [`useBalances`](docs/API.md#usebalances)                                                | `@vllnt/convex-wallet/react`                | React hook over your own `balances` query                 |
| [`default` (component config)](docs/API.md#convexconfig)                                | `@vllnt/convex-wallet/convex.config`        | Pass to `app.use(...)`                                    |
| [`register`](docs/API.md#register)                                                      | `@vllnt/convex-wallet/test`                 | Mount the component in `convex-test`                      |
| [`ComponentApi`](docs/API.md#componentapi)                                              | `@vllnt/convex-wallet/_generated/component` | Generated type of the mounted component                   |

## Common tasks

Energy that refills over time. `spend` applies the refill first; reads project
it without writing:

```ts
// convex/game.ts
import { v } from "convex/values";

import { wallet } from "./economy";
import { mutation } from "./_generated/server";

export const playRound = mutation({
  args: {},
  returns: v.object({ played: v.boolean(), energyLeft: v.number() }),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) return { played: false, energyLeft: 0 };
    const result = await wallet.spend(
      ctx,
      user.tokenIdentifier,
      "energy",
      1,
      "round",
    );
    return { played: result.ok, energyLeft: result.balance };
  },
});
```

A new subject has no `energy` row, so it starts at `0`, not at `cap`. Give it a
starting amount with `earn` (for example at sign-up); regen applies from then
on.

Make a spend safe to retry. A replay with the same key for the same subject and
currency returns the current balance and debits nothing:

```ts
// convex/checkout.ts
import { v } from "convex/values";

import { wallet } from "./economy";
import { mutation } from "./_generated/server";

const PRICES = { boost: 5, skin: 50 };

export const checkout = mutation({
  args: {
    orderId: v.string(),
    item: v.union(v.literal("boost"), v.literal("skin")),
  },
  returns: v.boolean(),
  handler: async (ctx, { orderId, item }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) return false;
    const result = await wallet.spend(
      ctx,
      user.tokenIdentifier,
      "coins",
      PRICES[item],
      `buy ${item}`,
      { idempotencyKey: `checkout:${orderId}` },
    );
    return result.ok;
  },
});
```

Send coins to another user and report why a transfer failed:

```ts
// convex/gifts.ts
import { v } from "convex/values";

import { wallet } from "./economy";
import { mutation } from "./_generated/server";

export const giftCoins = mutation({
  args: { toRef: v.string(), amount: v.number() },
  returns: v.union(
    v.literal("sent"),
    v.literal("INSUFFICIENT"),
    v.literal("SELF_TRANSFER"),
    v.literal("signed out"),
  ),
  handler: async (ctx, { toRef, amount }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) return "signed out";
    const result = await wallet.transfer(
      ctx,
      user.tokenIdentifier,
      toRef,
      "coins",
      amount,
      "gift",
    );
    return result.ok ? "sent" : (result.code ?? "INSUFFICIENT");
  },
});
```

Show the latest ledger rows and every balance of the signed-in user:

```ts
// convex/statement.ts
import { v } from "convex/values";

import { wallet } from "./economy";
import { query } from "./_generated/server";

export const statement = query({
  args: {},
  returns: v.object({
    balances: v.array(v.object({ currency: v.string(), amount: v.number() })),
    recent: v.array(
      v.object({
        currency: v.string(),
        delta: v.number(),
        reason: v.string(),
        idempotencyKey: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) return { balances: [], recent: [] };
    return {
      balances: await wallet.balances(ctx, user.tokenIdentifier),
      recent: await wallet.history(ctx, user.tokenIdentifier, "coins", 20),
    };
  },
});
```

Read a balance from React. The hooks take your own public queries, which must
accept exactly `{ subjectRef, currency }` (or `{ subjectRef }`) and must check
that the caller may read that subject:

```ts
// convex/balances.ts
import { ConvexError, v } from "convex/values";

import { wallet } from "./economy";
import { query } from "./_generated/server";

export const balance = query({
  args: { subjectRef: v.string(), currency: v.string() },
  returns: v.number(),
  handler: async (ctx, { subjectRef, currency }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user?.tokenIdentifier !== subjectRef) {
      throw new ConvexError("forbidden");
    }
    return wallet.balance(ctx, subjectRef, currency);
  },
});
```

```tsx
// src/CoinCount.tsx
import { useBalance } from "@vllnt/convex-wallet/react";

import { api } from "../convex/_generated/api";

export function CoinCount({ subjectRef }: { subjectRef: string }) {
  const coins = useBalance(api.balances.balance, {
    subjectRef,
    currency: "coins",
  });
  return <span>{coins === undefined ? "loading" : `${coins} coins`}</span>;
}
```

Mount the component twice. Named mounts share no balances, ledger rows or
scheduled work:

```ts
// convex/convex.config.ts
import wallet from "@vllnt/convex-wallet/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(wallet, { name: "webWallet" });
app.use(wallet, { name: "gameWallet" });
export default app;
```

```ts
// convex/wallets.ts
import { Wallet } from "@vllnt/convex-wallet";

import { components } from "./_generated/api";

export const webWallet = new Wallet(components.webWallet);
export const gameWallet = new Wallet(components.gameWallet);
```

## Errors and fixes

`spend` and `transfer` do not throw when they cannot debit. They return
`{ ok: false, balance, code }`, where `balance` is the current balance:

| Code            | Returned by         | Cause                                                                        | Fix                                                  |
| --------------- | ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| `INSUFFICIENT`  | `spend`, `transfer` | The balance after regen is below `amount`, or the subject has no balance row | Credit first with `earn` or `grant`, or ask for less |
| `SELF_TRANSFER` | `transfer`          | `fromRef` equals `toRef`                                                     | Pass two different subjects                          |

Invalid input throws. Most codes are a `ConvexError` whose `data` is
`{ code, message }`; read `error.data.code` after
`error instanceof ConvexError`. `INVALID_AMOUNT` and `INVALID_REGEN` are a plain
`Error` whose message contains the code. Nothing is written when a call throws.

| Code                     | Thrown as     | Message                                                         | Cause                                                                                                                      | Fix                                                                             |
| ------------------------ | ------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `INVALID_AMOUNT`         | `Error`       | `INVALID_AMOUNT`                                                | `earn`, `grant`, `spend` or `transfer` got an `amount` that is `0`, negative, `NaN`, `Infinity` or above 2^53 - 1          | Pass a positive finite amount; use integer minor units such as cents            |
| `INVALID_ARGUMENT`       | `ConvexError` | `<name> must not be empty`                                      | `subjectRef`, `fromRef`, `toRef`, `currency`, `reason` or `idempotencyKey` is `""` on `earn`, `grant`, `spend`, `transfer` | Pass non-empty strings                                                          |
| `INVALID_MAX`            | `ConvexError` | `max must be a number >= 0`                                     | A currency's `max` is `NaN` or negative (checked by `earn`, `grant`, `transfer`)                                           | Fix `currencies[currency].max` in `WalletOptions`                               |
| `INVALID_REGEN`          | `Error`       | `INVALID_REGEN`                                                 | A `regen` rule has an `amount`, `intervalMs` or `cap` that is not finite or not above 0, applied to an existing balance    | Fix `currencies[currency].regen`; all three fields must be finite and above 0   |
| `INVALID_LIMIT`          | `ConvexError` | `limit must be an integer between 1 and 1000`                   | `history` got a `limit` (or `defaultHistoryLimit`) that is not an integer from 1 through 1000                              | Pass an integer from 1 through 1000                                             |
| `BALANCE_OVERFLOW`       | `ConvexError` | `balance would exceed Number.MAX_SAFE_INTEGER`                  | A credit would push the balance or its lifetime-earned counter past 2^53 - 1                                               | Credit less; choose a larger unit                                               |
| `IDEMPOTENCY_KEY_REUSED` | `ConvexError` | `idempotencyKey was already used by a credit` (or `by a debit`) | A key recorded by `earn`/`grant` was reused on `spend` for the same subject and currency, or the reverse                   | Use a distinct key per operation, for example prefix it with the operation name |

Arguments of the wrong type (for example a string `amount`) are rejected by
Convex argument validation before the component runs.

## Limits and gotchas

- Amounts are JavaScript numbers in (0, 2^53 - 1]. Fractions are accepted but
  sums are not exact; store integer minor units.
- `history` returns at most 1000 rows per call; the default page is 50
  (`defaultHistoryLimit`). There is no cursor.
- Ledger rows are deleted 90 days after they are written, by an hourly internal
  sweep. Idempotency keys are forgotten 7 days after they are written, cleared
  by the first sweep after that (up to about one hour later). Neither window is
  configurable. A replay after a key is cleared is applied again.
- `earn`/`grant` and `spend` share one key namespace per subject and currency.
  `transfer` has no idempotency key; a retried transfer moves funds twice.
- A replayed key returns success with the current balance; it does not tell you
  it was a replay.
- `spend` with a key that ends `INSUFFICIENT` writes no ledger row and does not
  record the key, so a retry with the same key can succeed later.
- A credit to a balance already at or above `max` adds nothing and still writes
  a ledger row with `delta` 0 (accrued regen is still saved). Lowering `max`
  never reduces a stored balance.
- `max` does not cap regen: a `regen.cap` above `max` lets the balance
  regenerate past `max`.
- A transfer to a receiver near `max` credits only up to `max`; the sender is
  still debited the full `amount`.
- A subject without a balance row reads `0`, even for a regen currency, and is
  not listed by `balances`. Regen starts after the first credit.
- Queries project regen without writing it. The stored balance catches up on the
  next `earn`, `grant`, `spend` or `transfer`. A subscribed query (and so a
  React hook) is not re-run when a regen tick passes, only when its data
  changes.
- Regen ticks are not ledgered, so `sum(delta)` equals the balance only for
  currencies without regen, and only while rows are retained.
- Currency rules live in the client, not in the component. Two `Wallet` clients
  with different `currencies` on one mount compute different balances: create
  one client and import it.
- An invalid `regen` rule is not rejected on the first credit or when the
  balance row is missing; it throws `INVALID_REGEN` once regen applies.
- Queries (`balance`, `balances`, `history`) do not reject empty strings; they
  return `0` or empty arrays.
- The internal sweep (`pruneLedger`) cannot be called by the host.

## Compatibility

- Peer dependency `convex@^1.45.0`. CI runs the tests on convex 1.51 with
  convex-test 0.0.73, and type-checks and runs the packed package against convex
  1.51.0.
- Optional peer `react >=18`, needed only for `@vllnt/convex-wallet/react`.
- Node.js `>=20` with convex 1.45–1.48; Node.js 22 or later with convex 1.49
  and newer, which require it. ES modules only.
- `@vllnt/convex-wallet/test` is TypeScript source and needs `convex-test`,
  `vitest`, `vite` (for `import.meta.glob`) and `@edge-runtime/vm` (for the
  Testing config): `pnpm add -D convex-test vitest vite @edge-runtime/vm`.
  convex-test 0.0.73 needs convex 1.46 or later.
- Unreleased builds from `main` are published under the `canary` dist-tag.

## Testing

Mount the component in your own `convex-test` suite with `register`; it works
with any host schema. Use the Vitest settings `convex-test` recommends:

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

```ts
// convex/economy.test.ts
/// <reference types="vite/client" />
import { register } from "@vllnt/convex-wallet/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

test("a purchase credits coins that the player can spend", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  register(t);
  const player = t.withIdentity({ tokenIdentifier: "player-1" });
  await t.mutation(internal.economy.creditPurchase, {
    subjectRef: "player-1",
    coins: 25,
    receiptId: "receipt-1",
  });
  expect(await player.mutation(api.economy.buyItem, { item: "shield" })).toBe(
    true,
  );
  expect(await player.mutation(api.economy.buyItem, { item: "sword" })).toBe(
    false,
  );
  expect(await player.query(api.economy.myCoins, {})).toBe(5);
});
```

`register(t, name)` takes the mount name when you used
`app.use(wallet, { name })`.

This repository's own tests use the simulated `convex-test` runtime
(`pnpm test:coverage`, 100% coverage enforced). They do not prove production
concurrency or scheduler delivery.

## Security

- The component does not authenticate or process payments. The host must
  authorize every call, derive `subjectRef` itself (never accept it unchecked
  from the client), set prices server-side, and call `grant` only after
  verifying a purchase.
- Its tables are reachable only through the component's functions.
- `spend` and `transfer` run inside one Convex mutation transaction, so
  concurrent debits conflict and Convex retries them; a balance never goes
  negative.
- Every handler reads `Date.now()` itself; callers cannot pass a clock to drive
  extra regen.

Report vulnerabilities as described in
[SECURITY.md](https://github.com/vllnt/convex-wallet/blob/main/SECURITY.md).

## Related packages

None. This package has no dependency, shared test or example with another
package.

## Contributing

See
[CONTRIBUTING.md](https://github.com/vllnt/convex-wallet/blob/main/CONTRIBUTING.md).

## Links

- Docs and changelog: [oss.vllnt.com/packages/convex-wallet](https://oss.vllnt.com/packages/convex-wallet) · [release feed](https://oss.vllnt.com/packages/convex-wallet/rss.xml)
- All @vllnt packages: [oss.vllnt.com](https://oss.vllnt.com) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)
- Source and issues: [GitHub](https://github.com/vllnt/convex-wallet) · [issues](https://github.com/vllnt/convex-wallet/issues) · [npm](https://www.npmjs.com/package/@vllnt/convex-wallet)
- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)
- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)
- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)

## License

MIT. See [LICENSE](LICENSE).

[![npm version of @vllnt/convex-wallet](https://img.shields.io/npm/v/@vllnt/convex-wallet.svg)](https://www.npmjs.com/package/@vllnt/convex-wallet)
[![CI status of convex-wallet](https://github.com/vllnt/convex-wallet/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-wallet/actions/workflows/ci.yml)

---

Part of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/convex-wallet) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)
