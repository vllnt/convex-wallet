<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Project Overview

`@vllnt/convex-wallet` is a Convex component: Consumable balances and economy ledger with atomic spend and lazy regen, as a Convex component It follows the vllnt Component
Standard (see the `convex-components` hub `.claude/rules/component-standard.md`).

## Architecture

```
src/
├── shared.ts              # shared types, validators, pure utils
├── log.ts                 # optional structured logger
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # Wallet client class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
└── component/
    ├── mutations.ts        # all mutations
    ├── queries.ts          # all queries
    ├── validators.ts       # shared validators
    ├── schema.ts           # sandboxed tables
    └── convex.config.ts    # defineComponent("wallet")
```

## Key Design Decisions

- <!-- record the load-bearing decisions: auth boundary, what host owns vs component owns, etc. -->

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host-supplied validator keyed by an opaque ref — never `v.any()` dumps.
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.
