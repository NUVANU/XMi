# AGENTS.md - XMi Repository Governance

These instructions apply to the whole repository.

## 1. Product invariant

XMi is an Idea-to-Executable-Spec compiler for nontechnical builders. It must clarify and structure the Owner's actual intent. It must not create a polished specification by silently inventing product decisions.

## 2. Mandatory anti-drift rules

1. Implement only the requested milestone from `docs/14-CODEX-IMPLEMENTATION-PLAN.md`.
2. Do not redesign XMi into a generic chat app, generic PRD generator, no-code app builder, XDev clone, XMem clone or multi-provider agent platform.
3. The chat transcript is not canonical state. Store canonical product state through domain services and validated schemas.
4. Never mark a statement `CONFIRMED` without an explicit Owner confirmation event.
5. Preserve provenance for every confirmed, inferred, proposed, assumed, open, blocking and rejected statement.
6. AI-generated assumptions must remain visible and reversible.
7. Do not use a readiness score as the sole release decision. Blocking rules are authoritative.
8. Do not generate implementation tasks or agent assignments; those belong to XDev.
9. XMem is optional in XMi V0. Never store XMi's canonical Product Model only inside XMem.
10. Do not hardcode unstable OpenAI plugin interfaces from memory. M0 must re-check current official documentation and scaffold with the officially supported mechanism.
11. Keep MCP tools useful without custom UI.
12. Avoid destructive tools. Any future write/destructive action must have explicit annotations, validation and confirmation.
13. Do not log secrets, raw private files or full conversations by default.
14. Never claim tests passed unless the exact test command was run and its result recorded.
15. Any architecture deviation, new cloud dependency, authentication change, schema-breaking change, or Product/XDev/XMem boundary change requires Owner approval.

## 3. Development workflow

- One milestone per branch/PR.
- Small commits with requirement IDs.
- Update `docs/15-TRACEABILITY.md` when requirement coverage changes.
- Add or update tests in the same change as production behavior.
- Schema changes require migration tests and sample fixture updates.
- Tool metadata changes require plugin selection tests, positive cases and negative cases.

## 4. Completion report required for every milestone

Report:

- implemented;
- not implemented;
- files changed;
- tests actually run and results;
- requirement IDs covered;
- assumptions;
- known limitations;
- architecture deviations;
- new dependencies;
- privacy/security impact;
- schema/migration impact;
- OpenAI platform capability assumptions;
- readiness for the next milestone.

## 5. Stop conditions

Stop and request Owner approval when:

- official platform capability contradicts the design baseline;
- a requirement requires changing the XMi/XDev/XMem boundary;
- a public remote service or paid provider must be introduced;
- user data handling changes materially;
- a schema-breaking change cannot be migrated safely;
- acceptance criteria cannot be met without weakening them.

## 6. Delivery-mode invariants

1. The normal user selects one project delivery mode only: `FAST_VALIDATION`, `FAST_DEVELOPMENT`, or `PRODUCT_GRADE`.
2. XMi owns the canonical mode selection and exports it; XUi/XDev inherit it and must not create competing mode state.
3. A faster mode may reduce specification depth and independent assurance, but never confirmation, provenance, schema integrity, secret safety or truthfulness.
4. `FAST_VALIDATION` may only claim prototype readiness. It must never be described as production-ready.
5. Risk-based scope upgrades, stubs/sandboxes, or exclusions must be explicit and Owner-confirmed. Never silently waive a risk minimum.
6. Upgrading mode must use gap analysis and reuse confirmed state. Do not restart or rewrite approved decisions unnecessarily.
7. Prior exported versions are immutable; a downgrade cannot rewrite historical mode/readiness evidence.
