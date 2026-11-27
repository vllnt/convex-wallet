// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The npm tarball must carry the version-matched docs that coding agents read
// from node_modules/@vllnt/convex-wallet/, and nothing contributor-only.
// `dist` is checked by the build, not here (CI's Test job does not build).
const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
  "src/client/index.ts",
  "src/test.ts",
];

const FORBIDDEN = [
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^CONTRIBUTING\.md$/,
  /^(example|scripts|coverage|\.github)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
];

/** @returns {string[]} */
function packedFiles() {
  const raw = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  /** @type {{ files: { path: string }[] }[]} */
  const [result] = JSON.parse(raw);
  return result.files.map((file) => file.path);
}

describe("npm tarball", () => {
  const files = packedFiles();

  it.each(REQUIRED)("ships %s", (path) => {
    expect(files).toContain(path);
  });

  it("ships every docs/*.md file", () => {
    const docs = execFileSync("git", ["ls-files", "docs/*.md"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    expect(docs.length).toBeGreaterThan(0);
    for (const path of docs) expect(files).toContain(path);
  });

  it("ships no contributor-only files or tests", () => {
    const leaked = files.filter((path) => FORBIDDEN.some((re) => re.test(path)));
    expect(leaked).toEqual([]);
  });

  it("resolves every relative llms.txt link inside the tarball", () => {
    const links = [...readFileSync("llms.txt", "utf8").matchAll(/\]\(([^)]+)\)/g)]
      .map((match) => match[1])
      .filter((href) => !/^[a-z]+:/i.test(href));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(href).toMatch(/^\.\//);
      expect(files).toContain(href.slice(2));
    }
  });
});
