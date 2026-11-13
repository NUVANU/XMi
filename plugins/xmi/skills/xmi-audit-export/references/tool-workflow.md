# Current audit/readiness/export tool workflow

At finalization, inventory pending settings, decisions, blueprints and risk dispositions. Reuse unchanged canonical approvals. Use the advertised native xmi_item_review_prepare requests batch for compatible pending actions and substantive changes, display its complete numbered review once, then commit after one genuine reply. Keep the exact options and reasons explicit. If new facts invalidate a blueprint, refresh it after the fact batch and validate its fingerprint. With no pending actions, proceed directly to validation.

Set validate_after_commit: true on the final native requests batch unless the Owner asks to stop at confirmation. Report post_commit_validation from the commit response in the same turn. The check runs against the applied version and reports errors separately from the write receipt.

## Optional independent review

For the real native HOST_AGENT route, follow host-agent-review.md. Generic hosts remain unavailable. For the internal TEST_ONLY compatibility route, use `xmi_spec_review_start` with the exact current project version and idempotency key; query a known run with `xmi_spec_review_status`, respecting findings totals/next offset and item/document/scope coverage. Production is unconfigured and returns UNAVAILABLE without saving or sending materials. TEST_ONLY synthetic records never count as real review. Do not submit reviewer identities, JSON approvals, endpoints, credentials, isolation flags or PASS. Do not start a Codex child session or configure a service as a workaround. Do not enable a new review runtime or a formal assurance platform as part of this content-review cycle. Do not request its configuration as the next step in ordinary delivery. Existing formal readiness and strict package validation remain authoritative, while valid NOT_READY candidate export is allowed under exact consent.

## Existing audit/export sequence

Discover the configured XMi tools and use their current schemas; the semantic names below are not permission to invent unavailable tools.

1. `xmi_project_resume` / `xmi_project_get`: establish the exact canonical project/version. Refresh after any separate Owner mutation made outside this Skill.
2. Use the final batch's post_commit_validation result when present. Otherwise call `xmi_xspec_validate` for the ordinary read-only final check. It runs the bounded audit, compiles the candidate and evaluates readiness. Review package errors, consumer compatibility and hard/mode gates separately. Use `xmi_audit_run`, `xmi_readiness_evaluate` or `xmi_xspec_compile` separately when detailed findings, a readiness breakdown or a candidate preview is needed.
3. Resolve blockers through the existing discovery/decision/risk workflows. Request Owner confirmation only for pending actions or substantive changes. Revalidate the resulting canonical version. Audit and validation results require no acknowledgement. Preserve stale review as history; in the configured cycle, automatically review the changed version once local audit passes.
4. `xmi_export_package`: review the exact package identity/destination and request the host-form authorization for the write. Do not place actor/approval fields in arguments.

XSpec delivery is the goal; do not require an external reviewer for compilation or a valid candidate export. Readiness is mode-specific and the following are legacy formal assurance conditions, not universal export prerequisites. FAST_VALIDATION audit may be optional unless scoped escalation requires it; FAST_DEVELOPMENT requires independent Spec Review; PRODUCT_GRADE requires independent Product Audit plus immutable evidence. A failed/unavailable required dependency keeps the gate failed.

F-2 remains PARTIALLY_CLOSED. XDEV-DELIVERY-HANDOFF/1 semantics are frozen, but M10 real-XDev end-to-end evidence is still outstanding. Never convert structured scope overrides into free text or claim lossless compatibility.

## Local continuity and text fallback

For M9 local private testing, a new supported local surface/session must reconnect to the same canonical SQLite-backed XMi service and resume by project id. The prior transcript is not a prerequisite. Tool results and generated Markdown are the required fallback; custom UI is optional and must not become a second state path.

Remote ChatGPT connectivity is outside M9 by explicit Owner scope decision. Do not reinterpret a local subprocess restart as a second host surface, and do not mark unexecuted host installation/invocation checks as passed.


## Direct issue handling

The Owner-configured cycle is initial confirmation -> automatic local audit -> independent content review. For failed local/review issues, use xmi_item_review_prepare requests plus issue_handling (one issue per action: id, problem, impact, recommendation, affected_ids, optional replacement_text). Display its complete problem/action list once. The genuine numbered handling reply itself confirms adopt/revise/ignore/defer or an explicitly listed structured option. Commit it immediately and reuse post_commit_validation; never request a second approval of the chosen handling or the report. Apply clear rows and ask only about unresolved rows. Exact ordinary text can be supplied as 第2项改为：完整最终文本; structured decisions use a listed option. Reuse unchanged confirmed facts and explicit dispositions. After real changes pass local audit, automatically review the current version once through the existing host_job. No product changes means reuse the current review. When no unhandled issues remain, end the review cycle. Export authorization remains separate. No isolation/provenance platform or new reviewer service is required.
