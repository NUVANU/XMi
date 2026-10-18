# XMi private developer-mode package

2026-10-16 补充：按用户要求加入可选的本机 Codex 宿主新 Agent 规格内容评审。沿用既有模型登录和模块确认流程；原生来源核对不等于强制权限隔离，也不自动通过正式就绪门槛。普通采访及有效候选包导出不要求执行评审。见 [ADR-022](../../docs/adr/ADR-022-NATIVE-HOST-AGENT-SPEC-REVIEW.md)。

当前范围（2026-10-16）：围绕模块采访、清单确认、规格质量检查和 XSpec 交付完善现有功能。独立模型审查为可选后续能力，停止第二阶段接入，默认工具目录不展示审查原型。不要求用户配置外部审查服务才能导出。未达到正式保证的有效规格可经授权导出为 NOT_READY 候选包，清楚保留未完成项；不代表生产就绪。见 [ADR-021](../../docs/adr/ADR-021-XSPEC-CORE-SCOPE-CONVERGENCE.md)。

This directory is the V0 local private/developer-mode XMi plugin package, advanced through M10. It keeps the official creator-compatible layout produced in M0 (`.codex-plugin/plugin.json`, `skills/`, `.mcp.json`) and wires the package to the existing local STDIO MCP server. It includes a local marketplace descriptor for private installation. The 2026-10-09 corrective extension adds a native UserPromptSubmit hook for module-end chat confirmation (ADR-015), extended to single-item/decision/blueprint chat review in ADR-016; this package does not introduce remote hosting, HTTPS, remote authentication or custom UI.

For local installation, set hooks/runtime.json source_root to the actual XMi source repository, preserving the configured .mcp.json database. Install the updated package and use Codex's native hook review/trust mechanism for its new definition. Do not edit trust records manually. Restart/reload, then verify xmi_module_review_status reports host_ready after a real user prompt. For a module review, display the complete xmi_module_review_prepare text, receive the next genuine reply, then call xmi_module_review_commit with its exact binding. The hook only persists GRANTED; read CONFIRMED and canonical state after commit. Retry the same binding on a transient failure rather than requesting another approval. A newer user reply or replacement review expires an uncommitted grant. For a single-item review, display the complete xmi_item_review_prepare text, receive the next real reply, then consume its GRANTED record through xmi_item_review_commit and read canonical state. GRANTED alone is not a successful save. The hook definition is unchanged for this extension. Without native trust/delivery, drafts remain usable and module confirmation refuses rather than opening per-row forms. The trusted bridge checks the exact displayed list against a bounded current-session log; unsupported log formats fail closed.

## Package format decision

ADR-019 correction (2026-10-15): native delivery-mode selection/upgrade and risk resolution/withdrawal also use the existing single-action chat prepare/commit route. Do not retry old policy popups after CHAT_REVIEW_REQUIRED. Generic hosts retain bounded readable forms, and cloud retains authenticated page review. No raw JSON fallback remains in the shared approval helper. Existing stuck dialogs must be cancelled and long-lived MCP connections reloaded; installation does not approve or replay any product decision.

XMi keeps the creator-compatible manifest rather than adding a second portable root manifest. M0 verified that this compatibility format remains supported, while portable root manifests are preferred for new manual packages. This repository already owns the creator-generated package, so M10 retains that package and adds the measured local marketplace descriptor instead of maintaining two competing manifests.

The package contains:

- `.agents/plugins/marketplace.json` — local marketplace descriptor; `path: "./"` means the marketplace root is also the plugin root;
- `.codex-plugin/plugin.json` — creator-compatible plugin metadata;
- `.mcp.json` — local STDIO server configuration template;
- `skills/xmi-discovery/` — discovery and canonical-state workflow;
- `skills/xmi-audit-export/` — audit, readiness, compile, validate and controlled export workflow.

No `apps/plugin-ui` is required. All required behavior has a structured-text/tool-only path.

## Prerequisites

Use the repository-pinned Node `24.20.0` and npm `11.19.0`. Keep the XMi repository available locally because the private package starts the TypeScript MCP entry point directly from the repository.

Run dependency restoration in the repository before the first host test:

```text
npm ci
```

A separate `npm run build` is **not required for this private STDIO package path**: Node 24 runs `apps/mcp-server/main.ts` directly. Build/lint/test remain required repository verification gates.

## Configure the local package copy

Do not commit machine-specific paths to the repository. Before installing the private package, copy `plugins/xmi/` into the local catalog or developer-mode location you intend to test, then replace these three placeholders **in that local copy only**:

```text
<abs-path-to-node>
<abs-path-to-xmi-repo>
<abs-path-to-xmi-state.sqlite>
```

The configured `.mcp.json` must resolve to this shape:

```json
{
  "mcpServers": {
    "xmi": {
      "command": "<abs-path-to-node>",
      "args": [
        "<abs-path-to-xmi-repo>/apps/mcp-server/main.ts",
        "--db",
        "<abs-path-to-xmi-state.sqlite>"
      ]
    }
  }
}
```

`--db` must point to one absolute local SQLite file. Reusing the **same** database path is what lets a new supported local surface/session resume the same canonical Product Model. Do not use a relative path, UNC/network share, or a second database for the same continuity test.

## Private installation / local Codex surfaces

The following command spelling was measured by the handoff provider on `codex-cli 0.155.0-alpha.2.6`. It is version-specific and must be rechecked on a different host version. The measured local package shape is the creator-compatible `.codex-plugin/` layout already used here; no portable root-manifest conversion is required for this local installation path.

