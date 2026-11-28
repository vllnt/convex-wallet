/// <reference types="vite/client" />
import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register this component with a `convex-test` instance so consuming apps can
 * test integration: `import { register } from "@vllnt/convex-wallet/test"`.
 *
 * @param t - The host app's `convexTest(hostSchema, modules)` instance, for any
 *   host schema (with or without tables of its own).
 * @param name - The name the host mounts the component under
 *   (`app.use(wallet, { name })`). Defaults to `"wallet"`.
 * @example
 * const t = convexTest(schema, modules);
 * register(t);
 */
export function register<TSchema extends GenericSchema>(
  t: TestConvex<SchemaDefinition<TSchema, boolean>>,
  name = "wallet",
): void {
  t.registerComponent(name, schema, modules);
}
