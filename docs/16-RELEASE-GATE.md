# 16 - Release Gate

2026-10-15 cloud/source continuation supersedes the earlier cloud counts below: normal clean install now passes; cloud production audit is zero and full audit has eight high entries from the single unpatched braces build/lint chain. The chain is absent from checked deployable sources and enforced by the post-build guard; it is not claimed patched. Hosted rollout remains held for Owner review. Owner separately authorized sanitized source synchronization to NUVANU/XMi; this does not approve new ZIP/marketplace releases, change private cloud access or confirm product scope. Root 296 tests, lint/build/check and cloud 17 tests/types/build/local Worker smoke pass. See CLOUD-DEPENDENCY-SECURITY-FIX-20261015.md.

ADR-020 dependency correction: root audit/clean-install verification and source/license/browser provenance are release evidence, not an upstream security patch or blanket safety guarantee. Existing ZIPs predate this change and await Owner review before repackaging. The separate cloud template retains optional-peer install conflict and 31 other full-tree audit entries (including high/critical), so its deployment remains blocked independently of the clean root graph. See DOCX-API-DEPENDENCY-FIX-20261015.md.

2026-10-15 corrective review hold: risk/DOCX corrections must be verified and presented to the Owner before new packaging or publication. The earlier public-alpha-final ZIPs predate these corrections and are historical candidates. private-test-project engineering replay checks do not confirm its revised product scopes or waive remaining product/audit/consumer gates. See RISK-DOCX-FIX-20261015.md.

This hold includes ADR-019 policy chat review. Native mode/risk old-form refusal, exact next-reply commit and bounded generic forms require regression/installation evidence. The next genuine desktop review remains distinct from synthetic tests and cloud local builds. See POLICY-CHAT-REVIEW-FIX-20261015.md.

## 1. V0 private alpha gate

All must pass.

### M9 scope annotation — local private packaging only

Owner decision on 2026-09-19: **remote connectivity is NOT_APPROVED_FOR_M9**. This annotation does not weaken or remove any V0 private-alpha gate. It only records what M9 may establish locally under ADR-005 and which host-dependent checks remain carried.

- **M9 must establish locally when executable:** tool-only workflow without custom UI; canonical resume in a new session/surface; no prior-transcript dependency; failure/recovery without canonical corruption; documentation/install/remove/recovery/limitations; fixture-level negative routing; local logging/injection checks.
- **Carried beyond the M9 candidate until real-host evidence exists:** private plugin installation through the supported host process; explicit host invocation; real-host negative selection behavior; ChatGPT and Codex host-pair testing. **(Status 2026-09-19: the first three now have real-host evidence — installation was measured at M10, and explicit invocation and negative selection were executed by the Owner in a real local session at M11. ChatGPT host-pair testing remains a section 2 item under ADR-009. See `docs/evidence/M11-OWNER-ACCEPTANCE-RESULT.json`.)**
- **Remote side:** public HTTPS, Secure MCP Tunnel, authentication, multi-tenant hosting and paid infrastructure remain outside M9 and unapproved by ADR-005. Their absence is a scope decision, not a test pass and not a waiver.
- **Private-alpha meaning is unchanged:** every item below still must pass before the private-alpha gate can be declared complete.


### V0 surface scope (ADR-009)

V0 private alpha is defined over locally reachable surfaces; hosted-surface testing is a section 2 item.
The 2026-09-19 remote-connectivity decision and this scope are one decision, stated in full in
`docs/adr/ADR-009-V0-SURFACE-SCOPE.md`. The M9 annotation above is the M9 instance of it.

### M11 onboarding acceptance extension (Owner-approved 2026-09-20)

Existing Plugin installation, explicit invocation and tool-only workflow requirements include the checklist in
`M11-INSTALL-FIRST-RUN.md`; related Continuity/Documentation requirements cover saved-location reporting and
resume guidance. This extends acceptance without adding a top-level item.

Status: BLOCKED_ON_INSTALL_FIRST_RUN_ACCEPTANCE. XMI owns implementation and targeted checks; OWNER owns
clean-host installation and fresh-conversation evidence. The earlier invocation result remains valid at its
recorded scope, but the prior 19/28 snapshot is not the expanded-scope verdict. No expanded private-alpha PASS
may be claimed until this checklist and other applicable gates pass.

### Product fidelity

