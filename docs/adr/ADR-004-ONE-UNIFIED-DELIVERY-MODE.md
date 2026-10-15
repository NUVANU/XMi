# ADR-004 - One Unified Delivery Mode

Status: Accepted for V0.2 design.

Decision: The Owner selects one project-level mode (`FAST_VALIDATION`, `FAST_DEVELOPMENT`, `PRODUCT_GRADE`) in XMi or a future suite shell. XUi and XDev inherit it; XMem adapts invisibly. Scope-specific risk may raise a minimum mode, but no component creates a competing independent mode choice.

Reason: Four separate selectors would make the suite unusable for the nontechnical target user and create conflicting Source-of-Truth state.

## M0 integration qualification

Actual XDev candidate enums and their stronger risk rules are documented in ../M0-IMPLEMENTATION-DECISION.md. Its current schema lacks typed scoped-override transport. Preserve the single canonical mode and do not claim compatibility until a versioned adapter passes consumer tests. No semantics or schema were changed in M0.

## F-2 - Mandatory consumer-contract precondition

OPEN, registered by Owner condition C-2 on 2026-09-15. XDev delivery-profile-decision has no typed scope_overrides carrier and forbids additional fields. Rationale text is not a lossless substitute.

After M2 and before M7, agree a versioned consumer envelope/extension with XDev preserving typed scoped overrides and their semantics. F-2 is a precondition for M7 and M10 and must be carried in milestone reports. Closure requires the agreed contract/version and positive/negative consumer preservation evidence. No lossless compatibility claim while open; registration does not authorize changing XDev.

### Update 2026-09-17 - agreement frozen, F-2 PARTIALLY_CLOSED

By Owner decision, the agreement half of F-2 is closed in [ADR-006](ADR-006-XMI-XDEV-DELIVERY-HANDOFF-ENVELOPE.md). The contract version is `XDEV-DELIVERY-HANDOFF/1`, carried by the existing typed XSpec 0.2 `delivery_profile` block, with a normative enum mapping and a normative resolution disposition table. The consumer carrier decision in this ADR's original text ("XDev delivery-profile-decision has no typed scope_overrides carrier") still describes the XDev artifact accurately; the resolution was to place the carrier on the XMi side, which owns the contract, rather than to change XDev.

Still outstanding: XDev acknowledgement, and end-to-end preservation evidence at M10. This ADR's prohibition on a lossless compatibility claim remains in force, and no XDev artifact may be changed without a separate Owner authorisation.
