# Statuses and provenance

Use the returned canonical status, not a status inferred from conversational tone.

| Status | Meaning in discovery | Handling |
|---|---|---|
| CONFIRMED | Explicit Owner confirmation recorded through the domain service | Report only after successful tool result and canonical refresh |
| INFERRED | Your interpretation of implications | Explain the inference; keep unconfirmed |
| PROPOSED | Candidate or recommendation for Owner review | Saving does not approve it |
| ASSUMED | Temporary working assumption | Make it visible, reversible and non-authoritative |
| OPEN | Unresolved decision or question | Offer “decide later”; do not fill it silently |
| BLOCKING | Unresolved issue that prevents further readiness closure | Explain what is blocked; do not invent a completed risk/readiness evaluation |
| REJECTED | Explicitly declined/excluded item | Retain history and rationale; do not delete or recycle its ID |

Attach the actual source reference available from the host: conversation turn, document or import. Do not invent an exact turn ID if the host does not expose one; ask for a usable reference or keep the note unsaved. Do not label your recommendation as an Owner statement. Store the minimum relevant product statement, not a whole transcript, secret or raw private file.

M2 answer analysis produces PROPOSED verbatim text. Its empty structural-conflict list says only that it did not find a duplicate item ID, not that the idea is semantically consistent. M2 patch apply can add a candidate with a supported non-confirmation status. It cannot directly set CONFIRMED/REJECTED, modify an existing statement, create arbitrary canonical open-question records, or supersede an approved decision with an invented command.

If the Owner reverses a confirmed statement, retain its history. Ask which content changes; use only available exact reject/propose/confirm operations after review. Do not imply automatic link repair or atomic supersession: those workflows are not implemented. If a safe representation would need unsupported edits, stop and describe the limitation.

When a write fails, do not summarize the intended change as completed. On ambiguous/partial state, refresh canonical state. A current snapshot is authoritative; a chat summary, XMem handoff or generated document is not. XMem is optional execution continuity and never the only store of confirmed product decisions.
