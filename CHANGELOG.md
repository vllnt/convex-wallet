# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - Unreleased

### Fixed

- `earn` and the receiver leg of `transfer` could lower a balance: when a
  currency's `max` was below the stored balance (for example after the host
  lowered it), the credit clamped down to `max`, debiting the subject and
  writing a negative `delta`. A credit now never lowers a balance; it is a no-op
  ledger row with `delta` 0.
- An `idempotencyKey` recorded by a credit and reused on a debit (or the
  reverse) for the same subject and currency was treated as a replay, silently
  skipping the second operation. It now throws `IDEMPOTENCY_KEY_REUSED`.
- Credits that would push a balance or `lifetimeEarned` past 2^53 - 1 (where
  numbers lose precision) throw `BALANCE_OVERFLOW`; amounts above 2^53 - 1 throw
  `INVALID_AMOUNT`.
- A `NaN` or negative `max` (which could store a `NaN` balance) throws
  `INVALID_MAX`. Empty `subjectRef`, `fromRef`, `toRef`, `currency`, `reason` or
  `idempotencyKey` throw `INVALID_ARGUMENT`.
- The `/test` entry type-checks for consumers using `moduleResolution`
  `nodenext` (explicit `.js` relative imports, `vite/client` types).

### Changed

- Test files are no longer included in the published package.
- Tooling: pnpm 10 with a release-age gate, tag-only stable releases with npm
  provenance, pinned CI actions, patched transitive dependencies.

## [0.1.0] - 2026-09-01

### Changed

- Treat Convex `_generated` output as CLI-owned, exclude it from formatting, and
  expose a dedicated codegen script.
- Refresh all direct dependencies to their latest compatible releases for canary
  validation.
- Require `convex@^1.45.0` and update `convex-test` to `^0.0.56`.
- Bound ledger history reads to integer limits from 1 through 1000.

### Breaking (relative to the 0.1.0 canaries)

- `history` now throws `INVALID_LIMIT` for limits outside 1 through 1000 or for
  non-finite/non-integer values. Clamp explicit limits and `defaultHistoryLimit`
  to this range before upgrading.

### Fixed

- Skip redundant balance patches when a failed spend or transfer did not advance
  regeneration.

- **Ledger delta correctness** — `earn` and the receiver leg of `transfer` now
  record the actual balance change in `delta`, not the requested amount. When a
  credit is clamped by `max`, `delta` equals the real increase only.
- **Regen config validation** — `applyRegen` now throws `INVALID_REGEN` when
  `intervalMs`, `amount`, or `cap` is non-finite or non-positive, preventing
  `0 * Infinity = NaN` from corrupting `lastRegenAt`.
- **Regen below-stored guard** — `applyRegen` now ensures the projected balance
  is never reduced below `stored` (fixes the case where `stored > regen.cap`
  previously silently destroyed funds).

### Added

- **Idempotent spend** — `spend` now accepts an optional `idempotencyKey`. A
  replay of an already-recorded key returns the current balance without a second
  debit or ledger row, preventing double-charges on host retries.

- First release of `@vllnt/convex-wallet`.
- Per-currency `max` ceiling — credits clamp to it on `earn`, `grant`, and the
  receiver leg of `transfer`.
- Internal hourly `pruneLedger` cron (idempotent / at-least-once) that deletes
  ledger rows past the retention window and expires idempotency keys past the
  idempotency window; configurable windows on direct call.

### Security / Fixed

- **Amount guards (abuse)** — `earn` / `grant` / `spend` / `transfer` now reject
  non-finite or non-positive amounts with `INVALID_AMOUNT`. Closes a mint
  exploit where a negative `spend` credited funds, and balance corruption from
  `NaN` / `Infinity`.
- **Server-sourced time** — the host no longer supplies `now`; every mutation
  and query reads `Date.now()` server-side, so a forged/stale clock cannot drive
  extra regen. Removed the `*At` example wrappers.
- **Monotonic regen** — `applyRegen` never advances the regen pointer past `now`
  and treats a backwards/equal clock as a no-op (no over-regen, no rewind).
- **Per-`(subject, currency)` idempotency** — the `by_idem` index is re-keyed to
  `(subjectRef, currency, idempotencyKey)` so a key reused across subjects or
  currencies is independent and no longer silently drops a legitimate grant.
- **Self-transfer guard** — `transfer` with `fromRef === toRef` returns
  `SELF_TRANSFER` instead of debiting-then-crediting one row.
- **Regen-aware `balances()`** — the multi-currency overview now applies each
  currency's regen (via a client-passed map), matching `balance()` (no stale
  divergence).

### Changed

- Failure results carry a typed `code` (`INSUFFICIENT` | `SELF_TRANSFER`)
  instead of a free-text `reason`; `reason` remains the human ledger note.
