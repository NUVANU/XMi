# 05 - Adaptive Interview Engine

## 1. Objective

Convert ordinary-language intent into a structured Product Model without turning the experience into a fixed questionnaire or allowing the model to invent hidden requirements.

## 2. Interview stages

1. **Intake** - capture the idea, problem and desired outcome.
2. **Users and actors** - who uses it, who administers it, who is affected.
3. **Core journey** - the smallest end-to-end successful flow.
4. **Scope and exclusions** - what V0/MVP must and must not do.
5. **State and data** - what must be remembered, synchronized, deleted or exported.
6. **Roles and permissions** - what different people can see and do.
7. **Failure and edge cases** - rejection, timeout, unavailable service, empty state, invalid input.
8. **Integrations** - external APIs, payments, identity, notifications, maps, AI.
9. **Non-functional constraints** - privacy, security, performance, availability, cost, platforms.
10. **Solution constraints** - local/cloud, budget, operator skill, vendor restrictions.
11. **Acceptance criteria** - observable behavior.
12. **Readiness closure** - resolve remaining blockers and confirm export.

Stages are not strictly linear. New answers may reopen an earlier stage.

## 3. Question selection

Each candidate question receives a score:

```text
question_score =
  blocking_impact
+ product_behavior_impact
+ architecture_impact
+ security_privacy_risk
+ dependency_unlock_value
+ uncertainty_reduction
- user_fatigue_cost
- redundancy_penalty
- premature_detail_penalty
```

Use deterministic weights and LLM assistance. Store the reason a question was selected.

## 4. User-facing rules

- Ask one to three questions per turn by default.
- Use ordinary language, not engineering acronyms.
- Explain why a difficult question matters.
- Offer “I do not know” and “decide later” paths.
- For material choices, show options and trade-offs.
- Do not repeatedly ask questions already answered unless a contradiction exists.
- Do not ask styling details before core behavior is stable.

Bad:

> Do you need RBAC and multi-tenant row-level security?

Good:

> Will different types of users see different functions or private data? For example, can an administrator see every customer's content?

## 5. Answer processing

For each answer:

1. Preserve the source reference.
2. Extract one or more candidate statements.
3. Classify each candidate as fact, requirement, constraint, decision, exclusion, risk or open question.
4. Assign an epistemic status.
5. Detect conflicts with confirmed state.
6. Propose a state patch.
7. Obtain explicit confirmation when required.
8. Commit the validated domain events.

## 6. Status semantics

| Status | Meaning | Can be exported as authoritative? |
|---|---|---|
| CONFIRMED | Explicitly approved by Owner | Yes |
| INFERRED | Strongly implied but not confirmed | No, unless marked non-material metadata |
| PROPOSED | XMi recommendation | No |
| ASSUMED | Temporary working assumption | No |
| OPEN | Unresolved but not yet blocking | No |
| BLOCKING | Must be resolved before readiness | No |
| REJECTED | Explicitly excluded or declined | Exported as out-of-scope/decision history |

## 7. Explicit confirmation

A material item becomes `CONFIRMED` only through a confirmation command/event that includes:

- item ID;
- exact version/content fingerprint;
- Owner action;
- timestamp;
- source conversation/message reference;
- optional notes.

A model phrase such as “the user probably wants” can never create a confirmed item.

## 8. Contradiction handling

When a new answer conflicts with confirmed state:

- do not overwrite;
- create a `CONTRADICTION` issue;
- explain both interpretations in ordinary language;
- ask the Owner which one should remain;
- supersede the old decision only after explicit approval;
- preserve history and affected references.

## 9. Interview completion

The interview is not complete because the user stops answering. It is complete only when:

- the Owner requests export;
- all hard readiness gates pass;
- the independent audit has no blocking finding;
- the final XSpec version is explicitly confirmed for handoff.

## 10. Mode-aware interview depth

The question selector receives the confirmed delivery mode and changes **depth**, not truthfulness.

- `FAST_VALIDATION`: prioritize core problem/user/journey/MVP, explicit assumptions and prototype blockers; defer optional detail.
- `FAST_DEVELOPMENT`: cover complete core flows, major failures, data/permissions/integrations and P0/P1 AC; run independent review.
- `PRODUCT_GRADE`: cover full material roles, lifecycle, edge cases, NFRs, operations and risk domains; run independent audit.

The mode must not cause duplicate questions. When upgraded, ask only the questions identified by Mode Gap Analysis. A high-risk answer may generate a scoped escalation blocker even during a fast interview.
