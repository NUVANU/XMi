# Current audit/readiness/export tool workflow

At finalization, inventory pending settings, decisions, blueprints and risk dispositions. Reuse unchanged canonical approvals. Use the advertised native xmi_item_review_prepare requests batch for compatible pending actions and substantive changes, display its complete numbered review once, then commit after one genuine reply. Keep the exact options and reasons explicit. If new facts invalidate a blueprint, refresh it after the fact batch and validate its fingerprint. With no pending actions, proceed directly to validation.

Set validate_after_commit: true on the final native requests batch unless the Owner asks to stop at confirmation. Report post_commit_validation from the commit response in the same turn. The check runs against the applied version and reports errors separately from the write receipt.

## Optional independent review

For the native HOST_AGENT route, follow host-agent-review.md. A host without a supported native adapter remains UNAVAILABLE; never fabricate a review or use synthetic test authority.

## Existing audit/export sequence

Discover the configured XMi tools and use their current schemas; the semantic names below are not permission to invent unavailable tools.

1. `xmi_project_resume` / `xmi_project_get`: establish the exact canonical project/version. Refresh after any separate Owner mutation made outside this Skill.
2. Use the final batch's post_commit_validation result when present. Otherwise call `xmi_xspec_validate` for the ordinary read-only final check. It runs the bounded audit, compiles the candidate and evaluates readiness. Review package errors, consumer compatibility and hard/mode gates separately. Use `xmi_audit_run`, `xmi_readiness_evaluate` or `xmi_xspec_compile` separately when detailed findings, a readiness breakdown or a candidate preview is needed.
3. Use delivery_workflow.next_action and review delivery_action. Group in-scope product choices once with linked acceptance, resolve technical details within existing authority, and track evidence gaps as verification scenarios. Keep advice without requesting disposition. Review each changed version's relevant delta once. Keep full package and mode/readiness checks authoritative.
4. `xmi_export_package`: review the exact package identity/destination and request the host-form authorization for the write. Do not place actor/approval fields in arguments.

XSpec delivery is the goal; do not require an external reviewer for compilation or a valid candidate export. Readiness is mode-specific and the following are legacy formal assurance conditions, not universal export prerequisites. FAST_VALIDATION audit may be optional unless scoped escalation requires it; FAST_DEVELOPMENT requires independent Spec Review; PRODUCT_GRADE requires independent Product Audit plus immutable evidence. A failed/unavailable required dependency keeps the gate failed.

F-2 remains PARTIALLY_CLOSED. XDEV-DELIVERY-HANDOFF/1 semantics are frozen, but M10 real-XDev end-to-end evidence is still outstanding. Never convert structured scope overrides into free text or claim lossless compatibility.

## Local continuity and text fallback

To continue in a new supported local host session, reconnect to the same SQLite-backed service and resume the project ID. An old transcript does not establish current consent.

This public package supplies a local connection, not a hosted ChatGPT endpoint. A local subprocess restart does not prove a second host surface; report unexecuted host checks accurately.


## Direct issue handling

The Owner-configured cycle is initial confirmation -> automatic local audit -> independent content review. For failed local/review issues, use xmi_item_review_prepare requests plus issue_handling (one issue per action: id, problem, impact, recommendation, affected_ids, optional replacement_text). Display its complete problem/action list once. The genuine numbered handling reply itself confirms adopt/revise/ignore/defer or an explicitly listed structured option. Commit it immediately and reuse post_commit_validation; never request a second approval of the chosen handling or the report. Apply clear rows and ask only about unresolved rows. Exact ordinary text can be supplied as 第2项改为：完整最终文本; structured decisions use a listed option. Reuse unchanged confirmed facts and explicit dispositions. After real changes pass local audit, automatically review the current version once through the existing host_job. No product changes means reuse the current review. When no unhandled issues remain, end the review cycle. Export authorization remains separate. No isolation/provenance platform or new reviewer service is required.
