/// <reference types="vite/client" />
import { componentsGeneric, defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { Wallet } from "./client/index.js";
import type { ComponentApi } from "./component/_generated/component.js";
import { register } from "./test.js";

/**
 * A host app's schema: its own tables, none of the component's. `register` must
 * accept the `convexTest` instance built from it; `pnpm typecheck:ci` fails with
 * TS2345 if it does not.
 */
const hostSchema = defineSchema({
  notes: defineTable({ body: v.string() }),
});

const hostModules = import.meta.glob("./component/**/*.ts");

/**
 * Host codegen types `components` exactly this way: the runtime value is
 * `componentsGeneric()`, declared with one `ComponentApi` per mount.
 */
const components = componentsGeneric() as unknown as {
  wallet: ComponentApi<"wallet">;
  otherWallet: ComponentApi<"otherWallet">;
};

test("register accepts a host app's convexTest instance and keeps its data model", async () => {
  const t = convexTest(hostSchema, hostModules);
  register(t);
  register(t, "otherWallet");

  const id = await t.run((ctx) => ctx.db.insert("notes", { body: "hello" }));
  const note = await t.run((ctx) => ctx.db.get("notes", id));
  expect(note?.body).toBe("hello");

  const wallet = new Wallet(components.wallet);
  const other = new Wallet(components.otherWallet);
  const earned = await t.run((ctx) =>
    wallet.earn(ctx, "player", "coins", 5, "quest"),
  );
  expect(earned).toEqual({ balance: 5 });
  expect(await t.run((ctx) => wallet.balance(ctx, "player", "coins"))).toBe(5);
  expect(await t.run((ctx) => other.balance(ctx, "player", "coins"))).toBe(0);
});
