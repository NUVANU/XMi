# 架构概览

Skill 引导访谈和展示上下文，MCP 将输入交给领域服务；经类型、版本、来源和批准校验后保存产品模型。聊天文本本身不等于 canonical 状态。

| 目录 | 职责 |
| --- | --- |
| apps/mcp-server | MCP 契约、路由、视图、确认及本机/通用入口 |
| apps/local-module-review | Codex 原生显示核验、授权和提交适配 |
| packages/core | 采访、文档、冲突与决策、技术方案、完整性、审计及 XSpec |
| packages/shared-types | 类型化状态和领域事件 |
| packages/storage | SQLite 原子事务、不可变事件/回执和测试存储 |
| schemas / samples | 当前及兼容契约、合成样本 |
| plugins/xmi | 两个 Skill、本地插件模板和钩子定义 |
| tools | 配置、自检及公开发行构建 |

模块确认分两阶段：原生钩子保存真实下一条回复对应的 GRANTED；MCP 通过领域事务写全批事件。失败可按原绑定重试；已提交但侧边回执保存失败时，使用原领域回执恢复，不再写第二批。会话锁及仅撤销的中断标记处理竞争，授权只来自真实原生事件。

XMi 保存产品决定，XDev 负责开发计划与执行，XMem 可选。公开准备不引入云端依赖或改动这些边界。
