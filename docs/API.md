# API Reference — @vllnt/convex-wallet

**Compatibility:** `convex@^1.45.0`, optional `react >=18`, Node.js `>=20` (22+
with convex 1.49 and newer)

## Entry points

| Import                                                 | Exports                                                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@vllnt/convex-wallet`                                 | `Wallet` class; types `WalletComponent`, `WalletOptions`, `RegenConfig`, `SpendResult`, `ErrorCode`, `BalanceEntry`, `LedgerEntry` |
| `@vllnt/convex-wallet/react`                           | `useBalance`, `useBalances` (needs `react`)                                                                                        |
| `@vllnt/convex-wallet/convex.config` (or `.js`)        | default component config for `app.use(...)`                                                                                        |
| `@vllnt/convex-wallet/test`                            | `register(t, name = "wallet")` for `convex-test` (TypeScript source; needs Vite `import.meta.glob`)                                |
| `@vllnt/convex-wallet/_generated/component` (or `.js`) | type `ComponentApi`                                                                                                                |

`subjectRef`, `fromRef`, `toRef` and `currency` are opaque host strings; the
component never inspects them. Every method takes the host `ctx` first: a
mutation context for `earn`, `grant`, `spend` and `transfer`, and a query or
mutation context for `balance`, `balances` and `history`. Every handler reads
the server clock (`Date.now()`) itself; no method takes a time argument.

## Client

### `Wallet`

```ts
new Wallet(component: WalletComponent, options?: WalletOptions)
```

`component` is the mounted component, `components.wallet` (or the name passed to
`app.use`). `options.currencies` maps a currency string to its rules (`regen`,
`max`); a currency without an entry is static and uncapped.
`options.defaultHistoryLimit` defaults to `50`. The constructor does not
validate options: a bad `max` throws `INVALID_MAX` on the next credit, a bad
`regen` throws `INVALID_REGEN` once regen applies, and a bad
`defaultHistoryLimit` throws `INVALID_LIMIT` on `history`.

```ts
import { Wallet } from "@vllnt/convex-wallet";
import { components } from "./_generated/api";

