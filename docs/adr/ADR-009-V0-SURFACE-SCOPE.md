# ADR-009 - The V0 surface scope

Status: **Accepted for V0 by Owner decision on 2026-09-19** ("surface scope").

This ADR fixes which surfaces the V0 private alpha is defined over, because the release gate and the
milestone that has to satisfy it were reading the same list differently. It applies the 2026-09-19
remote-connectivity decision to the gate definition, and it changes no product behavior.

## 1. The problem

`docs/16` section 1 is the V0 private alpha gate and states that all of its items must pass. One of its
Plugin items requires a hosted surface:

- ChatGPT and Codex tested on supported private-alpha surfaces.

The ChatGPT half needs remote connectivity, while ADR-005 withholds approval for remote access, Secure MCP
Tunnel, authentication and paid infrastructure, and M10's exit gate is defined as "all private alpha gates
pass". As written, the private alpha gate therefore could not be satisfied by a local-only project, and the
remote-connectivity decision of 2026-09-19 deliberately left the gate definition unchanged.

The same item was also mis-filed rather than merely blocked. Every prerequisite it needs is already stated in
`docs/16` section 2: a production HTTPS MCP endpoint, authentication and tenant isolation, and verified
developer identity and permissions. None of the other four Plugin items needs any of those; they need a
locally installed host.

## 2. Decision (normative)

1. V0 private alpha is defined over surfaces reachable locally from a real host installation over STDIO.
   Codex CLI, the Codex IDE surface and the Codex desktop surface are such surfaces when they are installed
   and can load this package.
2. Testing on a hosted surface is a **public plugin gate** item, not a private alpha item. The hosted-surface
   testing item therefore moves from `docs/16` section 1 to `docs/16` section 2.
3. Nothing else in section 1 is waived, weakened or carried. Section 1 keeps its "all must pass" meaning for
   every remaining item.
4. Remote access, Secure MCP Tunnel, authentication, multi-tenant hosting and paid infrastructure remain
   **NOT approved** under ADR-005. This ADR does not approve them and does not prepare them.
5. A milestone that cannot execute a real-host item reports it as carried, with the environment reason stated
   plainly. It must not be reported as passed, and the reason must not be phrased as though the item had been
   moved out of scope.

## 3. Consequences

- M10 is locally satisfiable in principle, provided a real local host can install this package. That
  condition is not yet measured; if no local host can install it, the four locally installed-host items are
  equally unexecutable and the Owner must choose between obtaining a host and redefining the alpha gate.
- Public plugin work now owns every remote prerequisite, which is where they were already written.
- Private-alpha completion still does not imply public release.
- The 2026-09-19 `NOT_APPROVED_FOR_M9` decision stands; this ADR is its wider statement, not a replacement.

## 4. Alternatives rejected

- Leaving section 1 unchanged would keep the private alpha gate permanently unsatisfiable locally and would
  push the discovery into the M10 landing record instead of into a decision.
- Approving remote infrastructure now would require a separate project covering host form, authentication,
  cost and publisher identity. ADR-005 withheld all of it deliberately, and nothing in V0 depends on it.
