import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";
import {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_LEDGER_RETENTION_MS,
} from "../shared.js";

/**
 * The wallet's own scheduled maintenance. Scheduling lives INSIDE the component
 * (never the host) and the swept mutation is idempotent (at-least-once safe).
 *
 * Runs the retention + idempotency-window sweep hourly with the fixed default
 * windows. `pruneLedger` is internal and not host-callable. Each run is
 * bounded; a run that fills its batch schedules an immediate continuation, so
 * a backlog drains in one sweep without one unbounded transaction.
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
