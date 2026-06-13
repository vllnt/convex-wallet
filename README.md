<!-- Badges -->
[![Convex Component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-wallet.svg)](https://www.npmjs.com/package/@vllnt/convex-wallet)
[![CI](https://github.com/vllnt/convex-wallet/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-wallet/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-wallet.svg)](./LICENSE)

# @vllnt/convex-wallet

Consumable balances and economy ledger with atomic spend and lazy regen, as a
Convex component.

Hold per-subject balances of any consumable currency — coins, energy, gems,
credits — with **atomic spend** (no double-spend, never negative), a typed
**ledger** of every change, **idempotent grants**, and **lazy time-regen** for
energy-style currencies. Domain-neutral: `subjectRef` and `currency` are opaque
host strings. The host owns identity, meaning, and **payment confirmation** —
verify the IAP / Stripe purchase, then call `grant`. This component never
processes payments.

## Features

- **Atomic spend** — debits ride the Convex mutation transaction; never goes negative, never double-spends.
- **Abuse-guarded amounts** — every value-moving call rejects non-finite or non-positive amounts (`INVALID_AMOUNT`); a negative `spend` can never mint funds.
- **Typed ledger** — every earn / spend / transfer is recorded with a signed `delta` (the actual balance change, not the requested amount), `reason`, and timestamp. On a clamped credit, `delta` equals the actual increase, not the requested amount.
- **Idempotent grants** — `grant(...)` credits exactly once per `idempotencyKey`, scoped per `(subjectRef, currency)`; safe to replay after a verified purchase.
- **Idempotent spend** — `spend(...)` also accepts an optional `idempotencyKey`; a replay returns the current balance without a second debit or ledger row.
- **Lazy time-regen** — energy-style currencies regenerate `amount` per `intervalMs` up to a `cap`, computed on read from the **server clock** (regen reads need no cron). A backwards/stale clock can never over-regen. Regen config fields (`intervalMs`, `amount`, `cap`) are validated — non-finite or non-positive values throw `INVALID_REGEN`.
- **Per-currency `max`** — an optional hard ceiling on the stored balance; credits clamp to it. Regen never reduces a balance below its stored value.
- **Multi-currency** — any number of opaque currencies per subject, with a regen-aware per-subject overview.
- **Transfers** — move a currency between two subjects in one transaction; self-transfer is rejected (`SELF_TRANSFER`).
- **Typed error codes** — a rejected spend/transfer returns a stable `code` (`INSUFFICIENT` | `SELF_TRANSFER`); `reason` is the human ledger note.
- **Self-pruning ledger** — an internal idempotent cron prunes ledger rows past a retention window and expires idempotency keys past their window.
- **Opaque refs** — `subjectRef` and `currency` are arbitrary host strings; the component never inspects them.

## Architecture

```
src/
├── shared.ts              # RegenConfig + applyRegen + assertPositiveAmount (pure) + constants
├── test.ts                # convex-test register() helper
├── client/                # Wallet class (the public API)
└── component/             # schema (balances + ledger) + mutations + queries + crons
```

Sandboxed tables: `balances {subjectRef, currency, amount, lastRegenAt,
lifetimeEarned, lifetimeSpent}` (one per `(subjectRef, currency)`) and
`ledger {subjectRef, currency, delta, reason, idempotencyKey?, createdAt}`.
Idempotency is indexed per `(subjectRef, currency, idempotencyKey)` so a key
reused across subjects/currencies is independent.

The `Wallet` client injects each currency's `regen` rule and `max` ceiling (from
its per-currency config) into every call. **Time is server-sourced**: every
handler reads `Date.now()` itself, so a host can never forge the clock to
over-regen. An internal hourly cron prunes the ledger past its retention window
and expires stale idempotency keys (both idempotent / at-least-once safe).

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

See [docs/API.md](docs/API.md). Summary:

| Method | Kind | Result |
|--------|------|--------|
| `earn(ctx, subjectRef, currency, amount, reason, opts?)` | mutation | `{ balance }` (new balance, clamped to `max`) |
| `grant(ctx, subjectRef, currency, amount, reason, idempotencyKey)` | mutation | `{ balance }` (credited once per key) |
| `spend(ctx, subjectRef, currency, amount, reason, opts?)` | mutation | `{ ok, balance, code? }` (`INSUFFICIENT`); `opts.idempotencyKey` makes replay a no-op |
| `transfer(ctx, fromRef, toRef, currency, amount, reason)` | mutation | `{ ok, balance, code? }` (`INSUFFICIENT` \| `SELF_TRANSFER`) |
| `balance(ctx, subjectRef, currency)` | query | `number` (regen-aware; missing → 0) |
| `balances(ctx, subjectRef)` | query | `{ currency, amount }[]` (regen-aware) |
| `history(ctx, subjectRef, currency, limit?)` | query | `LedgerEntry[]` (newest-first) |

Every value-moving call (`earn` / `grant` / `spend` / `transfer`) throws
`INVALID_AMOUNT` when `amount` is not a finite number `> 0`. Regen configs throw
`INVALID_REGEN` when `intervalMs`, `amount`, or `cap` is not a finite positive number.

Per-currency config: `{ regen?: { amount, intervalMs, cap }, max? }`.
Client options: `new Wallet(component, { currencies?, defaultHistoryLimit = 50 })`.

## React

Optional, tree-shakeable hooks (`@vllnt/convex-wallet/react`) over Convex's
`useQuery`. `react` is an optional peer dependency — a backend-only consumer
pulls none of this code. The hooks take the **host's** re-exported query
references; the component never imports your `api`.

```tsx
// app/Balance.tsx
import { useBalance, useBalances } from "@vllnt/convex-wallet/react";
import { api } from "../convex/_generated/api";

export function Energy({ userId }: { userId: string }) {
  // `api.economy.energy` is the host's query that calls `wallet.balance(...)`.
  const energy = useBalance(api.economy.energy, { subjectRef: userId, currency: "energy" });
  if (energy === undefined) return <span>…</span>;
  return <span>{energy} energy</span>;
}

export function Wallet({ userId }: { userId: string }) {
  // `api.economy.allBalances` is the host's query that calls `wallet.balances(...)`.
  const balances = useBalances(api.economy.allBalances, { subjectRef: userId });
  return <ul>{balances?.map((b) => <li key={b.currency}>{b.currency}: {b.amount}</li>)}</ul>;
}
```

| Hook | Args | Result |
|------|------|--------|
| `useBalance(balanceRef, { subjectRef, currency })` | host's `balance` query ref | `number \| undefined` |
| `useBalances(balancesRef, { subjectRef })` | host's `balances` query ref | `BalanceEntry[] \| undefined` |

## Security Model

The component is **auth-agnostic** and **payment-agnostic**: it never
authenticates, authorizes, or processes payments. The host resolves identity,
decides whether a caller may spend, **verifies any IAP / Stripe purchase**, then
calls in with an opaque `subjectRef` and `currency`. Component tables are
sandboxed — the host reaches them only through the exported functions. Spend and
transfer are atomic within the Convex mutation transaction, so balances never go
negative and grants never double-credit.

### Hardening

This component guards balances, so it is strict:

- **Amount validation** — every value-moving call rejects non-finite or
  non-positive amounts (`INVALID_AMOUNT`). A negative `spend` can never mint
  funds; `NaN`/`Infinity` can never corrupt a balance.
- **Regen config validation** — regen fields (`intervalMs`, `amount`, `cap`) are
  validated at call time; a zero/negative/non-finite value throws `INVALID_REGEN`
  before touching any row (prevents `NaN` corruption from `0 * Infinity`).
- **Server-sourced time** — every handler reads `Date.now()` itself; the host
  never supplies `now`, so a forged/replayed clock cannot drive extra regen.
- **Monotonic regen** — a backwards or equal clock never advances the regen
  pointer or grants units, and the pointer never moves past the current time.
  Regen also never reduces a balance already above the regen cap.
- **Accurate ledger deltas** — the `delta` field in each ledger row reflects the
  actual balance change, not the requested amount; clamped credits record only
  the real increase.
- **Idempotent spend** — `spend` accepts an optional `idempotencyKey`; a replay
  of a key already recorded returns the current balance without a second debit or
  ledger row, preventing host-retry double-charges.
- **Per-`(subject, currency)` idempotency** — a key is scoped to one subject and
  currency, so reusing it elsewhere is independent (no silently-dropped grants),
  and replays return the originally-affected balance.
- **Self-transfer guard** — `transfer` with `fromRef === toRef` is rejected
  (`SELF_TRANSFER`) and never debits-then-credits a single row.
- **`max` ceiling** — credits clamp to a per-currency hard cap.

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test`
(`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
