# API Reference — @vllnt/convex-wallet

Construct the client with the mounted component and optional per-currency config:

```ts
import { Wallet } from "@vllnt/convex-wallet";
const wallet = new Wallet(components.wallet, {
  currencies: {
    // energy regenerates 1 unit every 10s, capped at 100
    energy: { regen: { amount: 1, intervalMs: 10_000, cap: 100 } },
    // gems are static but capped at a hard ceiling of 9999
    gems: { max: 9999 },
    // coins omits both → static, uncapped
  },
  defaultHistoryLimit: 50, // page size for history() when omitted
});
```

All methods take the host `ctx` (a query or mutation context) as the first
argument. `subjectRef` and `currency` are opaque host strings — the component
never inspects them. The client injects each currency's `regen` rule and `max`
ceiling automatically; **time is server-sourced** — every handler reads
`Date.now()` itself, so the host never passes (and can never forge) the clock.

Every value-moving call (`earn` / `grant` / `spend` / `transfer`) **throws
`INVALID_AMOUNT`** when `amount` is not a finite number strictly greater than 0
(rejects `0`, negatives, `NaN`, `Infinity`). A negative `spend` can never mint
funds.

## Mutations

### `earn(ctx, subjectRef, currency, amount, reason, opts?) → { balance }`

Credit `amount` of `currency` to `subjectRef`; returns the new balance, clamped
to the currency's `max` if one is configured. `opts.idempotencyKey` makes it
replay-safe — a second call with the same key **for the same
`(subjectRef, currency)`** is a no-op that returns the current balance without
double-crediting. The same key used for a different subject or currency is
independent. Creates the balance row if the subject did not hold the currency.

### `grant(ctx, subjectRef, currency, amount, reason, idempotencyKey) → { balance }`

`earn` with a **required** `idempotencyKey` — credit exactly once per key (scoped
per subject + currency). Use after the host has verified an IAP / Stripe
purchase, keyed on the receipt id.

### `spend(ctx, subjectRef, currency, amount, reason) → { ok, balance, code? }`

Debit `amount` of `currency`. Never goes negative — when the (regen-aware)
balance is short, returns `{ ok: false, balance, code: "INSUFFICIENT" }` while
still persisting any regen that accrued. On success returns `{ ok: true, balance }`
with the new balance. `code` is a stable, machine-readable tag; `reason` is the
free-text ledger note.

### `transfer(ctx, fromRef, toRef, currency, amount, reason) → { ok, balance, code? }`

Move `amount` of `currency` from `fromRef` to `toRef` in one transaction. Debits
the sender (same insufficiency guard as `spend`); on success credits the receiver
(creating their balance if needed, clamped to `max`) and ledgers both legs.
`balance` is the sender's new balance. `fromRef === toRef` is rejected with
`{ ok: false, balance, code: "SELF_TRANSFER" }` and never debits-then-credits a
single row.

## Queries

### `balance(ctx, subjectRef, currency) → number`

The current balance of `currency` for `subjectRef`, **regen-aware** (projected
forward to the server clock under the per-currency `regen`). Missing → `0`.
Queries cannot write, so the projected regen is reflected in the result but not
persisted until the next mutation. A backwards/stale clock never grants extra.

### `balances(ctx, subjectRef) → { currency, amount }[]`

Every currency balance held by `subjectRef`, **regen-aware** — the client passes
its per-currency `regen` map so each row is projected exactly as `balance()`
would, with no stale divergence. A currency without a configured `regen` is
static.

### `history(ctx, subjectRef, currency, limit?) → LedgerEntry[]`

Newest-first ledger entries for one currency, capped at `limit` (default
`defaultHistoryLimit`). Each entry is
`{ currency, delta, reason, idempotencyKey?, createdAt }`, where `delta` is
positive on earn / receive and negative on spend / send.

## Maintenance

The component schedules its own **hourly** internal sweep (`pruneLedger`,
idempotent / at-least-once safe) inside the component — never the host:

- deletes `ledger` rows older than the retention window
  (`DEFAULT_LEDGER_RETENTION_MS`, 90 days), bounded per run;
- clears the `idempotencyKey` of rows older than the idempotency window
  (`DEFAULT_IDEMPOTENCY_TTL_MS`, 7 days) so a key may be reused afterward.

A host needing different windows can call `pruneLedger` directly with its own
`{ retentionMs, idempotencyTtlMs }`.
