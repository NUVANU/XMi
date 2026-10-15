# Current audit/readiness/export tool workflow

Discover the configured XMi tools and use their current schemas; the semantic names below are not permission to invent unavailable tools.

1. `xmi_project_resume` / `xmi_project_get`: establish the exact canonical project/version. Refresh after any separate Owner mutation made outside this Skill.
2. `xmi_audit_run`: run the bounded read-only Auditor. Record `audit_run_id`, findings, state-unchanged evidence, isolation status and independent-review availability. A dependency marked unavailable is not a pass.
3. `xmi_readiness_evaluate`: inspect dimensions separately from hard/mode gates. `hard_gate_ready` is authoritative; `score` is explanatory.
4. Resolve blockers through the existing discovery/decision/risk workflows. The Auditor itself has no Product Model mutation path.
5. `xmi_xspec_compile`: build the deterministic candidate. A candidate status is not READY_FOR_XDEV.
6. `xmi_xspec_validate`: review package-intrinsic errors and consumer compatibility separately. Fix canonical state; do not hand-edit generated JSON/hashes.
7. `xmi_export_package`: only after reviewing the exact package identity/destination. This is a write and requires independent host-form consent. Do not place actor/approval fields in arguments.

Readiness is mode-specific. FAST_VALIDATION audit may be optional unless scoped escalation requires it; FAST_DEVELOPMENT requires independent Spec Review; PRODUCT_GRADE requires independent Product Audit plus immutable evidence. A failed/unavailable required dependency keeps the gate failed.

F-2 remains PARTIALLY_CLOSED. XDEV-DELIVERY-HANDOFF/1 semantics are frozen, but M10 real-XDev end-to-end evidence is still outstanding. Never convert structured scope overrides into free text or claim lossless compatibility.

## Local continuity and text fallback

For M9 local private testing, a new supported local surface/session must reconnect to the same canonical SQLite-backed XMi service and resume by project id. The prior transcript is not a prerequisite. Tool results and generated Markdown are the required fallback; custom UI is optional and must not become a second state path.

Remote ChatGPT connectivity is outside M9 by explicit Owner scope decision. Do not reinterpret a local subprocess restart as a second host surface, and do not mark unexecuted host installation/invocation checks as passed.
