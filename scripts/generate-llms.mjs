import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Kept for existing automation; llms.txt is curated, not generated from source.
// Links to files shipped in the npm tarball are relative so they match the
// installed version; scripts/package-files.test.mjs checks they resolve.
const index = readFileSync("llms.txt", "utf8");
assert.ok(index.startsWith("# @vllnt/convex-wallet\n"));
assert.ok(index.includes("[README](./README.md)"));
assert.ok(index.includes("[API Reference](./docs/API.md)"));
assert.ok(index.includes("[Changelog](./CHANGELOG.md)"));
assert.ok(index.includes("## For coding agents"));
assert.ok(index.includes("node_modules/@vllnt/convex-wallet/"));
assert.ok(index.includes("(https://oss.vllnt.com/llms.txt)"));
