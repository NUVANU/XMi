// Connector bundle builder: produces the publishable single-file MCP server used by the
// SkillHub connector package (npm `xmi-mcp`), not the developer source tree.
//
// Why a plugin instead of a plain esbuild call: `apps/mcp-server/main.ts` ends with a self-start
// guard that compares `pathToFileURL(resolve(process.argv[1]))` with `import.meta.url`. That guard
// is correct for `node apps/mcp-server/main.ts` and for `node dist/apps/mcp-server/main.js`, but in
// a single-file bundle both sides resolve to the bundle itself, so the guard fires and starts a
// SECOND server in native mode (28 advertised tools) alongside generic.ts's own start (26). The
// consequence measured on 2026-10-21 was a package that advertised `xmi_spec_review_start/status`,
// two tools the generic catalog deliberately hides. The build therefore neutralizes that one line
// for the connector bundle only, and fails loudly if the line is not found.
import { mkdirSync, readFileSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { out: join(ROOT, "dist", "connector") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") out.out = resolve(argv[i + 1]);
  }
  return out;
}

const { out } = parseArgs(process.argv.slice(2));
const OUT = out;
const MAIN_OUT = join(OUT, "dist", "xmi-mcp.mjs");
const WORKER_OUT = join(OUT, "dist", "docx-worker.js");
const SCHEMA_OUT = join(OUT, "schemas");

const SELF_START =
  'if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void startXmi(true);';
const NEUTRALIZED =
  '/* connector bundle: native self-start neutralized; generic.ts owns process startup */';

const esbuild = await import(pathToFileURL(join(ROOT, "node_modules", "esbuild", "lib", "main.js")).href);

// Third-party dependencies stay external and are installed by npm; the private file: package
// @xmi/mammoth-api must be inlined because npm cannot publish a file: dependency.
const external = [
  "@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*",
  "ajv", "ajv/*",
  "ajv-formats", "ajv-formats/*",
  "pdfjs-dist", "pdfjs-dist/*",
  "zod",
];

let neutralized = 0;
const connectorGuard = {
  name: "connector-self-start-guard",
  setup(build) {
    build.onLoad({ filter: /[\\/]apps[\\/]mcp-server[\\/]main\.ts$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (!source.includes(SELF_START)) {
        throw new Error(`CONNECTOR_BUILD_SELF_START_NOT_FOUND: ${args.path}. The guard line changed; update tools/build-connector.mjs before publishing.`);
      }
      neutralized += 1;
      return { contents: source.replace(SELF_START, NEUTRALIZED), loader: "ts" };
    });
  },
};

const common = {
  absWorkingDir: ROOT,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  metafile: true,
  logLevel: "warning",
  banner: {
    js: "import { createRequire as __xmiCreateRequire } from 'node:module'; const require = __xmiCreateRequire(import.meta.url);",
  },
};

mkdirSync(join(OUT, "dist"), { recursive: true });
mkdirSync(SCHEMA_OUT, { recursive: true });

const server = await esbuild.build({
  ...common,
  entryPoints: [join(ROOT, "apps", "mcp-server", "generic.ts")],
  outfile: MAIN_OUT,
  plugins: [connectorGuard],
});
if (neutralized !== 1) {
  throw new Error(`CONNECTOR_BUILD_GUARD_COUNT: expected exactly 1 neutralized self-start, got ${neutralized}`);
}

await esbuild.build({
  ...common,
  entryPoints: [join(ROOT, "packages", "core", "docx-worker.ts")],
  outfile: WORKER_OUT,
});

const schemaDir = join(ROOT, "schemas");
const schemas = readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"));
for (const name of schemas) copyFileSync(join(schemaDir, name), join(SCHEMA_OUT, name));
const producerSchema = join(OUT, "docs", "public", "producer-evidence.schema.json");
mkdirSync(dirname(producerSchema), { recursive: true });
copyFileSync(join(ROOT, "docs", "public", "producer-evidence.schema.json"), producerSchema);

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
console.log(JSON.stringify({
  ok: true,
  out: OUT,
  dist: {
    "xmi-mcp.mjs": { bytes: statSync(MAIN_OUT).size, sha256: sha256(MAIN_OUT), inputs: Object.keys(server.metafile.inputs).length },
    "docx-worker.js": { bytes: statSync(WORKER_OUT).size, sha256: sha256(WORKER_OUT) },
  },
  schemas: schemas.map((n) => ({ name: n, bytes: statSync(join(SCHEMA_OUT, n)).size })),
  producer_evidence_schema: { path: "docs/public/producer-evidence.schema.json", sha256: sha256(producerSchema) },
  self_start_neutralized: neutralized,
}, null, 2));
