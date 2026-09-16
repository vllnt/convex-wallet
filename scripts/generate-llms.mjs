import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Kept for existing automation; llms.txt is curated, not generated from source.
const index = readFileSync("llms.txt", "utf8");
assert.ok(index.startsWith("# @vllnt/convex-wallet\n"));
assert.ok(index.includes("[README](README.md)"));
assert.ok(index.includes("[API Reference](docs/API.md)"));
