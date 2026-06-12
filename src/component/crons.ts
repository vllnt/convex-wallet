import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_LEDGER_RETENTION_MS,
} from "../shared";

/**
 * The wallet's own scheduled maintenance. Scheduling lives INSIDE the component
 * (never the host) and the swept mutation is idempotent (at-least-once safe).
 *
 * Runs the retention + idempotency-window sweep hourly with the default
 * windows; a host needing tighter/looser retention can additionally call
 * `pruneLedger` with its own values. The sweep is bounded per run, so a backlog
 * drains over successive ticks rather than in one unbounded transaction.
 */
const crons = cronJobs();

crons.interval(
  "prune wallet ledger",
  { hours: 1 },
  internal.internal_mutations.pruneLedger,
  {
    retentionMs: DEFAULT_LEDGER_RETENTION_MS,
    idempotencyTtlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
  },
);

export default crons;
