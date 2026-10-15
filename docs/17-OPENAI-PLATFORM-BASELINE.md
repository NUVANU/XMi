# 17 - OpenAI Platform Baseline

Verified for design on: `2026-09-04`  
This file is informative, not a substitute for M0 verification.

## 1. Current assumptions

At the verification date:

1. Plugins can combine Skills, MCP server connections and optional UI.
2. Public plugins use a universal directory shared by supported ChatGPT and Codex surfaces.
3. Skills are the reusable workflow authoring format and can include instructions, resources and scripts.
4. Skills use progressive disclosure: short metadata is seen first and the full `SKILL.md` is loaded when selected.
5. MCP servers expose typed tools, structured outputs, authentication and optional UI resources.
6. New UI should use the MCP Apps standard where available and tools must remain usable without UI.
7. A plugin package has a `.codex-plugin/plugin.json` manifest; exact fields and additional `.app.json` / `.mcp.json` usage must be verified during scaffolding.
8. Plugins are available on supported ChatGPT surfaces and Codex desktop/CLI surfaces; the IDE extension may require standalone Skill/MCP fallback rather than plugin installation.
9. Codex/ChatGPT can use subagent workflows, which can isolate the Auditor, but subagents increase token use and write-heavy parallelism requires caution.
10. Private/developer-mode testing and public submission are separate phases.

## 2. Official references

- https://developers.openai.com/plugins
- https://developers.openai.com/plugins/concepts/plugins
- https://developers.openai.com/plugins/build/skills
- https://developers.openai.com/codex/build-skills
- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/app-guidelines
- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/mcp

## 3. M0 verification output

M0 must record for each assumption:

- confirmed / changed / unavailable;
- exact official URL;
- verification date;
- implementation consequence;
- whether an ADR/doc update is required.

Do not block the entire product on a specific host feature. Preserve a Skill + MCP fallback.

## M0 verification addendum

The original design-date assumptions above remain historical. See [M0-CAPABILITY-REPORT.md](M0-CAPABILITY-REPORT.md) for dated current sources and per-assumption status. Qualifications: portable manifests coexist with supported creator compatibility output; private testing can use Secure MCP Tunnel; subagent availability does not prove enforced isolation; local catalogs do not establish shared canonical storage.
