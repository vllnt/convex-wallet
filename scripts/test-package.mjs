// Packs the built package, installs it in a fresh consumer project, runs the
// docs contract (check-documentation.mjs) on what consumers receive, and
// type-checks and runs the README examples against it. Run `pnpm build` first.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  checkDocumentation,
  convexHost,
  writeHost,
} from "./check-documentation.mjs";

const root = process.cwd();
/** @type {unknown} */
const metadata = JSON.parse(readFileSync("package.json", "utf8"));
if (
  typeof metadata !== "object" ||
  metadata === null ||
  !("name" in metadata) ||
  !("version" in metadata) ||
  typeof metadata.name !== "string" ||
  typeof metadata.version !== "string"
)
  throw new Error("invalid package metadata");
const tarball = `${metadata.name.replace("@", "").replace("/", "-")}-${metadata.version}.tgz`;
const temporary = mkdtempSync(join(tmpdir(), "wallet-consumer-"));
/** @param {string} command @param {string[]} arguments_ @param {string} [cwd] */
const run = (command, arguments_, cwd = temporary) =>
  execFileSync(command, arguments_, { cwd, stdio: "inherit" });
const strict = ["exec", "tsc", "--noEmit", "--strict", "--target", "ES2022"];
const bundler = [
  ...strict,
  "--module",
  "ESNext",
  "--moduleResolution",
  "Bundler",
  "--jsx",
  "react-jsx",
  "--types",
  "vite/client,node",
];
try {
  run("pnpm", ["pack", "--pack-destination", temporary], root);
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({
      pnpm: { ignoredBuiltDependencies: ["esbuild"] },
      private: true,
      type: "module",
    }),
  );
  // pnpm 11 reads the build-script policy from the workspace file, pnpm 10 from package.json.
  writeFileSync(
    join(temporary, "pnpm-workspace.yaml"),
    "allowBuilds:\n  esbuild: false\n",
  );
  run("pnpm", [
    "add",
    join(temporary, tarball),
    "convex@1.51.0",
    "convex-test@0.0.73",
    "typescript@5.9.3",
    "react@19.3.1",
    "@types/react@19.3.0",
    "vite@8.3.8",
    "vitest@5.1.1",
    "@edge-runtime/vm@5.0.0",
    "@types/node@22.20.2",
  ]);
  // Agents read the bundled docs from node_modules, so they must ship and resolve.
  const installed = join(temporary, "node_modules", metadata.name);
  const missing = [
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "llms.txt",
    ...readdirSync(join(root, "docs")).map((file) => `docs/${file}`),
  ].filter((file) => !existsSync(join(installed, file)));
  if (missing.length > 0)
    throw new Error(`tarball is missing ${missing.join(", ")}`);
  // Docs contract, then README examples compile against the built package in a stub host.
  const examples = checkDocumentation(installed, temporary);
  const hostFiles = writeHost(
    temporary,
    convexHost(installed, examples),
    examples,
  );
  run("pnpm", [...bundler, ...hostFiles]);
  // The README's own vitest.config.mts runs its test example.
  run("pnpm", ["exec", "vitest", "run"]);
  writeFileSync(
    join(temporary, "consumer.ts"),
    `
import { Wallet } from "@vllnt/convex-wallet";
import type { ComponentApi } from "@vllnt/convex-wallet/_generated/component.js";
import config from "@vllnt/convex-wallet/convex.config.js";
import { useBalance, useBalances } from "@vllnt/convex-wallet/react";
import { defineApp } from "convex/server";
declare const component: ComponentApi;
const client = new Wallet(component);
const app = defineApp(); app.use(config);
void client; void app; void useBalance; void useBalances;
`,
  );
  run("pnpm", [
    ...strict,
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "consumer.ts",
  ]);
  writeFileSync(
    join(temporary, "registration.ts"),
    `
import { register } from "@vllnt/convex-wallet/test";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
const host = defineSchema({ unrelated: defineTable({ label: v.string() }) });
register(convexTest(host, {}), "custom");
`,
  );
  run("pnpm", [...bundler, "registration.ts"]);
  // The shipped test helper is TypeScript source: it must also compile for NodeNext consumers.
  run("pnpm", [
    ...strict,
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--types",
    "node",
    "registration.ts",
  ]);
  run("node", [
    "--input-type=module",
    "-e",
    'import { Wallet } from "@vllnt/convex-wallet"; import config from "@vllnt/convex-wallet/convex.config.js"; import { useBalance, useBalances } from "@vllnt/convex-wallet/react"; if (!Wallet || !config || !useBalance || !useBalances) throw Error("missing export");',
  ]);
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
