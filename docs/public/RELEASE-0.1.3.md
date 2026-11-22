# XMi V0.1.3 — 2026-11-22

[Release](https://github.com/NUVANU/XMi/releases/tag/v0.1.3) · [English](https://github.com/NUVANU/XMi/blob/main/README.md) · [简体中文](https://github.com/NUVANU/XMi/blob/main/README.zh-CN.md)

## What ships / 本次内容

V0.1.3 packages the reviewed 2026-11-22 public source update as a fixed release:

- Bounded native checklist-delivery preflight and complete replacement text without duplication.
- Version-bound incremental project reads, exact item reads and short validation receipts.
- Eligible reuse of confirmed blueprint choices, retaining real-change review and genuine consent.
- Optional local prototype flow, grouped choices and verified sixteen-file XSpec export; default ordinary MCP discovery is unchanged.
- Bilingual README, installation guidance, packaging coverage and SHA-256 integrity information.

本次将已公开更新整理为固定发行，版本统一为 **0.1.3**，包含源码包与轻量安装包。完整行为与兼容说明见[更新说明](UPDATE-20261122.md)。旧 v0.1.2 保持不变。

## Downloads / 下载

| File | Contents |
| --- | --- |
| [xmi-0.1.3-source.zip](https://github.com/NUVANU/XMi/releases/download/v0.1.3/xmi-0.1.3-source.zip) | Public runtime, development tests, build tools and documentation / 完整公开源码与测试 |
| [xmi-0.1.3-lite.zip](https://github.com/NUVANU/XMi/releases/download/v0.1.3/xmi-0.1.3-lite.zip) | Runtime, local configuration tools, public docs and optional WorkBuddy Skill ZIPs; development tests omitted / 轻量本地安装内容 |
| [SHA256SUMS.txt](https://github.com/NUVANU/XMi/releases/download/v0.1.3/SHA256SUMS.txt) | SHA-256 checksums for both archives / 两包校验和 |

Both ZIPs contain an internal `SHA256SUMS.json` mapping the packaged files to their checksums. Neither bundles Node.js, npm or node_modules. These are local source/runtime packages, not standalone native executables or a published hosted service.

## Install / 安装

Use Node.js **24.20.0** and npm **11.19.0**. Extract the selected ZIP into a permanent local directory. At its root:

```sh
npm ci --omit=dev --ignore-scripts
npm run check
npm run configure -- --host codex --data-dir "C:/XSuite/xmi-data"
```

Use the returned plugin directory through the supported host installation flow. Review the Stop and UserPromptSubmit hooks, reconnect and verify actual loading. The first-use helper refuses existing databases; upgrades must preserve the existing project ID, database and routing. See [installation and upgrade details](INSTALL.md).

升级前备份数据并保留旧安装。新增蓝图绑定事件需要新版读取器；旧版回退应使用升级前备份。不要覆盖运行中的数据库，不用首次配置工具接管已有库。

## Verification and limits / 验证与边界

The underlying public update passed 511 synthetic tests, lint, TypeScript build, self-check and DOCX source provenance checks. Windows and Linux CI passed before that source merge. V0.1.3 changes release metadata and documentation while retaining that runtime behavior; release-specific archive and installation checks are recorded separately.

Self-check and fixture tests do not establish fresh-host human confirmation or complete downstream XDev Job/QA acceptance. Prototype readiness is not production readiness. WorkBuddy UI, all host anomaly/concurrency paths and other operating-system hosts need separate validation. Current-source dependency advisories remain relevant; this release does not upgrade dependencies or claim a clean security audit. Read [known issues](KNOWN-ISSUES.md), [platform scope](PLATFORMS.md) and [security guidance](../../SECURITY.md).

License: Apache-2.0, with third-party licenses retained.
