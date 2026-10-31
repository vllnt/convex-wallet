<!-- Badges -->

[![Convex Component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-wallet.svg)](https://www.npmjs.com/package/@vllnt/convex-wallet)
[![CI](https://github.com/vllnt/convex-wallet/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-wallet/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-wallet.svg)](./LICENSE)

# @vllnt/convex-wallet

Consumable balances and economy ledger with atomic spend and lazy regen, as a
Convex component — hold per-subject balances of any opaque currency (coins,
energy, gems, credits).

```ts
const wallet = new Wallet(components.wallet, {
  currencies: {
    energy: { regen: { amount: 1, intervalMs: 10_000, cap: 100 } },
  },
});
await wallet.spend(ctx, subjectRef, "coins", 5, "purchase"); // atomic, never negative
const energy = await wallet.balance(ctx, subjectRef, "energy"); // regen-aware
```

## Features

- **Atomic spend** — debits ride the Convex mutation transaction; never goes
  negative, never double-spends.
- **Abuse-guarded amounts** — every value-moving call rejects non-finite,
  non-positive or above-2^53 amounts (`INVALID_AMOUNT`), overflowing balances
  (`BALANCE_OVERFLOW`), empty identifiers (`INVALID_ARGUMENT`) and a reused
  idempotency key across credit and debit (`IDEMPOTENCY_KEY_REUSED`).
- **Typed ledger** — every earn / spend / transfer records a signed `delta` (the
  actual change), `reason`, and timestamp.
- **Idempotent grants & spend** — credit/debit exactly once per
  `idempotencyKey`, scoped per `(subjectRef, currency)`.
- **Lazy time-regen** — energy-style currencies regenerate on read from the
  server clock, no cron.
- **Per-currency `max` ceiling, multi-currency, transfers** — with a
  `SELF_TRANSFER` guard.
- **Typed error codes, self-pruning ledger cron, opaque host refs.**

## Installation

```bash
pnpm add @vllnt/convex-wallet
```

Node.js >=18; required peer: `convex@^1.45.0`. React >=18 is optional. The
default npm channel is stable; use `@vllnt/convex-wallet@canary` for the current
prerelease surface documented here.

## Usage

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import wallet from "@vllnt/convex-wallet/convex.config";

const app = defineApp();
app.use(wallet);
export default app;
```

```ts
// convex/economy.ts — host owns auth + payment confirmation.
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Wallet } from "@vllnt/convex-wallet";

// `energy` regenerates 1 unit / 10s up to 100; `gems` caps at 9999; `coins` is static.
const wallet = new Wallet(components.wallet, {
  currencies: {
    energy: { regen: { amount: 1, intervalMs: 10_000, cap: 100 } },
    gems: { max: 9999 },
  },
});

export const buy = mutation({
  args: { userId: v.string(), cost: v.number() },
  handler: (ctx, { userId, cost }) =>
    wallet.spend(ctx, userId, "coins", cost, "purchase"),
});

// Call AFTER the host has verified the IAP — idempotent on the receipt id.
export const creditPurchase = mutation({
  args: { userId: v.string(), coins: v.number(), receiptId: v.string() },
  handler: (ctx, { userId, coins, receiptId }) =>
    wallet.grant(ctx, userId, "coins", coins, "iap", receiptId),
});

export const energy = query({
  args: { userId: v.string() },
  handler: (ctx, { userId }) => wallet.balance(ctx, userId, "energy"),
});
```

The wrappers above illustrate calls only: authenticate the caller, authorize the
subject, and derive costs and credit amounts from trusted host data before use.
A comment about payment verification is not an authorization check. After
mounting, run `pnpm convex dev` to generate the host's `components` references.

## Configuration and limits

`WalletOptions` supports only `currencies` (default `{}`: static, uncapped) and
`defaultHistoryLimit` (default `50`, integer 1–1000). Currency rules accept
optional `regen: { amount, intervalMs, cap }` and `max`. There are no client
retention or idempotency-TTL options. The internal hourly sweep uses 90-day
ledger retention and a 7-day key-expiry threshold; bounded cleanup may lag those
thresholds. Replay protection ends when the key or ledger row is removed.
Earn/grant and spend share keys per subject/currency; transfer has no replay
key.

Regen is projected when a query executes, not pushed by a clock-driven
subscription. Transfers clamp the receiver's credit to `max`, so a capped
transfer need not preserve the combined balance. This is a consumable wallet,
not payment processing.

## Multiple mounts

```ts
app.use(wallet, { name: "webWallet" });
app.use(wallet, { name: "gameWallet" });
// new Wallet(components.webWallet), new Wallet(components.gameWallet)
```

Each mount has isolated balances, ledger rows and maintenance.

## API Reference

| Method                                                             | Kind     | Result                                                                         |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------ |
| `earn(ctx, subjectRef, currency, amount, reason, opts?)`           | mutation | `{ balance }` (clamped to `max`)                                               |
| `grant(ctx, subjectRef, currency, amount, reason, idempotencyKey)` | mutation | `{ balance }` (credited once per key)                                          |
| `spend(ctx, subjectRef, currency, amount, reason, opts?)`          | mutation | `{ ok, balance, code? }`                                                       |
| `transfer(ctx, fromRef, toRef, currency, amount, reason)`          | mutation | `{ ok, balance, code? }`                                                       |
| `balance(ctx, subjectRef, currency)`                               | query    | `number` (regen-aware)                                                         |
| `balances(ctx, subjectRef)`                                        | query    | `{ currency, amount }[]`                                                       |
| `history(ctx, subjectRef, currency, limit?)`                       | query    | `LedgerEntry[]` (newest-first; `limit` must be an integer from 1 through 1000) |

Full reference: [docs/API.md](docs/API.md) — including per-currency config,
error codes (`INVALID_AMOUNT`, `INVALID_REGEN`, `INVALID_LIMIT`, `INSUFFICIENT`,
`SELF_TRANSFER`), and the regen model.

## React

Optional, tree-shakeable hooks at `@vllnt/convex-wallet/react`; `react` is an
optional peer dep. Pass the host's own re-exported query refs — the component
never imports your `api`.

```tsx
import { useBalance, useBalances } from "@vllnt/convex-wallet/react";
import { api } from "../convex/_generated/api";

// Host queries must accept these exact arguments; these are separate wrappers
// from the userId-based query above, and must authorize subjectRef.
const energy = useBalance(api.wallet.balance, {
  subjectRef: userId,
  currency: "energy",
});
const all = useBalances(api.wallet.balances, { subjectRef: userId });
```

| Hook                                               | Args                        | Result                        |
| -------------------------------------------------- | --------------------------- | ----------------------------- |
| `useBalance(balanceRef, { subjectRef, currency })` | host's `balance` query ref  | `number \| undefined`         |
| `useBalances(balancesRef, { subjectRef })`         | host's `balances` query ref | `BalanceEntry[] \| undefined` |

## Security

- Auth- and payment-agnostic — the host gates access and verifies any IAP /
  Stripe purchase before calling `grant`.
- Tables are sandboxed; spend and transfer are atomic, so balances never go
  negative and grants never double-credit.
- Amounts and regen configs are validated, and time is server-sourced — a forged
  or replayed clock can't drive extra regen.

See [docs/API.md](docs/API.md).

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests use the simulated `convex-test` backend (`@edge-runtime/vm`), not a real
Convex deployment; they do not prove production concurrency or scheduler
delivery.

### Testing your app

`@vllnt/convex-wallet/test` exports `register(t, name = "wallet")` to mount the
component in a `convex-test` instance. It needs `convex-test` and `vitest` (with
Vite's `import.meta.glob`) in the consuming app:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register } from "@vllnt/convex-wallet/test";
import schema from "./schema";

const t = convexTest(schema, import.meta.glob("./**/*.ts"));
register(t);
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) ·
[bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet —
[vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