export const wallet = new Wallet(components.wallet, {
  currencies: {
    energy: { regen: { amount: 1, intervalMs: 60_000, cap: 5 } },
    gems: { max: 9999 },
  },
  defaultHistoryLimit: 50,
});
```

### `earn`

```ts
earn(ctx, subjectRef: string, currency: string, amount: number, reason: string, opts?: { idempotencyKey?: string }): Promise<{ balance: number }>
```

Credits `amount` and returns the new balance. Creates the balance row when the
subject did not hold the currency. Regen that accrued is applied first. The
credit is clamped to the currency's `max`; a credit never lowers a balance, so
at or above `max` it writes a ledger row with `delta` 0. The ledger `delta` is
the actual increase.

With `opts.idempotencyKey`, a second call with the same key for the same
`(subjectRef, currency)` returns the current balance and credits nothing. The
same key for another subject or currency is independent. A key already used by
`spend` for that subject and currency throws `IDEMPOTENCY_KEY_REUSED`.

Throws `INVALID_AMOUNT` (not a finite number in `(0, 2^53 - 1]`),
`INVALID_ARGUMENT` (empty `subjectRef`, `currency`, `reason` or
`idempotencyKey`), `INVALID_MAX`, `BALANCE_OVERFLOW` (balance or lifetime earned
past 2^53 - 1), `IDEMPOTENCY_KEY_REUSED` or `INVALID_REGEN`.

```ts
await wallet.earn(ctx, subjectRef, "coins", 10, "daily bonus", {
  idempotencyKey: `daily:${day}`,
});
```

### `grant`

```ts
grant(ctx, subjectRef: string, currency: string, amount: number, reason: string, idempotencyKey: string): Promise<{ balance: number }>
```

`earn` with a required `idempotencyKey`: a replay of the key for the same
subject and currency credits nothing while the key is recorded (at least 7 days;
see Maintenance). Call it after the host has verified a purchase, keyed on the
receipt id. Same errors as `earn`.

```ts
const { balance } = await wallet.grant(
  ctx,
  subjectRef,
  "coins",
  500,
  "iap",
  receiptId,
);
```

### `spend`

```ts
spend(ctx, subjectRef: string, currency: string, amount: number, reason: string, opts?: { idempotencyKey?: string }): Promise<SpendResult>
```

Debits `amount` after applying accrued regen. Returns `{ ok: true, balance }`
with the new balance, or `{ ok: false, balance, code: "INSUFFICIENT" }` when the
balance is short or the subject has no balance row; a short spend still writes
the regen that accrued and writes no ledger row. A balance never goes negative.

With `opts.idempotencyKey`, a recorded key for the same `(subjectRef, currency)`
returns `{ ok: true, balance }` with the current balance and debits nothing. A
key already used by `earn` or `grant` throws `IDEMPOTENCY_KEY_REUSED`.

Throws `INVALID_AMOUNT`, `INVALID_ARGUMENT`, `IDEMPOTENCY_KEY_REUSED` or
`INVALID_REGEN`.

```ts
const result = await wallet.spend(ctx, subjectRef, "energy", 1, "round");
if (!result.ok) return result.code; // "INSUFFICIENT"
```

### `transfer`

```ts
transfer(ctx, fromRef: string, toRef: string, currency: string, amount: number, reason: string): Promise<SpendResult>
```

Moves `amount` from `fromRef` to `toRef` in one transaction and writes one
ledger row per side. `balance` in the result is the sender's balance. Returns
`{ ok: false, balance, code: "SELF_TRANSFER" }` when `fromRef === toRef`, and
`code: "INSUFFICIENT"` when the sender is short. The receiver's credit is
clamped to `max`, so the receiver can gain less than the sender lost; the
receiver's ledger `delta` is the actual increase. There is no idempotency key.

Throws `INVALID_AMOUNT`, `INVALID_ARGUMENT` (empty `fromRef`, `toRef`,
`currency` or `reason`), `INVALID_MAX`, `BALANCE_OVERFLOW` or `INVALID_REGEN`.

```ts
const result = await wallet.transfer(ctx, fromRef, toRef, "coins", 25, "gift");
```

### `balance`

```ts
balance(ctx, subjectRef: string, currency: string): Promise<number>
```

The balance projected forward to the server clock under the currency's `regen`.
`0` when the subject has no balance row. The projection is not written; the
stored balance catches up on the next mutation. Throws `INVALID_REGEN` when an
invalid regen rule applies to an existing balance row.

```ts
const energy = await wallet.balance(ctx, subjectRef, "energy");
```

### `balances`

```ts
balances(ctx, subjectRef: string): Promise<BalanceEntry[]>
```

Every currency the subject has a balance row for, each projected like `balance`.
Currencies never credited are not listed.

```ts
const all = await wallet.balances(ctx, subjectRef); // [{ currency: "coins", amount: 30 }]
```

### `history`

```ts
history(ctx, subjectRef: string, currency: string, limit?: number): Promise<LedgerEntry[]>
```

Newest-first ledger rows for one currency, at most `limit` (default
`defaultHistoryLimit`, `50`). Throws `INVALID_LIMIT` unless `limit` is an
integer from 1 through 1000. There is no cursor. Rows older than 90 days are
deleted by the internal sweep. Regen ticks are not ledgered.

```ts
const recent = await wallet.history(ctx, subjectRef, "coins", 20);
```

## Types

### `WalletComponent`

The type of `components.wallet`: the component's mutations (`earn`, `spend`,
`transfer`) and queries (`balance`, `balances`, `history`) as internal function
references. The generated `ComponentApi` is assignable to it.

### `WalletOptions`

```ts
interface WalletOptions {
  currencies?: Record<string, { regen?: RegenConfig; max?: number }>;
  defaultHistoryLimit?: number; // default 50, integer 1..1000
}
```

`max` caps credits: `earn`, `grant` and the receiving side of `transfer` never
raise the balance above `max`. It does not cap regen (keep `regen.cap` at or
below `max`) and never lowers a balance already above it. It must not be `NaN`
or negative (`INVALID_MAX`). There are no retention or key-expiry options.

### `RegenConfig`

```ts
interface RegenConfig {
  amount: number; // units per tick, finite and > 0
  intervalMs: number; // tick length, finite and > 0
  cap: number; // regen stops at this balance, finite and > 0
}
```

Every whole `intervalMs` since the balance last regenerated (or was created)
adds `amount`, up to `cap`. Regen never lowers a balance that is already above
`cap`, and partial intervals carry over. An invalid rule throws `INVALID_REGEN`
when regen applies to an existing balance row.

### `SpendResult`

```ts
interface SpendResult {
  ok: boolean;
  balance: number;
  code?: ErrorCode; // present only when ok is false
}
```

### `ErrorCode`

`"INSUFFICIENT" | "SELF_TRANSFER"`: the failure tag on `SpendResult.code`. These
are returned, never thrown.

### `BalanceEntry`

`{ currency: string; amount: number }`, one element of `balances`.

### `LedgerEntry`

```ts
interface LedgerEntry {
  currency: string;
  delta: number; // positive on earn / receive, negative on spend / send
  reason: string;
  idempotencyKey?: string; // cleared by the first hourly sweep at least 7 days after the row was written
  createdAt: number; // epoch ms
}
```

## React (`@vllnt/convex-wallet/react`)

Thin wrappers over `useQuery` from `convex/react`. Pass your own public query
references; the component never imports your `api`. The queries must accept
exactly the arguments below and must authorize `subjectRef`.

### `useBalance`

```ts
useBalance(balanceRef: FunctionReference<"query", "public", { subjectRef: string; currency: string }, number>, args: { subjectRef: string; currency: string }): number | undefined
```

`undefined` while the query loads.

```tsx
const coins = useBalance(api.balances.balance, {
  subjectRef,
  currency: "coins",
});
```

### `useBalances`

```ts
useBalances(balancesRef: FunctionReference<"query", "public", { subjectRef: string }, BalanceEntry[]>, args: { subjectRef: string }): BalanceEntry[] | undefined
```

`undefined` while the query loads.

```tsx
// api.balances.all: your public query with args { subjectRef } that returns wallet.balances(ctx, subjectRef)
const all = useBalances(api.balances.all, { subjectRef });
```

## Component config

### `convex.config`

`import wallet from "@vllnt/convex-wallet/convex.config"` is the component
definition (named `wallet`). Mount it with `app.use(wallet)`, or
`app.use(wallet, { name })` for several isolated mounts.

```ts
import wallet from "@vllnt/convex-wallet/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(wallet);
export default app;
```

## Testing (`@vllnt/convex-wallet/test`)

### `register`

```ts
register<TSchema extends GenericSchema>(t: TestConvex<SchemaDefinition<TSchema, boolean>>, name = "wallet"): void
```

Mounts the component in a `convex-test` instance built from any host schema,
under `name` (default `"wallet"`, the name `app.use(wallet)` uses). It is
TypeScript source that uses Vite's `import.meta.glob`, so run it under Vitest.

```ts
const t = convexTest(schema, import.meta.glob("./**/*.ts"));
register(t);
```

## Generated types

### `ComponentApi`

`import type { ComponentApi } from "@vllnt/convex-wallet/_generated/component"`
is the generated type of the mounted component (`components.wallet`). Use it to
type a parameter that receives the component.

## Errors

| Code                     | Returned or thrown                        | When                                                                                           |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `INSUFFICIENT`           | returned in `SpendResult.code`            | `spend` / `transfer` sender balance (after regen) below `amount`, or no balance row            |
| `SELF_TRANSFER`          | returned in `SpendResult.code`            | `transfer` with `fromRef === toRef`                                                            |
| `INVALID_AMOUNT`         | thrown `Error`, message contains the code | `amount` is not a finite number in `(0, 2^53 - 1]`                                             |
| `INVALID_REGEN`          | thrown `Error`, message contains the code | a regen `amount`, `intervalMs` or `cap` is not finite or not above 0, when regen applies       |
| `INVALID_ARGUMENT`       | thrown `ConvexError`, `data.code`         | an identifier, `reason` or `idempotencyKey` is `""` on `earn` / `grant` / `spend` / `transfer` |
| `INVALID_MAX`            | thrown `ConvexError`, `data.code`         | a currency `max` is `NaN` or negative                                                          |
| `INVALID_LIMIT`          | thrown `ConvexError`, `data.code`         | `history` limit is not an integer from 1 through 1000                                          |
| `BALANCE_OVERFLOW`       | thrown `ConvexError`, `data.code`         | a credit would push a balance or lifetime earned past 2^53 - 1                                 |
| `IDEMPOTENCY_KEY_REUSED` | thrown `ConvexError`, `data.code`         | a key recorded by a credit is reused on a debit, or the reverse                                |

## Maintenance

The component schedules its own hourly internal sweep (`pruneLedger`); the host
cannot call it or configure it.

- It deletes ledger rows older than 90 days.
- It clears the `idempotencyKey` of rows older than 7 days. A key is never
  cleared before 7 days, and it is cleared by the first sweep after that,
  however large the backlog.
- Each run is bounded; a run that fills its batch schedules an immediate
  continuation, so a backlog drains in one sweep.

Replay protection ends when a key is cleared or its row is deleted. `earn` /
`grant` and `spend` share one key namespace per subject and currency.
