# ADR-020 — API-only DOCX dependency

## Authorization

On 2026-10-15 the Owner approved retaining DOCX parsing while removing the unused Mammoth CLI chain, pinning source/integrity/licenses and verifying clean installation before packaging. This extends the isolation correction in ADR-018. No public package, GitHub publication or hosted rollout is included.

## Decision

Use the private local dependency @xmi/mammoth-api, version 1.12.3-xmi.1, from packages/mammoth-api. It is an explicitly named derivative, not an upstream patched release. tools/prepare-docx-api.mjs accepts only the pinned official mammoth@1.12.3 tarball after SHA-512 verification. It retains API source/type/browser-mapping files and LICENSE byte-for-byte, drops bin/, lib/main.js, argparse and upstream scripts, and records every retained source hash in UPSTREAM.json. The original package metadata is retained as provenance, not an active install manifest. Runtime dependencies otherwise retain their upstream declarations and are resolved by the repository lockfile.

Root extraction still uses the unchanged raw-text API in the same bounded child. Time/input/output/heap/environment controls and sanitized failures remain. No parser algorithm, stored design item, user approval, schema or source-location behavior is rewritten.

The browser API is rebuilt from this source and the current audited dependency graph with fixed development-only esbuild 0.28.2. It does not reuse the older upstream prebundled dependency copies. The build records complete input hashes, component versions, output hash and license texts in browser.SBOM.json and THIRD-PARTY-NOTICES.txt. browser.d.cts provides the narrow array-buffer typing. Reproduction uses the same lockfile and offline source inputs; no install hook builds the artifact. Source and lean collections include all local dependency bytes unchanged.

The separate cloud source copies the same controlled package and imports the self-contained browser artifact by a relative path. It removes the unused npm Mammoth dependency. Whole-tree npm re-resolution exposed an existing optional @hookform/resolvers / ajv-formats peer conflict. A legacy-peer probe would remove/change unrelated nodes, so its output was not applied. The lockfile therefore prunes only Mammoth, its nested argparse/base64-js and sprintf-js entries; every other node remains identical. No force/peer-bypass setting or unrelated dependency upgrade is introduced. Cloud parser tests/types/build can be verified locally; its complete clean install remains blocked by that independent template conflict.

## Maintenance and limitations

The new package name is not a security waiver. Future upstream Mammoth/parser advisories require checking the pinned upstream identity and component inventory because npm cannot automatically map all source-fork advisories. Changes to source, license or dependency resolution require reviewed provenance refresh, browser reproduction, clean installation and DOCX regression. The source formatting gate checks retained third-party bytes by their pinned hashes; owned/generated files retain normal framing requirements.

Upstream raw-text soft line breaks are flattened, while paragraph breaks/tabs/table-cell text remain. This pre-existing extraction behavior is preserved, not silently fixed by dependency trimming. The source is still a resource-bounded parser rather than an OS sandbox.

The root dependency audit and the separate cloud template audit are different scopes. Removal of this chain does not establish a clean cloud template, deployed update, independent security review or real host acceptance. See DOCX-API-DEPENDENCY-FIX-20261015.md for exact verification and remaining cloud gates.
