import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type {
  BalanceEntry,
  CurrencyConfig,
  ErrorCode,
  LedgerEntry,
  RegenConfig,
  SpendResult,
  WalletOptions,
} from "./types.js";
import { DEFAULT_HISTORY_LIMIT } from "../shared.js";

/**
 * The wallet component's function references, as exposed on the host via
 * `components.wallet`.
 */
export interface WalletComponent {
  mutations: {
    earn: FunctionReference<
      "mutation",
      "internal",
      {
        subjectRef: string;
        currency: string;
        amount: number;
        reason: string;
        idempotencyKey?: string;
        regen?: RegenConfig;
        max?: number;
      },
      { balance: number }
    >;
    spend: FunctionReference<
      "mutation",
      "internal",
      {
        subjectRef: string;
        currency: string;
        amount: number;
        reason: string;
        regen?: RegenConfig;
      },
      SpendResult
    >;
    transfer: FunctionReference<
      "mutation",
      "internal",
      {
        fromRef: string;
        toRef: string;
        currency: string;
        amount: number;
        reason: string;
        regen?: RegenConfig;
        max?: number;
      },
      SpendResult
    >;
  };
  queries: {
    balance: FunctionReference<
      "query",
      "internal",
      { subjectRef: string; currency: string; regen?: RegenConfig },
      number
    >;
    balances: FunctionReference<
      "query",
      "internal",
      { subjectRef: string; regen?: Record<string, RegenConfig> },
      BalanceEntry[]
    >;
    history: FunctionReference<
      "query",
      "internal",
      { subjectRef: string; currency: string; limit: number },
      LedgerEntry[]
    >;
  };
}

interface RunQueryCtx {
  runQuery<Q extends FunctionReference<"query", "internal">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
}

interface RunMutationCtx {
  runMutation<M extends FunctionReference<"mutation", "internal">>(
    reference: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

/**
 * Consumer-facing client for the consumable-balances wallet. The host owns auth,
 * payment confirmation, and meaning: it resolves identity, verifies any IAP /
 * Stripe purchase, then passes an opaque `subjectRef` and a `currency` string
 * in. The client injects each currency's `regen` rule and `max` ceiling per
 * call; the component reads the server clock (`Date.now()`) itself.
 */
export class Wallet {
  private readonly currencies: Record<string, CurrencyConfig>;
  private readonly defaultHistoryLimit: number;

  constructor(
    private readonly component: WalletComponent,
    options: WalletOptions = {},
  ) {
    this.currencies = options.currencies ?? {};
    this.defaultHistoryLimit = options.defaultHistoryLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  private regenFor(currency: string): RegenConfig | undefined {
    return this.currencies[currency]?.regen;
  }

  private maxFor(currency: string): number | undefined {
    return this.currencies[currency]?.max;
  }

  /** The per-currency regen map for the multi-currency {@link balances} read. */
  private regenMap(): Record<string, RegenConfig> | undefined {
    const out: Record<string, RegenConfig> = {};
    for (const [currency, config] of Object.entries(this.currencies)) {
      if (config.regen !== undefined) {
        out[currency] = config.regen;
      }
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }

  /** Credit `amount` of `currency` to `subjectRef`. Returns the new balance. */
  earn(
    ctx: RunMutationCtx,
    subjectRef: string,
    currency: string,
    amount: number,
    reason: string,
    opts: { idempotencyKey?: string } = {},
  ): Promise<{ balance: number }> {
    return ctx.runMutation(this.component.mutations.earn, {
      subjectRef,
      currency,
      amount,
      reason,
      idempotencyKey: opts.idempotencyKey,
      regen: this.regenFor(currency),
      max: this.maxFor(currency),
    });
  }

  /**
   * Idempotent grant — credit only once per `idempotencyKey`. Use after the
   * host has verified an IAP / Stripe purchase. Returns the new balance.
   */
  grant(
    ctx: RunMutationCtx,
    subjectRef: string,
    currency: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<{ balance: number }> {
    return this.earn(ctx, subjectRef, currency, amount, reason, { idempotencyKey });
  }

  /** Debit `amount` of `currency` from `subjectRef`. Never goes negative. */
  spend(
    ctx: RunMutationCtx,
    subjectRef: string,
    currency: string,
    amount: number,
    reason: string,
  ): Promise<SpendResult> {
    return ctx.runMutation(this.component.mutations.spend, {
      subjectRef,
      currency,
      amount,
      reason,
      regen: this.regenFor(currency),
    });
  }

  /** Move `amount` of `currency` from `fromRef` to `toRef` in one transaction. */
  transfer(
    ctx: RunMutationCtx,
    fromRef: string,
    toRef: string,
    currency: string,
    amount: number,
    reason: string,
  ): Promise<SpendResult> {
    return ctx.runMutation(this.component.mutations.transfer, {
      fromRef,
      toRef,
      currency,
      amount,
      reason,
      regen: this.regenFor(currency),
      max: this.maxFor(currency),
    });
  }

  /** Regen-aware single-currency balance for `subjectRef`. Missing → 0. */
  balance(ctx: RunQueryCtx, subjectRef: string, currency: string): Promise<number> {
    return ctx.runQuery(this.component.queries.balance, {
      subjectRef,
      currency,
      regen: this.regenFor(currency),
    });
  }

  /** All currency balances held by `subjectRef`, regen-aware (matches {@link balance}). */
  balances(ctx: RunQueryCtx, subjectRef: string): Promise<BalanceEntry[]> {
    return ctx.runQuery(this.component.queries.balances, {
      subjectRef,
      regen: this.regenMap(),
    });
  }

  /** Newest-first ledger history for one currency. */
  history(
    ctx: RunQueryCtx,
    subjectRef: string,
    currency: string,
    limit?: number,
  ): Promise<LedgerEntry[]> {
    return ctx.runQuery(this.component.queries.history, {
      subjectRef,
      currency,
      limit: limit ?? this.defaultHistoryLimit,
    });
  }
}

export type {
  BalanceEntry,
  ErrorCode,
  LedgerEntry,
  RegenConfig,
  SpendResult,
  WalletOptions,
};
