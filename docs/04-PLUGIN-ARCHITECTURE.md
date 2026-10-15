# 04 - Codex / ChatGPT Plugin Architecture

## 1. Current platform baseline

At the design date, OpenAI plugins can package Skills, MCP server connections and optional UI for supported ChatGPT and Codex surfaces. Exact manifest and testing details must be reverified in M0.

## 2. V0 package strategy

```text
XMi Plugin
  .codex-plugin/plugin.json
  skills/
    xmi-discovery/SKILL.md
    xmi-audit-export/SKILL.md
  .mcp.json                 # local/distributed MCP variant, if supported
  .app.json                 # registered remote MCP mapping, if required
  assets/                   # optional listing/UI assets
```

Do not copy this tree blindly. Use the current official scaffolder/plugin-creator in M0 and record the generated structure.

## 3. Supported surfaces and fallback

| Surface | Intended V0 experience | Fallback |
|---|---|---|
| ChatGPT Work/Chat | Plugin invocation, remote MCP, optional UI | structured text cards |
| Codex desktop/app | Plugin/Skill invokes XMi tools; can access repo export | structured text plus local file export |
| Codex CLI | Plugin browser or direct Skill/MCP | CLI-readable JSON/Markdown |
| IDE extension | Plugin installation may not be available | standalone Skill + MCP configuration |

## 4. Why Skills plus MCP

Skills are appropriate for:

- interview behavior;
- when to ask versus infer;
- ordinary-language explanations;
- tool sequencing;
- audit workflow;
- XUi and XDev handoff workflow.

MCP is required for:

- durable Product Model state;
- deterministic validation;
- controlled mutations;
- project resume;
- XSpec compilation;
- audit and readiness records;
- optional structured UI.

## 5. Progressive disclosure

Skill descriptions must be short and recognizable so the host selects them when appropriate. Large checklists and schemas belong in Skill references or MCP-side domain logic, not in the always-loaded description.

## 6. Invocation modes

### Explicit

- `@XMi Help me turn this idea into a build-ready product specification.`
- `$xmi-discovery ...` in Codex CLI, depending on current surface behavior.

### Implicit

The skill description may match requests such as:

- “I have an app idea but do not know how to specify it.”
- “Ask me questions and prepare requirements for Codex/XDev.”
- “Check whether my product design is ready to build.”

Implicit invocation must not hijack ordinary brainstorming or creative writing.

## 7. Optional UI rule

Build tools first. Add UI only after tool-only workflows pass.

UI requirements:

- use the current MCP Apps standard first;
- display source/status for every item;
- confirmation actions must call typed tools;
- no hidden state mutation in the browser component;
- no required functionality may exist only in UI;
- all UI outputs have an accessible text fallback.

## 8. Private alpha before public submission

V0 ends at a private/developer-mode plugin alpha. Public marketplace work is a later release gate because it introduces:

- production HTTPS MCP hosting;
- authentication and multi-tenant isolation;
- verified developer/business identity;
- privacy/terms/support pages;
- formal positive and negative test cases;
- tool safety annotations and review materials.

## 9. Delivery-mode interaction

The plugin asks for or confirms the project outcome once, preferably during intake after enough context exists to make a useful recommendation. Optional UI may render three outcome cards, but text fallback is mandatory. XUi/XDev must receive the selected mode from XSpec rather than prompt the Owner again.

A mode change is a typed MCP mutation with version/fingerprint confirmation, not an informal chat statement.
