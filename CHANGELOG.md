# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial scaffold.

## [0.1.0] - 2026-06-12

### Added

- First release of `@vllnt/convex-wallet`.
- Per-currency `max` ceiling — credits clamp to it on `earn`, `grant`, and the
  receiver leg of `transfer`.
- Internal hourly `pruneLedger` cron (idempotent / at-least-once) that deletes
  ledger rows past the retention window and expires idempotency keys past the
  idempotency window; configurable windows on direct call.

### Security / Fixed

- **Amount guards (abuse)** — `earn` / `grant` / `spend` / `transfer` now reject
  non-finite or non-positive amounts with `INVALID_AMOUNT`. Closes a mint exploit
  where a negative `spend` credited funds, and balance corruption from `NaN` /
  `Infinity`.
- **Server-sourced time** — the host no longer supplies `now`; every mutation and
  query reads `Date.now()` server-side, so a forged/stale clock cannot drive
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

- Failure results carry a typed `code` (`INSUFFICIENT` | `SELF_TRANSFER`) instead
  of a free-text `reason`; `reason` remains the human ledger note.
