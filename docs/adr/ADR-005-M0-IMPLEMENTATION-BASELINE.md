# ADR-005 - M0 Implementation Baseline

Status: Accepted by explicit Owner conditional approval on 2026-09-15.

## Context

Current platform verification and exact environment evidence are in ../M0-CAPABILITY-REPORT.md and ../M0-MILESTONE-REPORT.md.

## Proposed decision

Retain Skills + stateful MCP, XMi-owned canonical state, optional UI and one canonical mode. Use the official creator compatibility scaffold at plugins/xmi, with capabilities added only in their milestones. Use pinned Node LTS, TypeScript, npm, ESLint and native Node tests. Start with local STDIO; remote connectivity is a later approved step.

## Consequences

Portable root manifests are now preferred for manual packages, but creator compatibility output remains supported. M0 baseline checks are not product or installation tests.

The actual XDev candidate enums are mapped in the implementation decision, but stronger risk floors and missing typed overrides require versioned agreement. Auditor isolation requires effective capability denial tests. No schema change, silent mode escalation or readiness reduction is authorized.

## Approval

Owner accepts the local-first TypeScript/npm baseline, creator compatibility scaffold and proposed structure. C-1: commit M0 once on codex/m0-capability-baseline, without merging main. C-2: register F-2. After both conditions, proceed to M1 only and stop for Owner approval.

Remote access, Secure MCP Tunnel, authentication, paid infrastructure, enforced Auditor isolation and lossless XDev compatibility claims are NOT approved. M8 must test isolation, use the designed fallback or report audit unavailable. Existing product boundaries remain authoritative.