```text
codex plugin marketplace add <SOURCE> --json
codex plugin list [--marketplace <M>] [--available] [--json]
codex plugin add xmi@xmi-local --json
codex mcp list
```

`codex plugin add` is the measured install command on that version; `plugin install` is not the command used by this host version. The handoff provider measured successful marketplace registration, XMi installation, MCP registration, server initialization and a 19-tool listing. This repository candidate does not relabel that external measurement as a test executed by this container.

For a local cross-surface acceptance run:

1. Configure one local package copy and one canonical SQLite path.
2. On local surface A (for example Codex CLI), install/load XMi and create a project through the typed tools.
3. Finish at least the typed tool-only chain used by the local acceptance protocol: create, obtain the resume/next-question packet, confirm reviewed state, evaluate readiness, compile, validate.
4. Close that surface/session.
5. On a distinct local supported surface B (for example Codex IDE or desktop), load the same XMi package with the **same** SQLite path.
6. Resume the project by project id without supplying the old transcript and verify the canonical mode/items/model version are preserved.
7. Record the real host/surface names and evidence in the M10 landing record. Two subprocesses of the same STDIO harness are useful continuity evidence, but they are **not** to be relabelled as two host surfaces.

## IDE Skill + MCP fallback

If plugin installation is unavailable in an IDE, load the relevant `skills/xmi-*` instructions through the IDE's supported Skill mechanism and configure the same STDIO server command/arguments through the IDE's supported MCP settings. Point it to the same canonical SQLite file when continuity is required.

This fallback must still use the typed XMi MCP tools. Do not create a shadow JSON file, transcript-only state, or a second editable delivery-mode value.

## Text-only fallback

Custom UI is optional and V0 currently ships no `apps/plugin-ui`. The host can complete the workflow from:

- structured MCP tool results;
- `xmi_project_resume` / `xmi_project_get` canonical views;
- ordinary-language explanations from the two XMi Skills;
- the deterministic Markdown files produced inside an XSpec package.

Three delivery modes remain one canonical decision: `FAST_VALIDATION`, `FAST_DEVELOPMENT`, or `PRODUCT_GRADE`. Text cards may explain them, but selection/change still goes through the typed mode tools and host confirmation path.

## Remove

For the measured `codex-cli 0.155.0-alpha.2.6` command surface, remove the plugin and optional local marketplace registration with:

```text
codex plugin remove xmi@xmi-local --json
codex plugin marketplace remove xmi-local
```

Then delete the configured local package copy if desired.

Removing the plugin does **not** delete the canonical SQLite file. Delete or archive that database only as a separate deliberate local data action after confirming it is no longer needed.

## Recovery

- **Project appears missing after restart:** verify that the new surface points to the exact same SQLite file used previously; do not create a replacement project merely because the host lost transcript context.
- **Server will not start:** verify the configured Node executable, repository path, database path and repository dependencies. The server intentionally rejects missing, relative or remote database paths and emits static startup errors rather than echoing raw payloads.
- **Database is corrupt or belongs to another schema:** stop writes and restore a known-good local database/checkpoint. Do not bypass migration/schema checks.
- **Host form/elicitation is unavailable:** write operations that require Owner approval must fail closed. Continue read-only inspection or use a supported local host; do not emulate approval in chat or tool arguments.
- **Interrupted session/process:** reconnect to the same database and call `xmi_project_resume`; canonical state comes from XMi storage, not the prior transcript.

## Private-alpha configuration boundary

The three absolute-path substitutions in `.mcp.json` are visible manual developer setup, not hidden product state. For the `docs/16` section 3 stop condition, M10 treats this as a **partial stop-condition hit for the nontechnical target user**: a developer/Owner can follow the documented private-alpha procedure, but a nontechnical user should not be required to edit three machine paths unaided. M10 therefore does not claim nontechnical self-installation. A future mitigation should generate or validate the configured local copy without committing machine-specific paths; that follow-up belongs after M10 acceptance work and must not introduce remote infrastructure implicitly.

## Limitations and carried gates

M10 is a local private-alpha acceptance milestone, not public release.

- ADR-009 defines V0 private alpha over locally reachable surfaces. Hosted ChatGPT testing is a public-plugin gate item; public HTTPS, Secure MCP Tunnel, authentication, multi-tenant hosting and paid infrastructure remain unapproved under ADR-005.
- Local installation and MCP registration have measured external host evidence from the M10 handoff provider. Real-session explicit Skill invocation and real-host negative selection behavior still require host acceptance evidence; this candidate container cannot execute them.
- F-3 remains open: bounded-snapshot mutation denial is measured, but effective shell/host isolation and a real independent LLM review are not claimed.
- I-3 remains open: authenticated human identity is not established by native session routing; Owner-gated writes require the configured genuine native next-reply grant or applicable host form/page review.
- F-2 remains `PARTIALLY_CLOSED` unless a real XDev runtime import report is produced: `XDEV-DELIVERY-HANDOFF/1` is frozen and semantically accepted Owner-relayed, but an XMi conformance stub is not real-XDev runtime evidence.
- Public marketplace submission is separate work. This private package deliberately contains no `.app.json`, app id, remote endpoint, public listing metadata or authentication design.

The repository's root `plugin-skeleton/` remains design reference material and is not part of this package.
