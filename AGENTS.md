<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-wallet

TypeScript Convex component for virtual currency wallets: coin, credit and energy balances with
atomic spend, transfers, regen over time and a ledger.
Follows the vllnt Component Standard (see the `oss-packages` hub
`AGENTS.md`).

## Agent instructions

`AGENTS.md` is the sole agent-instruction source for this repository. Do not add
`CLAUDE.md` or `.claude` content.

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
| Public API (client methods, args, returns, error codes) | `README.md` API + Errors and fixes, `docs/API.md`, `llms.txt`, TSDoc |
| Config points / options | `README.md` API + Limits and gotchas, `docs/API.md` |
| Schema / tables / indexes | `llms.txt` summary |
| `convex` peer version | `llms.txt` summary, `README.md` Compatibility, `docs/API.md` Compatibility, `scripts/test-package.mjs` |
| New file / capability | `README.md`, `llms.txt`, `docs/API.md` |
| Version | `CHANGELOG.md` entry |

Run `pnpm generate:llms` after editing `llms.txt` to validate the index.
README, `llms.txt` and `docs/` follow the shared docs contract in
`scripts/check-documentation.mjs`, run by `pnpm test:package` after
`pnpm build`. Every README `ts`/`tsx` example type-checks against the packed
package; the Testing example also runs under Vitest.
Grep the old value before committing — zero stale hits required.

## Generated code

- Every `**/_generated/**` file is owned exclusively by Convex CLI codegen.
- Never create, edit, lint, or format generated files manually.
- Run `pnpm codegen` to regenerate them and commit the generated output unchanged.
