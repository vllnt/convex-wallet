// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import * as cr from "convex/react";
import type { FunctionReference } from "convex/server";
import type { BalanceEntry } from "../client/types.js";
import { useBalance, useBalances } from "./index.js";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  usePaginatedQuery: vi.fn(),
}));

const mockedUseQuery = cr.useQuery as unknown as ReturnType<typeof vi.fn>;

const balanceRef = {} as FunctionReference<
  "query",
  "public",
  { subjectRef: string; currency: string },
  number
>;

const balancesRef = {} as FunctionReference<
  "query",
  "public",
  { subjectRef: string },
  BalanceEntry[]
>;

test("useBalance passes ref + args and returns the loaded value", () => {
  mockedUseQuery.mockReturnValue(42);
  const args = { subjectRef: "s", currency: "coins" };
  const { result } = renderHook(() => useBalance(balanceRef, args));
  expect(mockedUseQuery).toHaveBeenCalledWith(balanceRef, args);
  expect(result.current).toBe(42);
});

test("useBalance returns undefined while loading", () => {
  mockedUseQuery.mockReturnValue(undefined);
  const { result } = renderHook(() =>
    useBalance(balanceRef, { subjectRef: "s", currency: "coins" }),
  );
  expect(result.current).toBeUndefined();
});

test("useBalances passes ref + args and returns the loaded value", () => {
  const balances: BalanceEntry[] = [{ currency: "coins", amount: 7 }];
  mockedUseQuery.mockReturnValue(balances);
  const args = { subjectRef: "s" };
  const { result } = renderHook(() => useBalances(balancesRef, args));
  expect(mockedUseQuery).toHaveBeenCalledWith(balancesRef, args);
  expect(result.current).toBe(balances);
});

test("useBalances returns undefined while loading", () => {
  mockedUseQuery.mockReturnValue(undefined);
  const { result } = renderHook(() =>
    useBalances(balancesRef, { subjectRef: "s" }),
  );
  expect(result.current).toBeUndefined();
});
