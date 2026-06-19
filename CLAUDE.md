<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-wallet

Consumable balances and economy ledger with atomic spend and lazy regen, as a Convex component.
Follows the vllnt Component Standard (see the `convex-components` hub
`.claude/rules/component-standard.md`).

## Architecture

```
src/
├── shared.ts              # shared types, validators, pure utils
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # Wallet client class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
├── react/
│   └── index.tsx          # optional ./react hooks (useBalance, useBalances)
└── component/
    ├── mutations.ts        # all mutations
    ├── queries.ts          # all queries
    ├── validators.ts       # shared validators
    ├── schema.ts           # sandboxed tables (balances + ledger)
    └── convex.config.ts    # defineComponent("wallet")
```

## Ownership boundary

| Concern | Owner |
|---------|-------|
| Sandboxed tables (`balances`, `ledger`) | **Component** |
| Atomic spend / earn / transfer logic | **Component** |
| Ledger pruning cron + idempotency-key expiry | **Component** |
| Identity resolution (`subjectRef` meaning) | **Host** |
| Auth / authorization (who may spend) | **Host** |
| Payment confirmation (IAP / Stripe receipt) | **Host** — host calls `grant` AFTER verifying |
| Currency semantics (what "coins" means) | **Host** |
| `subjectRef` and `currency` shape | **Host** — opaque strings to the component |

## Key design decisions

- **Consumable balances + ledger.** Two tables: `balances` (one row per `(subjectRef, currency)`)
  and `ledger` (one signed-`delta` row per change). `balance = sum(ledger.delta)` is always
  derivable; the stored balance is the running total, not recomputed each read.
- **Atomic spend, never negative.** `spend` and `transfer` debit inside a single Convex mutation
  transaction. An insufficient balance returns `{ ok: false, code: "INSUFFICIENT" }` — no partial
  debit, no negative balance.
- **Server-sourced time for regen.** Every handler reads `Date.now()` itself; the host never
  passes `now`. A forged or replayed clock cannot drive extra regen.
- **`applyRegen` is a pure helper.** It floors at the stored balance (never reduces funds), rejects
  non-positive `intervalMs`/`amount`/`cap` (`INVALID_REGEN`), and advances `lastRegenAt` by
  exactly the ticks consumed — the pointer never exceeds `now`.
- **Ledger `delta` = actual credited amount.** When a credit is clamped by `max`, `delta` records
  the real increase only. `balance = sum(ledger.delta)` always holds.
- **Idempotent spend via `idempotencyKey`.** A replay of a recorded `(subjectRef, currency,
  idempotencyKey)` returns the current balance without a second debit or ledger row — safe for
  host retries.
- **`assertPositiveAmount` at every boundary.** Throws `INVALID_AMOUNT` for non-finite or
  non-positive values; a negative `spend` can never mint funds.

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host-supplied validator keyed by an opaque ref — never `v.any()` dumps.
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.

## Docs sync

| Changed | Update in same commit |
|---------|-----------------------|
| Public API (client methods, args, returns, error codes) | `README.md` API Reference, `docs/API.md`, `llms.txt` |
| Config points / options | `README.md` Usage + API Reference, `docs/API.md` |
| Schema / tables / indexes | `README.md` Architecture |
| `convex` peer version | `llms.txt` context line, `README.md` Installation, `docs/API.md` Compatibility |
| New file / capability | `README.md`, `llms.txt` |
| Version | `CHANGELOG.md` entry |

Grep the old value before committing — zero stale hits required.
