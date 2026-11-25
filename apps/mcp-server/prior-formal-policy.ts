import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fingerprint} from "../../packages/core/validation.ts";
import {isCompactFormalMaterial} from "../../packages/core/formal-review-material.ts";
import type {ReviewBundle} from "../../packages/core/spec-review-service.ts";

const previousPolicies = ["55fa277cf780feb501be013b7d43d1a64cd9adef1edb5a963f77d85a031a6dde",
  "2676c703d14091d6543de68fe5f81d244570f18daba425a281942de73f02a38f",
  "b9ced63c5021448deab0d06635a8d8fd93b410288e5dff7438aac071e68f0555"];
// Closing and launch recovery changed the host envelope. Exact prior proofs
// remain usable while the verified isolation and readiness policy is preserved.
const unchanged = {
  "packages/core/completeness-service.ts": "7b5eb7cb5dcb87e9aecc3be247d3d94b7ffba0b01c912fce7fb41cc3638c6f6d",
  "packages/core/formal-review-material.ts": "c020b15383c475ac2154bc0eac17df71751192be4f1569e0687a09a39df23032",
  "packages/core/audit-service.ts": "8d14dda6a70e09cd0ff856bdefc29e5dae2ec481112ceda420d6d19597f3d55d",
  "packages/core/payment-scope.ts": "4227b52b9380a232df385c95d9959c1bd3731403da94d5ff6effb50afa520956",
  "packages/core/profile-rules.ts": "980bb4f7e4eb8d9d883df7ffbff34fdfd8d054c26310178b1d38384f05e682dd",
  "packages/core/solution-feasibility.ts": "e541f5ee3026348f58c236e39505d28f131940923a6be0cb360ed1d1bfac38c1",
  "packages/core/solution-options.ts": "96504e907bf46c1cae4d9867d17d357aabf30d0ea21f8cedc28a9adf0cd0db69",
  "apps/mcp-server/formal-review-turn.ts": "775d0f6b6c8cfd814e1b7a2d713f8169aa8532e8100cf5e0432dc1c638089a81",
  "apps/mcp-server/windows-formal-review.ts": "c821bd7f2e9773c21fcd0b36c1075a592eee3c9ae1ad8fde99b7c6054b952d08",
  "apps/mcp-server/windows-launcher.ts": "50f8ad7d2cba9747a583c145dd2d53c8a35bc51b08751ecec6cc7f506b817e60",
  "apps/mcp-server/formal-review-anchors.ts": "63fa63966e91d8293f3d5e679a19e141ec23dd3b4a401b83163d9e32f05ee1da",
  "apps/windows-formal-review/IsolatedLauncher.cs": "0d0f2d373a24a89629cb18b2734dda32dd708fae8b4782436fc835afe8d9d1b2",
  "apps/windows-formal-review/Worker.cs": "cc49fdb75f3fcfd3925876c930bf075c95c372ba7d0b6f594c31b2c56d358871"
};

export function previousFormalBundles(bundle: ReviewBundle): ReviewBundle[] {
  if (bundle.material_kind || isCompactFormalMaterial(JSON.parse(bundle.material))) return [];
  const root = new URL(import.meta.url.includes("/dist/") ? "../../../" : "../../", import.meta.url);
  try {
    if (!Object.entries(unchanged).every(([path, sha]) =>
      createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex") === sha)) return [];
  } catch {return [];}
  const {bundle_sha256, ...current} = bundle;
  return previousPolicies.map(policy_sha256 => {
    const previous = {...current, policy_sha256};
    return {...previous, bundle_sha256: fingerprint(previous)};
  }).filter(previous => previous.bundle_sha256 !== bundle_sha256);
}