- Zero known falsely confirmed material statements.
- Every confirmed item has provenance and a confirmation event.
- Proposed/inferred/assumed content is visibly distinct.
- Contradictory confirmed items cannot silently coexist.

### Completeness/readiness

- Supported profile only.
- No unresolved blocking item.
- No false readiness passes in the adversarial suite.
- Every P0/P1 requirement has valid acceptance coverage.
- Independent audit completed and blocking findings resolved.

### XSpec

- Schema validation 100% across release valid fixtures.
- Broken reference count 0.
- Manifest hashes verified.
- Human Markdown views match canonical JSON content.
- Producer conformance: the XMi consumer-facing import surface reads a compiled XSpec without loss for both declared
  consumer profiles.

### Continuity

- New session resume works from canonical state.
- Full prior transcript is not required.
- Partial tool/model failure does not corrupt the project.

### Plugin

- Private plugin installs through the current supported process.
- Explicit invocation works.
- Negative prompts do not invoke unexpectedly.
- Tool-only workflow works without UI.

> Codex is tested as a locally installed host. Testing ChatGPT on a hosted surface is a **public plugin
> gate** item (section 2), not a private alpha item, because every prerequisite it needs — a public
> endpoint, authentication and tenant isolation, and a verified publisher identity — is stated in section 2.
> See ADR-009. Section 1's "all must pass" is unchanged for every other item.

### Security/privacy

- Default logs contain no full conversations, secrets or raw imported documents.
- Prompt-injection fixtures do not override workflow rules.
- Cross-project access tests pass for any hosted multi-user mode.
- Project export/delete behavior documented.

### Documentation

- README, install, remove, limitations and recovery instructions exist.
- Milestone evidence is complete.
- No unresolved architecture deviation.

## 2. Public plugin gate - deferred

Before public submission, recheck current official requirements and add:

- ChatGPT and Codex tested on the supported public surfaces, including the hosted one;
- production HTTPS MCP endpoint;
- authentication and tenant isolation;
- verified developer/business identity and permissions;
- privacy policy, terms, website and support URLs;
- required positive and negative test cases;
- demo recording and listing materials if required;
- accurate tool annotations and justifications;
- current safety/security scans;
- rate limit, abuse and incident response;
- public data deletion/export policy.

Public release is not implied by private-alpha completion.

## 3. Stop/rollback conditions

Pause release if:

- XMi marks invented content as confirmed;
- a blocking incomplete project is marked ready;
- one user can access another user's project;
- Product Model corruption cannot be recovered;
- exported XSpec differs materially from confirmed state;
- UI mutation bypasses tool/domain validation;
- plugin behavior requires hidden/manual configuration that a nontechnical user cannot reasonably complete;
- XDev must guess a material product decision in the dogfood case.

## 4. Three-mode release gate

All three modes must pass dedicated fixtures before V0.2 private alpha:

- one selection is reused by XUi/XDev; no repeated independent configuration;
- exact readiness level matches project mode;
- FAST_VALIDATION exports explicit limitations and never claims production readiness;
- FAST_DEVELOPMENT requires independent Spec Review;
- PRODUCT_GRADE requires independent Product Audit and applicable risk review;
- unresolved mode-risk override blocks export;
  - enforced since 2026-09-18 (F-10, ADR-008): an unresolved blocking mode-risk makes the package
    invalid, so `xmi_export_package` refuses instead of writing a package that readiness already
    reports as `NOT_READY` with hard gate 9 failed. Before that it was reported but not enforced.
- mode upgrade reuses confirmed state and produces a deterministic gap report;
- prior export mode/readiness cannot be silently altered;
- XUi and XDev receive mode and scope overrides intact;
- XMem is not exposed as a separate user choice.

## 5. Consumer verification gate - deferred (ADR-010)

These items cannot be satisfied by work inside XMi. They require an independent consumer runtime, so they are stated
here rather than in section 1, and they must not be reported as private-alpha items.

- Real independent XUi consumer import verified against a compiled XSpec.
- Real XDev importer/runtime import verified, with the frozen `XDEV-DELIVERY-HANDOFF/1` mapping and all four
  resolution dispositions exercised.

XMi's producer-side conformance remains a section 1 private-alpha item. Section 1's producer item does not claim
that any real consumer has read XMi output, and this section does not weaken that item.

`docs/02` V0.2 (Consumer handoff alpha) owns the work that would close these two items.
