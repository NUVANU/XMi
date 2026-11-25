# XMi

**Turn “I have an idea” into “this is what we agreed to build.”**

Guided product clarification and traceable XSpec specifications for AI-assisted development.

**English** · [简体中文](https://github.com/NUVANU/XMi/blob/main/README.zh-CN.md)

[Quick start](#quick-start) · [Architecture](docs/public/ARCHITECTURE.md) · [Known issues](docs/public/KNOWN-ISSUES.md) · [X Suite](https://github.com/NUVANU/X-Suite)

You should not have to know the code before you can explain the product you want. But a short prompt often leaves the AI to guess the rules, fill in missing decisions, and expand the scope.

**XMi helps you make those decisions before they become code.** Discuss your idea module by module, see what is confirmed and what is still open, and export a versioned specification that another developer or agent can inspect.

## What's new in V0.1.4

**Fewer closing steps, stronger review evidence.** The native `xmi_finalize` entry gathers outstanding design decisions and readiness checks; numbered document pages and bound short replies keep the review understandable. Unchanged confirmed choices can be reused where valid. A real product change still requires its own displayed decision and genuine reply.

- **Preserve complete review material.** Formal-review input uses a lossless span dictionary with source anchors; receipts are checked against the frozen project/version and required findings. Missing, stale or incomplete evidence stays unresolved.
- **Connect supported Windows review.** The formal-review launcher and receipt recovery serve a configured Windows/Codex path. It needs trusted local configuration and appropriate authorization; missing capability does not become a passing review.
- **Carry design context through compaction.** Native PreCompact/PostCompact hooks save and check project/version context. An optional configured XMem route can preserve checkpoints; these records do not confirm decisions or prove correct later adoption.

**Latest source:** [V0.1.4 source ZIP](https://github.com/NUVANU/XMi/archive/refs/heads/main.zip). The fixed [v0.1.3 Release](https://github.com/NUVANU/XMi/releases/tag/v0.1.3) and its lightweight installer are an **older version** and do not contain this update. See [setup, compatibility, privacy and validation scope](docs/public/UPDATE-20261125.md).

## What’s new in V0.1.3

**V0.1.3** packages the 2026-11-22 source update as fixed downloads: [Release](https://github.com/NUVANU/XMi/releases/tag/v0.1.3) · [Lightweight ZIP](https://github.com/NUVANU/XMi/releases/download/v0.1.3/xmi-0.1.3-lite.zip) · [Source ZIP](https://github.com/NUVANU/XMi/releases/download/v0.1.3/xmi-0.1.3-source.zip) · [SHA-256 checksums](https://github.com/NUVANU/XMi/releases/download/v0.1.3/SHA256SUMS.txt). The earlier v0.1.2 release stays available unchanged. See [release notes](docs/public/RELEASE-0.1.3.md).

- **Less repeated confirmation.** Show complete replacement text once. A bounded Codex Stop preflight checks checklist delivery before asking for consent; the genuine user reply, version binding and commit remain required.
- **Continue from the change.** Version-bound incremental project reads, exact item reads and short validation receipts reduce repeated context. Counts, pagination and full readback remain available; summaries do not replace review evidence or approval.
- **Reuse approved technical choices where valid.** Eligible requirement, acceptance and integration amendments can carry forward the confirmed blueprint in one commit. Real solution changes keep the existing review path.
- **A separate prototype integration.** An opt-in local host adapter presents the first-version behavior, flow and observable checks, groups open choices, and can publish a verified 16-file prototype XSpec after the actual displayed user choice. The ordinary MCP catalog remains unchanged by default; this is not a hosted product or production-readiness claim.

See [update details, upgrade compatibility and validation scope](docs/public/UPDATE-20261122.md). Existing databases need a backup before upgrade: the additive blueprint-binding event requires an updated reader; an older reader may need its pre-upgrade backup.

## V0.1.2 release baseline

- **Confirm the changes that need a decision.** Reuse unchanged confirmed facts and dispositions. A clear issue-handling reply confirms its chosen actions; reports and review startup do not add another confirmation round.
- **Generate the architecture alongside the specification.** After solution confirmation, XMi generates the version-bound **24-chapter system architecture** before full independent content review. It is available at `.xmi/context/architecture.md` and in `TECHNICAL-SOLUTION-BLUEPRINT.md` within the existing 16-file XSpec package.
- **Review requirements and architecture together.** Use the supported host’s existing independent-agent capability for advisory content review. Unchanged readback reuses the current result; an actual product change receives review for the new version.
- **Retain the original boundaries.** Fixes cover configured `CODEX_HOME` routing, confirmed local-browser/page-memory solutions, and recharge-failure recognition. A generated architecture does not invent approval, and export still needs authorization for the exact package.

See the [V0.1.2 release notes](docs/public/RELEASE-0.1.2.md) and [workflow](docs/public/WORKFLOW.md) for the supported behavior and acceptance scope.

## What can XMi help you do?

| Start with… | Work toward… |
| --- | --- |
| A rough idea for an app, tool, SaaS product, or game | A structured product model with scope and acceptance criteria |
| Existing Markdown, text, DOCX, or PDF requirements | Source-linked proposals to review, rather than silently adopted facts |
| Conflicting terms and incomplete rules | Explicit definitions, decisions, conflicts, and open questions |
| A conversation that only makes sense to its participants | A persistent model and readable project context for the next session |
| A polished PRD with unclear approval | An XSpec whose confirmed items, versions, and sources can be checked |

XMi is useful for nontechnical builders defining a first product, developers clarifying an ambiguous request, and teams handing requirements to another person or coding agent.

## See the difference in a small example

Your starting idea:

> “I want an app where neighbors can reserve shared tools.”

Before implementation, XMi helps you discuss questions such as:

- Can two people reserve the same tool at overlapping times?
- Can the borrower cancel, and until when?
- What happens if the tool becomes unavailable?
- Which rules belong in the first release, and which should remain out of scope?

Suggestions remain proposals. Undecided behavior stays open. You review the complete confirmation checklist before the corresponding decisions are adopted.

This is an example of the clarification process, not a claim that XMi has already built or validated this app.

## Core capabilities

### Clarify by module, with the relevant context

Discuss the current rules, related background, open decisions, and alternatives together. XMi separates confirmed, proposed, rejected, and unresolved items so that an AI suggestion does not silently become a product requirement.

### Keep confirmation meaningful

On the documented Codex path, the complete pending checklist is shown in chat. For a single-item change, that list contains the changed item while the other confirmed items are reused. The default whole-list reply is **确认**; legacy replies remain compatible. Conditional, modifying, or incomplete replies do not mean whole-list consent.

A real user reply is checked by the native confirmation hook; the tool commits the corresponding change and reads the stored state back. Preparing a checklist alone does not confirm it. Architecture generation and validation reports do not create extra product-confirmation steps.

### Continue beyond one conversation

New local projects store their authoritative model in `.xmi/xmi-state.sqlite` under the confirmed project root. `XMI-START-HERE.md` and generated context files make the current design, decisions, and pending questions easier for another agent to read. These files are derived views: editing them does not approve a decision.

Older shared-database projects remain supported without automatic migration. Resume an existing project using its original project ID and data configuration.

### Export an inspectable specification

XMi compiles and validates **XSpec**, a versioned handoff package containing the specification, supporting documents, and integrity metadata. Audit/readiness checks expose missing coverage and blockers. A score does not override a blocker, and exporting a specification does not authorize development.

The current XDev handoff contract uses a 16-file package with manifest/content hashes. See [handoff details](docs/public/XDEV-HANDOFF.md).

## Quick start

Current public source: **V0.1.4 · package `0.1.4` · Apache-2.0**.

Use **Node.js 24.20.0** and **npm 11.19.0**. Clone this repository or download its source, then run the following from its root:

```sh
npm ci --omit=dev --ignore-scripts
npm run check
npm run configure -- --host codex --data-dir "C:/XSuite/xmi-data"
```

Choose an absolute local data directory outside the XMi installation. The configuration helper returns a `plugin_directory`; add it through the host-supported local plugin entry point, review the native hooks, and start a new connection. The helper refuses to overwrite an existing configuration or take over an existing database.

**Complete setup:** [installation, hook trust, resume, and upgrade](docs/public/INSTALL.md). Node.js and dependencies are not bundled; first-time dependency installation needs network access. The self-check uses temporary synthetic data and does not establish real-host or human acceptance.

After connecting, try:

```text
Use XMi to clarify my product idea with me, one module at a time.
Show current decisions, relevant background, open questions, and suggestions.
Keep undecided behavior open. Before adopting changes, display the full
confirmation checklist in chat.
```

A WorkBuddy configuration entry is also available via `--host workbuddy`. Its actual form/Skill behavior and clean-host installation require separate validation; see [platform status](docs/public/PLATFORMS.md). This public distribution does not provide a hosted ChatGPT web/mobile service.

## Technical design

| Layer | Responsibility |
| --- | --- |
| Skills + MCP | Guide the conversation and expose structured project operations |
| Domain services + validated schemas | Maintain the authoritative product model and state transitions |
| Local SQLite | Store product state, events, and receipts transactionally |
| Confirmation adapters | Bind a displayed review to the applicable real confirmation flow |
| XSpec compiler and validators | Produce a versioned handoff and check references, coverage, and integrity |

The Codex confirmation path separates a granted reply from the domain commit. If a write has already committed but a later receipt step fails, recovery uses the original receipt rather than creating a second batch. Project context files carry version/hash information so stale derived files are distinguishable.

For implementation details, see [architecture](docs/public/ARCHITECTURE.md), [project-local storage](docs/adr/ADR-023-PROJECT-LOCAL-DESIGN-DATA.md), and [scope decisions](docs/adr/ADR-021-XSPEC-CORE-SCOPE-CONVERGENCE.md).

## How XMi fits into X Suite

- **XMi:** clarify and preserve product intent; produce XSpec.
- **XDev:** govern development scope and evaluate implementation/Review/QA evidence.
- **XMem:** preserve and retrieve versioned engineering history.
- **Your host and model:** write code, run tools, and manage agent execution.

XMi works without XMem. Its canonical product model is not delegated to a memory summary. For the combined local workflow, see [X Suite](https://github.com/NUVANU/X-Suite).

## Status, privacy, and limitations

The V0.1.4 public tree passed **545 tests, zero failures/skips**, lint, build, temporary-data self-check, DOCX source verification and a 324-file archive-closure check. The suite excludes optional private-project replays. These source/packaging checks do not establish real-host formal readiness, clean-machine isolation, or correct post-compaction adoption. See [the current validation scope](docs/public/UPDATE-20261125.md).

The V0.1.2 local release record reports **483 passing tests, zero failures** in both the tested source and installed release tree, plus a genuine workflow check in the existing Windows Codex desktop installation. That check applied one changed item, preserved ten unchanged confirmed items, generated the same-version 24-chapter architecture, and collected one real independent Agent review. See the [scoped acceptance summary](docs/public/releases/0.1.2/ACCEPTANCE-SUMMARY.json).

This establishes that bounded existing-machine workflow. Clean-machine installation, exhaustive host-level failure/concurrency acceptance, Linux/macOS host use, and WorkBuddy’s full flow remain separate checks.

Risk matching is deterministic review assistance and may need clarification for ambiguous or mixed-scope text. The independent content review is advisory; it does not establish formal product assurance or actual XDev/XUi downstream acceptance. The acceptance fixture retained its unresolved findings and `NOT_READY_M8` status. See [known issues](docs/public/KNOWN-ISSUES.md) and [platform evidence](docs/public/PLATFORMS.md).

Product data is stored locally on the documented path. Your host/model may still transmit conversation or tool context to its provider. Import only material you are authorized to use; keep secrets and private project data out of public issues. See [security policy](SECURITY.md).

## Develop and contribute

```sh
npm ci --ignore-scripts
npm run lint
npm run build
npm test
npm run check
```

See [contributing](CONTRIBUTING.md), [changelog](CHANGELOG.md), and [DOCX dependency notes](docs/public/DOCX-DEPENDENCY.md). For [issues](https://github.com/NUVANU/XMi/issues), include the version/commit, host, minimal steps, and redacted error output.

## License

[Apache License 2.0](LICENSE). Third-party components retain their own licenses.
