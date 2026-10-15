import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const readJson = (path: string) => JSON.parse(read(path));

test("M10 local marketplace descriptor is the Owner-approved xmi-local shape", () => {
  assert.deepEqual(readJson("plugins/xmi/.agents/plugins/marketplace.json"), {
    name: "xmi-local",
    interface: {displayName: "XMi Local"},
    plugins: [{
      name: "xmi",
      source: {source: "local", path: "./"},
      policy: {installation: "AVAILABLE", authentication: "ON_INSTALL"},
      category: "Productivity",
    }],
  });
});

test("M10 ADR-009 moves hosted-surface testing to the public gate without weakening section 1", () => {
  const release = read("docs/16-RELEASE-GATE.md");
  const privateStart = release.indexOf("## 1. V0 private alpha gate");
  const publicStart = release.indexOf("## 2. Public plugin gate - deferred");
  const stopStart = release.indexOf("## 3. Stop/rollback conditions");
  assert.ok(privateStart >= 0 && publicStart > privateStart && stopStart > publicStart);
  const privateGate = release.slice(privateStart, publicStart);
  const publicGate = release.slice(publicStart, stopStart);
  assert.equal(privateGate.includes("ChatGPT and Codex tested on supported private-alpha surfaces."), false);
  assert.equal(publicGate.includes("ChatGPT and Codex tested on the supported public surfaces, including the hosted one;"), true);
  assert.match(privateGate, /### V0 surface scope \(ADR-009\)/);
  for (const heading of ["### Product fidelity", "### Completeness/readiness", "### XSpec", "### Continuity",
    "### Plugin", "### Security/privacy", "### Documentation"]) {
    assert.ok(privateGate.includes(heading), heading);
  }
  const adr = read("docs/adr/ADR-009-V0-SURFACE-SCOPE.md");
  assert.match(adr, /Status: \*\*Accepted for V0 by Owner decision on 2026-09-19\*\*/);
  assert.match(adr, /Remote access, Secure MCP Tunnel, authentication, multi-tenant hosting and paid infrastructure remain/);
});

test("M10 leaves the M8 readiness suffix family unchanged across the eight locked files", () => {
  const files = [
    "apps/mcp-server/contracts.ts",
    "apps/mcp-server/server.ts",
    "packages/core/completeness-service.ts",
    "packages/core/xspec-service.ts",
    "tests/fixtures/m7-invalid-xspec-fixtures.json",
    "tests/m7.test.ts",
    "tests/m8.test.ts",
    "tests/m9.test.ts",
  ];
  const needles = ["NOT_READY_M8", "CANDIDATE_NOT_READY_M8", "FALSE_READINESS_CLAIM_M8"];
  const hits = files.flatMap((path) => read(path).split("\n")
    .filter((line) => needles.some((needle) => line.includes(needle))).map((line) => ({path, line})));
  assert.equal(files.length, 8);
  assert.equal(hits.length, 19);
  assert.equal(new Set(hits.map((hit) => hit.path)).size, 8);
});

test("M10 keeps XMem background-only and does not fabricate host capabilities", () => {
  const modes = read("docs/18-UNIFIED-DELIVERY-MODES.md");
  assert.match(modes, /XMem adapts in the background and is never presented as a separate mode choice/);
  const manifest = readJson("plugins/xmi/.codex-plugin/plugin.json");
  assert.deepEqual(manifest.interface.capabilities, []);
  assert.equal(manifest.apps, undefined);
  assert.equal(manifest.hooks, undefined);
});

test("M10 documentation makes the manual-config stop-condition risk and real-consumer gaps explicit", () => {
  const readme = read("plugins/xmi/README.md");
  assert.match(readme, /partial stop-condition hit for the nontechnical target user/);
  assert.match(readme, /codex plugin add xmi@xmi-local --json/);
  const report = read("docs/M10-MILESTONE-REPORT.md");
  assert.match(report, /XUi consumer runtime does not exist/);
  assert.match(report, /real XDev importer\/runtime/);
  assert.match(report, /non-fixture real dogfood/);
});
