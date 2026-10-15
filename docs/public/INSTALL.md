# 安装 XMi Alpha

完整解压到长期保留的位置，或克隆公开源码。准备 Node 24.20.0 / npm 11.19.0，执行 `npm ci --omit=dev --ignore-scripts`、`npm run check`。本包不静默安装运行环境或修改信任记录。

## Codex

```sh
npm run configure -- --host codex --data-dir "D:/XMi-data"
```

Linux/macOS 可使用自己的 `/home/your-name/xmi-data` 等绝对本地路径，但真实宿主安装尚未验收。返回的 plugin_directory 是生成的插件目录。通过当前 Codex 支持的本地 marketplace / 插件入口添加。以下命令曾在本机版本使用，先核对 `codex plugin --help`：

```text
codex plugin marketplace add <plugin_directory> --json
codex plugin add xmi@xmi-local --json
```

已有同名插件时先核对来源，不覆盖原数据库。用户通过宿主原生入口审阅/信任 UserPromptSubmit 钩子，不编辑信任记录。重新连接后在真实对话启用 XMi；模型使用钩子提供的当前会话路由，不要求用户填写内部 ID。

完整清单作为最终聊天内容展示。真实下一条“确认好了”经钩子核验后只保存 GRANTED；模型调用 xmi_module_review_commit，再读取 CONFIRMED 与产品状态，才报告成功。暂时失败用同一绑定重试。新的人类回复（包括询问状态）使未提交授权失效；旧 MATCH 诊断不能补造批准。

## WorkBuddy

```sh
npm run configure -- --host workbuddy --data-dir "D:/XMi-workbuddy-data"
```

通过当前版本的自定义连接器入口导入返回的 configuration，再导入 skills_directory 下两个 Skill。发行目录另附两个平台 Skill ZIP，不要把整个源码 ZIP 当成一个 Skill。

此配置停用六个 Codex 原生确认工具，使用通用 STDIO 入口。创建项目、正式采用等依赖宿主真实 MCP form elicitation。遇到 CONSENT_UNAVAILABLE 时反馈版本并保留讨论，不能直接写库或模拟批准。官方参考：https://open.workbuddy.cn/docs/connector 。实际 UI/确认能力由接收端测试。

## 恢复、升级与移除

新对话提供项目 ID，沿用原数据库。升级前关闭连接并备份数据目录，保留旧安装与配置；验证后切换入口，不覆盖运行中的 SQLite。XSpec 历史导出保持不可变。

移动安装后原绝对启动路径会失效。新项目从新解压副本生成配置；既有项目升级保留数据，通过宿主支持方式明确调整原连接。本首次配置工具会拒绝接管已有数据库。

从宿主停用/卸载 XMi。数据不会自动删除，无需把个人密钥交给作者。
