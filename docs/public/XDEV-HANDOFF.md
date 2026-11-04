# XMi → XDev：原包与来源合同

本说明覆盖 XSpec 0.3.0 / XDEV-DELIVERY-HANDOFF/1 的生产端配套。固定包仍为 xspec-service.ts 的 16 文件，不增加 sidecar；既有导出不被补写。

三个 hash 域不同：manifest.json 原始 UTF-8 字节由消费者在包外 pin；manifest.file_sha256 覆盖 15 个原始载荷字节；canonical_xspec_sha256 使用原 canonical 编码，删除 xspec 的完整 integrity 字段后计算。换行、字节或身份变化必须重新校验，不能按标题或文件夹名推断同一包。

importForConsumer 的 accepted 仅为 LOCAL_CONFORMANCE。downstream_receipt 始终 NOT_OBSERVED，implementation_authorized 始终 false；不产生 XDev 持久接收、原生 Owner 身份认证或 Job。消费者必须读取原包并核严格 UTF-8/唯一 JSON 键、精确文件集合/路径/链接、schema/版本/subject、引用/AC、模式/风险与各 hash。

manifest 的可选 producer_evidence 段由 [producer-evidence.schema.json](producer-evidence.schema.json) 精确定义。生产端 XSpecService 通过构造时绑定的 ProjectService.history 取得同项目、当前 model_version 的事件，重放并核对全部当前模型后投影；MCP 参数没有历史/来源自声明入口。缺 history 时各项 UNAVAILABLE；精确引用的总体覆盖为 COMPLETE/PARTIAL/UNAVAILABLE，但 evidence_status 始终 SOURCE_REFERENCED_NOT_AUTHENTICATED。

subject 绑定 project_id/product_model_version/spec_id/spec_version/canonical_xspec_sha256。mode_selection 指当前模式的原选择/升级事件；item_confirmations 只含本包实际导出的当前确认条目；scope_dispositions 原样保留有效处置的 scope_ids/minimum_mode/resolution 与原 type/ref 来源。event 保存 id/全局版本/hash/actor/command_kind/owner_source_ref。item_version 是当前条目版本，不是全局事件版本；原生身份并未由这些文本引用认证。没有输出完整聊天、未采纳提案或 source excerpt。

局部 schema 不替代语义核对。XMi 本地 validate 从当前领域模型重新编译期望正文，再用其 canonical hash/身份/范围生成期望来源投影；不从待验证正文取得期望 hash 或处置。即使被改写正文和包内 hash 同步更新，真实历史引用也不能为新内容背书。消费者还需核 subject、事件版本/类型/重复关联、条目集合和风险三元组。有段但无效不得静默忽略；旧无扩展包只是来源未提供，可候选留存，不赋来源充分或启动许可。

FAST_VALIDATION/FAST_DEVELOPMENT/PRODUCT_GRADE 分别保持 PROTOTYPE_READY/BUILD_READY/PRODUCT_SPEC_READY 目标，以及 prototype/quick_verified/full_governance 消费建议。建议不是 XDev 风险/profile 守卫的替代品。FAST_VALIDATION 仅原型规格含义；高模式缺独立保证继续 NOT_READY，不造 audit/pass。合法 NOT_READY 可在消费者批准范围内持久接收为候选；无效包必须拒绝。READY_FOR_XDEV 也不授权实现，XDev 自己的确认合同、prepare/preflight/Job/Review/QA 仍独立。

消费者持久接收和原字节幂等读回由其真实入口给回执。新包不得悄悄替换旧任务；UNKNOWN 写入只能原件对账。本轮没有 XMi 导入/调度工具，也未声明 XDev 接收已完成。

本轮隔离 fixture 经真实领域服务和显式 SYNTHETIC_NOT_HUMAN owner_action 生成；READY 由既有评估计算，没有手填 READY/pass。夹具不是人类产品批准、现场业务模型或宿主 UI 验收。

模块澄清沿用现有模块 brief。每轮实际展示数使用声明的 1—8 限额，保留 total/displayed/remaining/truncated；选项 impact、recommendation、why_it_matters 和显式关联从原决策投影。缺内容为 null/空数组，不补造选项。推荐仍 UNADOPTED；预览摘录不是完整确认清单，完整 prepare、真实 grant、commit/readback 与版本/fingerprint 保护保持原样。
