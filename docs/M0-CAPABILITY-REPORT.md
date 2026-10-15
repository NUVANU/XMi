# M0 - Capability Report

Verification date: 2026-09-15 (MEASURED: host Get-Date -Format o, Asia/Shanghai). Scope: M0 only. Documentary capability is not runtime acceptance. Exact runtime versions and execution evidence are in [M0-MILESTONE-REPORT.md](M0-MILESTONE-REPORT.md).

## Result

Skills + stateful MCP remains feasible. The official creator's compatibility manifest remains supported, although a portable manifest is now preferred for new manual packages. Local Codex is the proposed first surface. ChatGPT access, cross-surface resume and enforced Auditor isolation remain untested. No private API is assumed.

## Baseline assumption reconciliation

Rows correspond to the identifiers in docs/17-OPENAI-PLATFORM-BASELINE.md. Every source was opened on the verification date above. Status is documentary unless explicitly identified as a host observation.

| Baseline | Status | Finding / exact official source | Consequence / ADR action |
|---|---|---|---|
| 1 | CONFIRMED | [Plugins](https://developers.openai.com/plugins/concepts/plugins) combine Skills, MCP and optional UI. | Retain ADR-001. |
| 2 | CONFIRMED, qualified | [Architecture](https://developers.openai.com/plugins/concepts/plugins) describes a shared public directory with surface-specific capabilities. | Shared listing does not imply shared execution or storage. |
| 3 | CONFIRMED | [Skills authoring](https://developers.openai.com/plugins/build/skills) requires SKILL.md and permits supporting resources/scripts. | Keep focused discovery and audit/export workflows. |
| 4 | CONFIRMED | [Skill invocation](https://learn.chatgpt.com/docs/build-skills) loads metadata before full instructions. | Test explicit/implicit and negative selection later. |
| 5 | CONFIRMED | [MCP server](https://developers.openai.com/plugins/build/mcp-server) supports typed tools, results, authentication and UI resources. | Keep validation/authorization server-side. |
| 6 | CONFIRMED | [UI](https://developers.openai.com/plugins/build/chatgpt-ui) recommends MCP Apps. | Retain ADR-003, feature detection and text fallback. |
| 7 | CHANGED, compatible | [Packaging](https://developers.openai.com/plugins/build/plugins) prefers portable root plugin.json; creator compatibility format remains supported. | Record both; use actual creator output in M0. ADR-001 addendum. |
| 8 | CONFIRMED, qualified | [Surfaces](https://learn.chatgpt.com/docs/build-skills) distinguish bundled plugins from standalone Skills. | IDE Skill + MCP fallback retained; installation parity unverified. |
| 9 | CONFIRMED availability; isolation execution UNAVAILABLE | [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) exist in Work/Codex but inherit permissions. | Availability is not proof of read-only isolation; ADR-005 condition. |
| 10 | CONFIRMED | [Testing](https://developers.openai.com/plugins/deploy/connect-chatgpt) separates private testing from public submission. | No publication or infrastructure introduced. |

## Manifest and scaffolding

Portable packages use root plugin.json with the Agent Plugins schema, root skills/, optional mcp.json and OpenAI settings under extensions.com.openai. Portable MCP entries declare transport type. The current creator generates .codex-plugin/plugin.json, with optional .mcp.json and .app.json. Renaming files alone does not convert formats. [Official packaging](https://developers.openai.com/plugins/build/plugins)

M0 ran the bundled creator into plugins/xmi. It generated name/version/description/author, skills, interface and mcpServers metadata. The MCP map and capabilities are empty; skills/ has only a preservation file. No app identifier was fabricated. This is supported scaffolding, not an installed XMi product.

## Local/repo/private testing

Documented local flow: put the plugin in a local catalog, add the source with codex plugin marketplace add, install/test in the desktop directory, and start a new conversation. Catalog paths resolve relative to the marketplace root. The local CLI additionally exposes plugin add; only help was observed. No marketplace or host config was changed. [Packaging](https://developers.openai.com/plugins/build/plugins)

For later MCP tools, first use MCP Inspector with representative, invalid, missing-ID and out-of-scope inputs. Enable ChatGPT developer mode under Security and login, add the connection in Plugins, inspect metadata and run direct/indirect/negative workflow cases. Refresh changed metadata and start a new conversation. Test the combined installed Skill/tool workflow after individual capabilities. Account/workspace eligibility and all XMi installation/E2E results remain unverified. [Private testing](https://developers.openai.com/plugins/deploy/connect-chatgpt)

## Supported transports and surfaces

| Surface | Current documentation | Consequence |
|---|---|---|
| Local Codex desktop/CLI/IDE | STDIO and Streamable HTTP; shared host configuration. [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) | Propose local STDIO first. No XMi server exists yet. |
| ChatGPT developer mode | Remote SSE and streaming HTTP. [Developer mode](https://developers.openai.com/api/docs/guides/developer-mode) | Prefer Streamable HTTP for new work; do not assume direct local STDIO or Codex legacy SSE support. |
| Private ChatGPT MCP | Public HTTPS or Secure MCP Tunnel. [Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) | Private forwarding is possible subject to access and approval, not installed. |

Hosted ChatGPT does not read local Codex config. Cross-surface resume needs both surfaces to reach the same canonical XMi service; a shared listing cannot make a local database remotely available. [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Secure MCP Tunnel uses outbound access through OpenAI infrastructure, a tunnel identity, runtime API key, permissions and workspace associations; it can reach local STDIO/HTTP. It is not a public-distribution substitute. Activation and data-flow changes require a separate concrete Owner decision. [Tunnel requirements](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

Published plugin Skills cover Chat/Work web, desktop and mobile and Codex desktop/CLI. Standalone Skills also support IDE. Current docs use ChatGPT desktop naming for several former Codex app pages. Local catalog availability must be tested separately; IDE plugin parity is not established. [Skill surfaces](https://learn.chatgpt.com/docs/build-skills)

## Skills and optional UI

SKILL.md requires name and description; references/, scripts/, assets/ and agents/openai.yaml are optional. Explicit selection uses @ in ChatGPT and $ or /skills in Codex CLI/IDE. Implicit matching uses descriptions; large inventories may shorten or omit initial metadata. Invocation is not guaranteed on every semantically related prompt. No product Skill was activated or tested. [Skills](https://learn.chatgpt.com/docs/build-skills)

Later UI should link through _meta.ui.resourceUri and the MCP Apps JSON-RPC bridge over postMessage. Use window.openai extensions only when needed and feature-detect them. Text and structured results must suffice without UI. Rendering and confirmation behavior are untested on every XMi surface. [UI mechanism](https://developers.openai.com/plugins/build/chatgpt-ui)

## Auditor capability and isolation

Work/Codex subagents are documented; eligible Work accounts and local custom agents differ in controls. Parent live permissions propagate, including overrides. A read-only custom-agent configuration alone is not enough evidence of the effective boundary. [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

Host observation: collaboration.spawn_agent is available with fork_turns: none, but its exposed arguments do not independently restrict tools or writable filesystem access; agents share the workspace. This is host-specific observation, not a portable plugin API. No agent was spawned: the request probes availability rather than explicitly delegating implementation. No independent audit or isolation pass is claimed.

M8 must provide a bounded immutable snapshot, deny canonical write capabilities, accept findings only as proposals tied to that snapshot, and test attempted transcript access/state mutation. If the selected host cannot enforce this, use the design's separate-invocation fallback after approval, or report LLM audit unavailable. Deterministic validation alone cannot satisfy a mode requiring independent review.

## Safety and public submission (planning only)

readOnlyHint, destructiveHint and openWorldHint must match effects. A bounded private account can be closed-world even when remote. Hints do not replace authorization, input validation or explicit server confirmation. Return useful text/structured content and typed schemas. Empty M0 capability maps introduce no tool metadata. [MCP safety](https://developers.openai.com/plugins/build/mcp-server)

Public submission needs Apps Management access, verified publisher identity, public listing/policy/support information and accurate metadata. Remote MCP needs a stable public endpoint, domain verification and reviewer access; UI requires CSP. Current minimums are 5 positive and 3 negative cases (MEASURED: Testing section of the official source on verification date). Recheck before release; nothing was submitted. [Submission](https://developers.openai.com/plugins/deploy/submission)

## Discrepancies and stop boundary

- Packaging: the design describes a supported compatibility format, not the newly preferred portable format.
- Private access: remote testing need not expose a public listener; tunnel credentials/access/data handling remain a future approval.
- Surfaces: local catalog support and published plugin support are different; no blanket host/UI parity.
- Auditor: availability does not establish read-only isolation or eligible Work access.
- XDev: actual candidate enum names are known, but stronger risk floors and missing typed scoped overrides prevent claiming lossless compatibility. See the implementation decision.

These findings do not require changing the product boundary to establish the empty M0 baseline. Dependent remote, audit and adapter implementation remains stopped. Owner approval is required before M1; no acceptance criterion was weakened.
