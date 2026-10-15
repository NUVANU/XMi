# M11 Owner acceptance protocol

This document states exactly what the Owner has to do to close the V0.1 private-alpha gate, and what evidence each
step produces. XMi does not execute any of it, and no candidate may claim any of it as done.

## Step 0 - Novice installation and first activation (added 2026-09-20)

Execute `M11-INSTALL-FIRST-RUN.md` on a clean supported local-host setup. Supply the package and say
“请安装 XMi”; follow the installation and location guidance. Start a fresh conversation with only “启用 XMi”.
XMi must offer create/resume and proactively ask for product information, mode and save-location confirmation.

Record M11-ONB outcomes, versions, actual locations and canonical read-back with private details redacted.
Include text fallback, invalid path, unavailable/cancelled confirmation and same-project resume observations.
On 2026-09-26, the Owner reported that the installation, activation, data-location selection, creation and cross-conversation resume happy path succeeded on another computer; the actual test date was not supplied. Host/runtime version, test date, canonical read-back and negative cases remain unreported; full Step 0 acceptance is pending. See `docs/evidence/M11-ONBOARDING-OWNER-REPORT-20260926.json`.
Use the supported host installation mechanism; arbitrary plugin-cache relocation is not presumed.

## Step 1 - Real-session host invocation (about 5 minutes)

In a live Codex session, ask for the Skills and the tools, call one tool, and record one negative prompt:

1. Ask: list every Skill whose name or description mentions XMi.
2. Ask: list every MCP tool whose name starts with `xmi_`.
3. Call `xmi_project_get` with `project_id` = `XMI-PROBE-NONEXISTENT-0001` and report the exact error code string it
   returns. The expected code is **`PROJECT_NOT_FOUND`**.

   Use exactly that value. `project_id` is constrained to `XMI-` plus uppercase letters, digits and hyphens, so a
   lowercase id such as `probe-nonexistent-project` is rejected by the input schema and returns `INVALID_ARGUMENTS`
   instead. That code has no discriminating power here: it is what a working tool returns for a malformed argument and
   also what a misconfigured one could return for everything, so it cannot distinguish "the tool ran and looked the
   project up" from "the tool rejected the request". `PROJECT_NOT_FOUND` does: it proves the tool executed, validated
   the argument and performed a canonical-state lookup.
4. Ask one prompt with no XMi content at all (for example an unrelated general question), and report whether any XMi
   Skill or `xmi_` tool was selected or invoked without being asked for.

Step 4 exists because the unit of work is explicit invocation versus unexpected invocation, and only a negative prompt
observes the second one. Without it, that gate item cannot be closed by this protocol at all.

Closes: the section 1 Plugin item "Explicit invocation works" (steps 1-3) and the section 1 Plugin item "Negative
prompts do not invoke unexpectedly" (step 4). Either item may be reported closed only for the steps actually observed.

Evidence to keep: the session transcript or a screenshot covering every executed step, plus the exact error code
string.

## Step 2 - A real dogfood product idea

Continue from Step 0 with a real, non-fixture product idea in the supported profile (Web App / Micro-SaaS). XMi must proactively ask for the following; the Owner need not prepare or paste a product template:

- one sentence naming the product and who it is for;
- the outcome the Owner wants from it;
- confirmation that this is a real project, not a sample or a fixture.

With the required Owner confirmations, XMi will then, in a real session: start it in `FAST_DEVELOPMENT`, run the mode-gap analysis, upgrade once to
`PRODUCT_GRADE`, and compile the resulting XSpec.

Closes: the section 1 Completeness/readiness and Product fidelity items that depend on a real project, and the
XSpec items that depend on a real compiled artifact.

Evidence to keep: the project id, the compiled XSpec artifact, and the mode-gap report.

## Step 3 - Independent consumer runtimes (not scheduled)

The two items in `docs/16` section 5 need an independent XUi runtime and a real XDev importer/runtime. Neither
exists today. `docs/02` V0.2 owns that work. Until then those items stay deferred and must not be reported as
private-alpha items.

## What this protocol does not do

It does not execute anything, it does not certify anything, and it does not close the gate by itself. It exists so
that the remaining work has a named owner and a defined evidence shape instead of a bare "carried".
