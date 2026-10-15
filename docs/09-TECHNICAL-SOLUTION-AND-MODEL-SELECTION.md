# 09 - Technical Solution and Model Selection

## 1. Boundary

XMi produces a **Technical Solution Blueprint**, not XDev's detailed implementation architecture.

The blueprint narrows the solution space enough that XDev can plan reliably while leaving code-level decomposition to XDev.

## 2. When solution selection occurs

Do not select a stack immediately after the initial idea. Minimum prerequisites:

- confirmed target users;
- confirmed core flow;
- known data sensitivity;
- known local/cloud requirement;
- rough scale/latency needs;
- integration constraints;
- cost/maintenance preference;
- target platform.

## 3. Blueprint content

- deployment topology;
- client form factor;
- backend need;
- persistence and data ownership;
- authentication/authorization approach;
- integration boundaries;
- AI capability boundary if applicable;
- reliability/privacy constraints;
- recommended stack profile;
- alternatives and trade-offs;
- constraints that XDev must preserve;
- decisions delegated to XDev.

## 4. Recommendation method

For each option evaluate:

- fit to confirmed requirements;
- implementation complexity;
- operational complexity;
- expected cost;
- privacy/security;
- vendor lock-in;
- offline/local requirements;
- XDev support maturity;
- Owner maintenance ability;
- migration path.

Output:

```text
Recommended option
Why it fits
Alternatives
Trade-offs
Risks
Owner decision required? yes/no
Confidence and unresolved inputs
```

## 5. AI model selection

Separate two concepts.

### 5.1 Models used to run XMi

V0 uses the OpenAI/ChatGPT/Codex ecosystem. Complex multi-provider routing is out of scope.

### 5.2 Models used by the user's future product

XMi first records a provider-neutral capability profile:

- text/image/audio/modalities;
- latency;
- quality/reasoning;
- tool use;
- context size;
- privacy/data residency;
- cost envelope;
- structured output reliability;
- safety constraints;
- offline/on-device need.

A current provider/model recommendation is then resolved as a dated recommendation with alternatives. Because model catalogs change, it must include:

- resolved_at;
- source/version;
- capability match;
- pricing/privacy assumptions;
- revalidation requirement before XDev implementation.

## 6. Approval policy

Owner approval is required when a solution choice materially changes:

- recurring cost;
- privacy/data exposure;
- third-party lock-in;
- product behavior;
- offline capability;
- legal/compliance risk;
- long-term maintenance.

## 7. XDev boundary

XDev may refine module architecture and implementation details, but cannot replace an approved material solution constraint without returning an amendment request to XMi/Owner.

## 8. Delivery-mode effect on solution blueprint

Mode may change the required solution detail and assurance, but not permit unsafe hidden shortcuts.

- FAST_VALIDATION may recommend sandbox/mock/local prototypes and explicitly record production gaps.
- FAST_DEVELOPMENT must include practical deployment, data isolation and integration-failure boundaries for the MVP.
- PRODUCT_GRADE must include operational, recovery, security/privacy and maintainability constraints sufficient for XDev planning.

Live payment, private data or destructive behavior in a lower project mode triggers the scoped escalation policy.

## 9. General recommendation implementation (M13)

The solution catalog proposes client/frontend, backend, conditional persistence and deployment, including game engines. Confirmed technology-choice/stack/engine constraints take precedence over suggestions; explicit exclusions remove matching starter candidates. Source-backed material constraints use the existing Product Model. Current licensing, cost, versions, platform compatibility and performance remain unresolved until checked against dated official evidence during interview. Concrete composition and alternative trade-offs are projected into existing XSpec string fields; no schema revision is required.
