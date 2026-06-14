<!-- Badges -->
[![Convex Component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-wallet.svg)](https://www.npmjs.com/package/@vllnt/convex-wallet)
[![CI](https://github.com/vllnt/convex-wallet/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-wallet/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-wallet.svg)](./LICENSE)

# @vllnt/convex-wallet

Consumable balances and economy ledger with atomic spend and lazy regen, as a Convex component — hold per-subject balances of any opaque currency (coins, energy, gems, credits).

```ts
const wallet = new Wallet(components.wallet, {
  currencies: { energy: { regen: { amount: 1, intervalMs: 10_000, cap: 100 } } },
});
await wallet.spend(ctx, subjectRef, "coins", 5, "purchase"); // atomic, never negative
const energy = await wallet.balance(ctx, subjectRef, "energy"); // regen-aware
```

## Features

- **Atomic spend** — debits ride the Convex mutation transaction; never goes negative, never double-spends.
- **Abuse-guarded amounts** — every value-moving call rejects non-finite or non-positive amounts (`INVALID_AMOUNT`).
- **Typed ledger** — every earn / spend / transfer records a signed `delta` (the actual change), `reason`, and timestamp.
- **Idempotent grants & spend** — credit/debit exactly once per `idempotencyKey`, scoped per `(subjectRef, currency)`.
- **Lazy time-regen** — energy-style currencies regenerate on read from the server clock, no cron.
- **Per-currency `max` ceiling, multi-currency, transfers** — with a `SELF_TRANSFER` guard.
- **Typed error codes, self-pruning ledger cron, opaque host refs.**

## Installation

```bash
pnpm add @vllnt/convex-wallet
```

Peer dependency: `convex@^1.41.0`.

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
  handler: (ctx, { userId, cost }) => wallet.spend(ctx, userId, "coins", cost, "purchase"),
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

## API Reference

| Method | Kind | Result |
|--------|------|--------|
| `earn(ctx, subjectRef, currency, amount, reason, opts?)` | mutation | `{ balance }` (clamped to `max`) |
| `grant(ctx, subjectRef, currency, amount, reason, idempotencyKey)` | mutation | `{ balance }` (credited once per key) |
| `spend(ctx, subjectRef, currency, amount, reason, opts?)` | mutation | `{ ok, balance, code? }` |
| `transfer(ctx, fromRef, toRef, currency, amount, reason)` | mutation | `{ ok, balance, code? }` |
| `balance(ctx, subjectRef, currency)` | query | `number` (regen-aware) |
| `balances(ctx, subjectRef)` | query | `{ currency, amount }[]` |
| `history(ctx, subjectRef, currency, limit?)` | query | `LedgerEntry[]` (newest-first) |

Full reference: [docs/API.md](docs/API.md) — including per-currency config, error codes (`INVALID_AMOUNT`, `INVALID_REGEN`, `INSUFFICIENT`, `SELF_TRANSFER`), and the regen model.

## React

Optional, tree-shakeable hooks at `@vllnt/convex-wallet/react`; `react` is an optional peer dep. Pass the host's own re-exported query refs — the component never imports your `api`.

```tsx
import { useBalance, useBalances } from "@vllnt/convex-wallet/react";
import { api } from "../convex/_generated/api";

const energy = useBalance(api.economy.energy, { subjectRef: userId, currency: "energy" });
const all = useBalances(api.economy.allBalances, { subjectRef: userId });
```

| Hook | Args | Result |
|------|------|--------|
| `useBalance(balanceRef, { subjectRef, currency })` | host's `balance` query ref | `number \| undefined` |
| `useBalances(balancesRef, { subjectRef })` | host's `balances` query ref | `BalanceEntry[] \| undefined` |

## Security

- Auth- and payment-agnostic — the host gates access and verifies any IAP / Stripe purchase before calling `grant`.
- Tables are sandboxed; spend and transfer are atomic, so balances never go negative and grants never double-credit.
- Amounts and regen configs are validated, and time is server-sourced — a forged or replayed clock can't drive extra regen.

See [docs/API.md](docs/API.md).

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test` (`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
