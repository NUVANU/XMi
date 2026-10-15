# ADR-010 - Producer conformance and real consumer verification are separate gate items

- Status: accepted, Owner-approved 2026-09-19
- Amends: `16-RELEASE-GATE.md` section 1, and adds section 5.
- Related: ADR-006 (the frozen handoff envelope), ADR-009 (the V0 surface scope)

## 1. The problem

`docs/16` section 1 carried one bullet:

> - Consumer import fixture passes (XUi and XDev).

That single bullet mixes two different claims.

1. **Producer conformance.** XMi's consumer-facing import surface can read a compiled XSpec without loss. XMi can
   test this itself, because both the surface and the artifact are its own.
2. **Real consumer verification.** An independent consumer implementation actually imports that XSpec. XMi cannot
   test this, because it requires a consumer runtime that XMi does not own.

Neither consumer currently has an independent runtime. XUi exists only as an enum member, a result object and a
conformance stub inside XMi, and `packages/core/xspec-service.ts` states that it provides conformance stubs only.
XDev has accepted the `XDEV-DELIVERY-HANDOFF/1` semantics without implementing runtime support, so its status is
accepted semantics with runtime support still pending.

Because the M10 exit gate is that all private-alpha gates pass, one bullet the project cannot satisfy by itself
blocked the entire gate permanently. That is a gate-definition defect rather than a product defect: the requirement
is reasonable, but it is stated at a granularity that mixes a satisfiable claim with an unsatisfiable one, so no
amount of correct work inside this project can close it.

## 2. Decision (normative)

**2.1** The bullet is split into a producer-side item and a consumer-side item.

Section 1 keeps, as a private-alpha gate item:

> - Producer conformance: the XMi consumer-facing import surface reads a compiled XSpec without loss for both
>   declared consumer profiles.

This is satisfied by XMi's own contract tests and gated by XMi's own suite.

**2.2** A new section 5 carries the real-consumer items, deferred until an independent runtime exists:

> - Real independent XUi consumer import verified against a compiled XSpec.
> - Real XDev importer/runtime import verified, with the frozen `XDEV-DELIVERY-HANDOFF/1` mapping and all four
>   resolution dispositions exercised.

**2.3** Nothing is removed. Every requirement that existed before this ADR still exists; only its location and its
granularity change. No gate item is weakened, waived or re-scoped to a lower standard.

**2.4** F-2 keeps its status. The handoff envelope stays frozen and XDev keeps its Owner-relayed semantic
acceptance, but the XMi side must not claim real XDev runtime evidence until a real importer exists. F-2 remains
`PARTIALLY_CLOSED`.

**2.5** Section 1 remains the V0.1 private-alpha closure condition. Section 5 is what must exist before an
independent consumer may claim that XMi output was verified end to end.

## 3. Consequences

- The V0.1 private-alpha gate becomes satisfiable by work inside this project, which is what makes it a gate rather
  than a permanent blocker.
- XMi must still prove producer conformance with its own tests, so the split does not let XMi stop testing its
  consumer-facing surface.
- The real-consumer requirement stays visible in section 5 rather than disappearing into a milestone note, so it
  cannot be mistaken for something that was satisfied or dropped.
- `docs/02` V0.2 (Consumer handoff alpha) remains the product version that owns the real adapters and contract
  tests. This ADR does not move that work into V0.1; it only stops V0.1 from being blocked by it.
- XMi must not report a hosted or remote surface as verified. This ADR changes nothing about ADR-009 or ADR-005.

## 4. Alternatives rejected

- **Leaving section 1 as written.** Rejected: it makes the private-alpha gate unsatisfiable by construction, and an
  unsatisfiable gate is not a stronger gate, it is a gate nobody can close. M10 measured exactly this outcome.
- **Deleting the bullet.** Rejected: it would remove a real requirement about consumer compatibility and would let
  XMi claim readiness while no consumer can read its output.
- **Weakening the bullet to "a consumer import surface exists".** Rejected: that is weaker than producer
  conformance and would no longer require the artifact to actually be readable.
- **Marking the item `CONDITION_NOT_TRIGGERED`.** Rejected: the condition is not merely untriggered, it is a
  requirement with a named owner and a future milestone. `CONDITION_NOT_TRIGGERED` means "does not apply here",
  which would be false.
