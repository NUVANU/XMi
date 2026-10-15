# XMi

**通过模块访谈，把产品想法梳理成准确、可追溯、可交接开发的 XSpec。**

当前版本：`0.1.0-alpha.1`，供公开测试。支持网页、SaaS、工具和电子游戏的产品定义；交付的是开发规格，开发执行由开发者或 XDev 负责。

## 使用效果

从一句想法或一套原有设计文档开始。XMi 围绕一个模块展示当前设定、规则表、关联背景、待定问题和建议，逐轮讨论清楚，再进入下一个模块。

例如：“我想做一个多人预约工具。”讨论预约模块时，会一起呈现时段容量、取消规则、冲突处理、权限和失败反馈。未知内容保留为待定项，建议可以修改，正式采用由你确认。

- 导入 Markdown、TXT、DOCX、PDF，提取有来源的待核对条目。
- 梳理术语、歧义、冲突、范围、数据、权限和验收条件。
- 根据已确认约束比较技术方案；涉及成本、隐私和产品行为的决定由你确认。
- 产品状态保存到本地 SQLite，可按项目 ID 跨对话恢复。
- 审计缺口、编译和验证 XSpec；高分不会覆盖阻塞项。

## 快速开始

准备 Node **24.20.0**、npm **11.19.0**。轻量包不附 Node 或 node_modules，首次安装需要联网。已审查的 DOCX API 源码与浏览器产物随源码提供，其来源、组件和许可证见 [DOCX 依赖说明](docs/public/DOCX-DEPENDENCY.md)。

```sh
npm ci --omit=dev --ignore-scripts
npm run check
```

自检只操作独立临时测试数据，模拟 MCP 表单；PASS 不等于宿主界面已验收。

| 宿主 | 配置命令 | 确认机制 |
| --- | --- | --- |
| Codex 本机 | `npm run configure -- --host codex --data-dir <本地绝对目录>` | 信任原生钩子后，完整清单展示、真实回复、受控提交与回读 |
| WorkBuddy | `npm run configure -- --host workbuddy --data-dir <本地绝对目录>` | 通用 MCP；正式采用依赖宿主的 MCP 确认表单 |

将路径换成你自己选择、位于 XMi 安装目录外的目录；路径有空格时加引号。工具拒绝覆盖已有配置或数据库。生成结果位于 `.xmi-install/<宿主>/`，通过宿主支持的入口导入并完成信任；生成配置不等于已连接。[完整安装指南](docs/public/INSTALL.md)

开始对话：

> 启用 XMi，帮我把产品想法按模块讨论。先展示当前设定、关联背景、待定项和建议，一起讨论清楚后整理成 XSpec。

继续项目时提供原项目 ID，沿用原数据库配置。

## 平台与数据

Codex 原生模块确认已有一次真实的 16 项成功回读；所有异常恢复和并发情形尚未完成宿主验收。WorkBuddy 实际安装、表单能力及完整访谈待社区测试。遇到 CONSENT_UNAVAILABLE，应保留讨论并反馈，不能声称正式确认成功。[平台范围](docs/public/PLATFORMS.md)

ChatGPT 手机端不能安装此本地 STDIO 包；本次公开源码不附私人云端服务。XMem 可选，使用 XMi 不要求安装它。

提案与正式确认分开，确认保留来源。导入文件由用户保管，XMi 保留提取条目、来源位置和文件摘要；宿主及模型的数据处理设置另行适用。包内不含作者的真实项目、私人聊天、数据库、密钥或机器配置。[隐私与安全](SECURITY.md)

## 开发与反馈

```sh
npm ci --ignore-scripts
npm run lint
npm run build
npm test
npm run check
npm run package:release
```

[架构概览](docs/public/ARCHITECTURE.md) · [贡献指南](CONTRIBUTING.md) · [更新记录](CHANGELOG.md)

报告问题请包含版本、宿主、步骤和脱敏错误码，不要上传密钥、真实设计文件或数据库。公开候选不包含作者本机 Git 历史和私人试用证据。早期设计/工程文档为历史参考，当前行为以源码、测试和发行说明为准。[已知问题](docs/public/KNOWN-ISSUES.md)包括风险范围误匹配及混合条目排除语义；不能用批量排除绕过。独立审查及真实 XUi/XDev 消费端验收仍有未完成项，Alpha 不承诺生产就绪。

许可证：[Apache-2.0](LICENSE)。项目：[NUVANU/XMi](https://github.com/NUVANU/XMi)。
