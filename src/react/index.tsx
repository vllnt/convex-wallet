/**
 * Optional, tree-shakeable React front-tooling for `@vllnt/convex-wallet`.
 *
 * Thin reactive hooks over `useQuery` from `convex/react`. Each hook takes the
 * HOST's re-exported wallet function reference plus its args — the component
 * never imports the host `api`. `react` and `convex/react` are optional peer
 * deps: a backend-only consumer pulls none of this code.
 */

import type { FunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import type { BalanceEntry } from "../client/types.js";

/**
 * Reactive single-currency balance for `subjectRef`.
 *
 * @param balanceRef - The host's re-exported `wallet.balance` query reference.
 * @param args - `{ subjectRef, currency }` opaque identity + currency string.
 * @returns The current balance, or `undefined` while the query loads.
 */
export function useBalance(
  balanceRef: FunctionReference<
    "query",
    "public",
    { subjectRef: string; currency: string },
    number
  >,
  args: { subjectRef: string; currency: string },
): number | undefined {
  return useQuery(balanceRef, args);
}

/**
 * Reactive multi-currency overview for `subjectRef`.
 *
 * @param balancesRef - The host's re-exported `wallet.balances` query reference.
 * @param args - `{ subjectRef }` opaque identity.
 * @returns The balances array, or `undefined` while the query loads.
 */
export function useBalances(
  balancesRef: FunctionReference<
    "query",
    "public",
    { subjectRef: string },
    BalanceEntry[]
  >,
  args: { subjectRef: string },
): BalanceEntry[] | undefined {
  return useQuery(balancesRef, args);
}
