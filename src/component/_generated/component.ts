/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    mutations: {
      earn: FunctionReference<
        "mutation",
        "internal",
        {
          amount: number;
          currency: string;
          idempotencyKey?: string;
          max?: number;
          reason: string;
          regen?: { amount: number; cap: number; intervalMs: number };
          subjectRef: string;
        },
        { balance: number },
        Name
      >;
      spend: FunctionReference<
        "mutation",
        "internal",
        {
          amount: number;
          currency: string;
          reason: string;
          regen?: { amount: number; cap: number; intervalMs: number };
          subjectRef: string;
        },
        {
          balance: number;
          code?: "INSUFFICIENT" | "SELF_TRANSFER";
          ok: boolean;
        },
        Name
      >;
      transfer: FunctionReference<
        "mutation",
        "internal",
        {
          amount: number;
          currency: string;
          fromRef: string;
          max?: number;
          reason: string;
          regen?: { amount: number; cap: number; intervalMs: number };
          toRef: string;
        },
        {
          balance: number;
          code?: "INSUFFICIENT" | "SELF_TRANSFER";
          ok: boolean;
        },
        Name
      >;
    };
    queries: {
      balance: FunctionReference<
        "query",
        "internal",
        {
          currency: string;
          regen?: { amount: number; cap: number; intervalMs: number };
          subjectRef: string;
        },
        number,
        Name
      >;
      balances: FunctionReference<
        "query",
        "internal",
        {
          regen?: Record<
            string,
            { amount: number; cap: number; intervalMs: number }
          >;
          subjectRef: string;
        },
        Array<{ amount: number; currency: string }>,
        Name
      >;
      history: FunctionReference<
        "query",
        "internal",
        { currency: string; limit: number; subjectRef: string },
        Array<{
          createdAt: number;
          currency: string;
          delta: number;
          idempotencyKey?: string;
          reason: string;
        }>,
        Name
      >;
    };
  };
