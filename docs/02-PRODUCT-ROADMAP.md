# 02 - Product Roadmap

This roadmap separates the **product version roadmap** from the **implementation milestone plan**. Detailed milestone acceptance criteria are in `14-CODEX-IMPLEMENTATION-PLAN.md`.

## Phase P0 - Design baseline

Purpose: lock the product boundary, XSpec contract and anti-drift rules before code.

Exit:

- modular documents approved;
- initial schemas parse;
- XMi/XDev/XMem responsibilities do not overlap;
- M0 capability probe is defined.

## V0.0 - Skill-only interaction proof

Purpose: verify that the interview style, status language and question prioritization are understandable.

Includes:

- standalone `xmi-discovery` Skill;
- fixture-based Product Model held in local files for development only;
- no claim of reliable cross-session state;
- no public release.

Success question:

> Does XMi ask materially better questions than a generic “write me a PRD” prompt?

## V0.1 - Stateful Codex local private plugin alpha

Hosted ChatGPT surface testing is governed by the public plugin gate and ADR-009.

Purpose: prove the full Idea -> Product Model -> Audit -> XSpec loop.

Includes:

- Skills + stateful MCP server;
- private/developer-mode plugin installation;
- Web App / Micro-SaaS completeness profile;
- deterministic validation;
- independent Auditor;
- XSpec export;
- optional minimal structured UI;
- textual fallback on every surface.

This is the main implementation target of the present document set.

## V0.2 - Consumer handoff alpha

Purpose: prove that XMi output reduces downstream guessing.

Includes:

- XUi and XDev import adapters and contract tests;
- XDev ambiguity feedback object;
- XMi amendment/version workflow;
- delivery-readiness feedback metrics.

Success question:

> Can XDev plan a project without inventing unresolved product decisions?

## V0.3 - Continuity and XMem adapter

Purpose: improve long-running interviews and cross-agent continuity.

Includes:

- optional XMem adapter for bounded context and execution continuity;
- XMi Product Model remains canonical;
- no duplication of XSpec into XMem;
- long-session and handoff benchmarks.

## V0.4 - Additional product profiles

Candidate profiles:

- local desktop utility;
- mobile companion app;
- game prototype;
- internal enterprise workflow.

A profile is released only with its own completeness rules, fixtures and false-readiness tests.

## V0.5 - XMi Web Studio

Purpose: provide a dedicated nontechnical workspace.

Includes:

- conversation plus Product Map;
- Decision Center;
- Readiness dashboard;
- version comparison;
- XDev launch action.

The Web Studio must reuse the same XMi Core, schemas and MCP/domain services; it must not create a second implementation of the product logic.

## V1 - Trusted Idea-to-Spec product

V1 candidate gate:

- stable XSpec 1.0 contract;
- reliable public authentication and multi-tenant isolation;
- multiple validated product profiles;
- production plugin distribution;
- measured reduction in XDev clarification and rework;
- documented privacy, terms, support and migration policy.

## Roadmap non-goals

The roadmap does not prioritize:

- number of Agents;
- number of generated pages;
- maximum interview length;
- support for every technology;
- replacing human product ownership.

The primary optimization target is **specification fidelity and downstream development readiness**.

## Three-mode roadmap integration

- `V0.0`: interaction proof may exercise `FAST_VALIDATION` only, with no reliability claim.
- `V0.1`: implements the canonical delivery policy, all three mode-specific readiness rules, risk overrides and upgrade gaps.
- `V0.2`: maps the canonical mode contract to XDev's actual three execution modes and verifies downstream claims.
- `V0.3`: applies mode-aware XMem retention/evidence policy without exposing XMem as another user choice.
- `V0.5`: Web Studio presents one project outcome selector and never four independent product selectors.

Success is measured by correct mode inheritance and correct claims, not by forcing every mode to ask the same number of questions.

## M12 scope extension

Following the Web-first V0 milestones, M12 extends the shared XMi interview and XSpec pipeline to digital games and Owner-supplied design documents. It adds selectable question pacing, explicit terminology/conflict review, and local Markdown/TXT/DOCX/PDF assessment. The existing confirmation, provenance, readiness and immutable export gates remain authoritative. See [M12-SCOPE.md](M12-SCOPE.md) and the candidate coverage in [15-TRACEABILITY.md](15-TRACEABILITY.md).
