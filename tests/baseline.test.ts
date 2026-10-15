import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";
import {createHash} from "node:crypto";

const root = process.cwd();
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

test("M0 runtime matches the declared baseline", () => {
  assert.equal(process.version, `v${readJson("package.json").engines.node}`);
});

test("official creator-compatible package resolves Skills and declares the local M9 STDIO server", () => {
  const base = "plugins/xmi";
  const manifest = readJson(`${base}/.codex-plugin/plugin.json`);
  assert.equal(manifest.name, "xmi");
  assert.ok(existsSync(resolve(root, base, manifest.skills)));
  assert.ok(existsSync(resolve(root, base, manifest.mcpServers)));
  assert.deepEqual(readJson(`${base}/.mcp.json`), {mcpServers: {xmi: {
    command: "<abs-path-to-node>",
    args: ["<abs-path-to-xmi-repo>/apps/mcp-server/main.ts", "--db", "<abs-path-to-xmi-state.sqlite>"],
  }}});
  assert.deepEqual(manifest.interface.capabilities, []);
  assert.equal(manifest.apps, undefined);
  assert.equal(manifest.hooks, undefined);
  assert.deepEqual(readdirSync(resolve(root, base, "skills")).sort(), [".gitkeep", "xmi-audit-export", "xmi-discovery"]);
  assert.ok(existsSync(resolve(root, base, "skills/xmi-discovery/SKILL.md")));
});

test("design JSON and sample JSON parse; schemas declare the intended draft", () => {
  for (const directory of ["schemas", "samples"]) {
    const files = readdirSync(resolve(root, directory)).filter((file) => file.endsWith(".json"));
    assert.ok(files.length > 0, `Missing ${directory}`);
    for (const file of files) {
      const value = readJson(`${directory}/${file}`);
      assert.equal(typeof value, "object", file);
      if (directory === "schemas") {
        assert.equal(value.$schema, "https://json-schema.org/draft/2020-12/schema", file);
      }
    }
  }
});

test("existing schema local references resolve", () => {
  for (const file of readdirSync(resolve(root, "schemas"))) {
    if (!file.endsWith(".json")) continue;
    const schema = readJson(`schemas/${file}`);
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref" && typeof child === "string" && child.startsWith("#/")) {
          let target: unknown = schema;
          for (const part of child.slice(2).split("/")) {
            const decoded = part.replaceAll("~1", "/").replaceAll("~0", "~");
            assert.ok(target !== null && typeof target === "object", `${file}: ${child}`);
            target = (target as Record<string, unknown>)[decoded];
          }
          assert.notEqual(target, undefined, `${file}: ${child}`);
        }
        visit(child);
      }
    };
    visit(schema);
  }
});

test("M0 reports remain available and later optional UI remains absent", () => {
  for (const file of ["M0-CAPABILITY-REPORT.md", "M0-IMPLEMENTATION-DECISION.md", "M0-MILESTONE-REPORT.md"]) {
    assert.ok(existsSync(resolve(root, "docs", file)), file);
  }
  for (const path of ["apps/plugin-ui"]) {
    assert.equal(existsSync(resolve(root, path)), false, `Out-of-M0 implementation: ${path}`);
  }
});

const FRAMING_EXEMPTIONS: Record<string, string> = {
  "docs/adr/ADR-006-XMI-XDEV-DELIVERY-HANDOFF-ENVELOPE.md":
    "frozen closed-baseline contract; rewriting its final newline would invalidate recorded hashes",
  "plugins/xmi/skills/.gitkeep": "zero-byte placeholder",
};

test("repository files use LF and a canonical single trailing newline (docs/13 section 6.4)", () => {
  // Scope is version-controlled repository content only. docs/13 section 6.4 governs files a
  // milestone created or modified, so a local-only artifact can never violate it. The skip set
  // therefore mirrors .gitignore: local environment, cache and runtime directories plus the manual
  // backup file patterns this repository deliberately keeps out of version control. Keep it in step
  // with .gitignore: a newly ignored top-level directory must be added here too.
  const skipDirectories = new Set([
    ".git", "node_modules", "dist", "exports", "_e2e", ".xmi-install",
    ".m0-python", ".npm-cache", ".xmem", ".xmem-codex-install", "xmem-bridge-state",
  ]);
  const skipFileNames = /\.bak-|\.xmem-backup-/;
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (entry.isDirectory()) {
        // The cloud Site has its own source repository, generated Worker assets and checks.
        // Root framing rules still cover every file outside that isolated application.
        if (relative(root, join(dir, entry.name)).split(sep).join("/") === "apps/cloud-site") continue;
        if (!skipDirectories.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        if (skipFileNames.test(entry.name)) continue;
        files.push(relative(root, join(dir, entry.name)).split(sep).join("/"));
      }
    }
  };
  walk(root);
  assert.ok(files.length > 100, `unexpectedly small repository scan: ${files.length}`);
  const thirdParty=readJson("packages/mammoth-api/UPSTREAM.json").files as Record<string,string>;
  for (const file of files) {
    const bytes = readFileSync(resolve(root, file));
    const source=file.startsWith("packages/mammoth-api/")?file.slice("packages/mammoth-api/".length):null;
    // Retained third-party bytes are governed by the pinned upstream hash, not reformatted.
    if(source&&thirdParty[source]) {
      assert.equal(createHash("sha256").update(bytes).digest("hex"),thirdParty[source],`${file}: upstream bytes changed`);
      continue;
    }
    assert.equal(bytes.indexOf(13), -1, `${file}: contains a CR byte; every file must be LF-only`);
    if (FRAMING_EXEMPTIONS[file]) continue;
    assert.equal(bytes.length > 0, true, `${file}: must not be empty`);
    assert.equal(bytes[bytes.length - 1], 10, `${file}: must end with exactly one LF`);
    assert.notEqual(bytes[bytes.length - 2], 10, `${file}: must not end with a blank line`);
  }
});
