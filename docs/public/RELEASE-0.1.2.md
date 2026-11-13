# XMi V0.1.2 — 2026-11-13

## Changes

- Incremental confirmation reuses unchanged confirmed facts and dispositions. The default complete-list reply is `确认`; legacy replies remain accepted. Qualified or partial replies do not grant complete-list consent.
- An explicit issue-handling reply confirms its chosen actions. Reports and review startup do not add product-confirmation rounds.
- After solution confirmation, generate the current version’s 24-chapter system architecture before full independent content review. `.xmi/context/architecture.md` and the existing XSpec `TECHNICAL-SOLUTION-BLUEPRINT.md` carry the derived architecture.
- Use the supported host’s existing independent Agent capability to review requirements and the same-version architecture. Unchanged readback reuses the completed review; product changes are reviewed for the new version.
- Preserve confirmed browser-only/page-memory solution boundaries, configured `CODEX_HOME` routing, and recharge-failure handling. No new dependency, provider, SQL/product schema migration, or hosted rollout is introduced.

## Acceptance scope

The local release record reports 483 passed / 0 failed tests in both the tested source and installed release tree, plus lint, build, synthetic self-check, fresh STDIO, and an actual bounded Windows Codex desktop workflow. See [the retained acceptance summary](releases/0.1.2/ACCEPTANCE-SUMMARY.json).

The desktop check changed one item, preserved ten unchanged confirmed items, produced the same-version 24-chapter architecture, and collected one real independent Agent review. Its three advisory findings and `NOT_READY_M8` fixture status remain. This is software/workflow acceptance in the existing installation, not formal acceptance of the synthetic product.

Clean-machine installation, other hosts/operating systems, formal product assurance, and real XUi/XDev downstream acceptance are separate checks. GitHub CI results belong to the exact published commit and do not substitute for host acceptance.

## Source provenance

The accepted local source ZIP has SHA-256 `1dfb0ee4e610f6b0b7983b621d4de898d0bbe0bd00afaff3d5ba52e387342ca2`. All 280 payload files were checked against its embedded SHA-256 manifest and the accepted source directory before synchronization.

The GitHub synchronization retains those runtime sources and tests, updates the bilingual README/platform/install descriptions, and adds this release note and the scoped acceptance summary. These documentation changes mean a GitHub source ZIP is a different archive; the hash above identifies the original accepted local artifact. The local source/lite ZIPs are not uploaded as release assets by this synchronization.

## 中文说明

V0.1.2 保留已确认内容，按本次变化进行增量确认，默认回复“确认”。方案确认后，自动生成同版本 24 章系统架构，再借助支持宿主已有的独立 Agent 能力一起评审需求与架构。无变化回读沿用当前结果，真实产品修改后评审对应新版本。

本地验收记录为测试源码和实际安装发行树各 483 项通过、0 失败，并完成现有 Windows Codex 桌面上的单项修改、十项未变化条目保留、同版架构与一次真实独立 Agent 评审。三个建议性问题及夹具 NOT_READY_M8 状态继续保留，不构成正式产品保证。新电脑安装、跨平台、实际 XUi/XDev 下游验收须单独验证。

公开源码保留验收包的运行源码与测试，并补充双语 README、平台/安装说明和验收摘要。上面的哈希仅标识原本地验收 ZIP，不是修改文档后的 GitHub 下载包哈希。本次同步不上传该本地源码/轻量 ZIP 作为 Release 附件。
